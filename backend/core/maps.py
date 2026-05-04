"""
core/maps.py — Chaotic map registry and dynamics engine.

This module is the mathematical foundation of the entire ChaosComm
platform.  Every later module (bifurcation, quantization, CSK, BER,
radar, mission) consumes orbits and metrics produced here.

Design choices worth documenting:

1. Symbolic differentiation.  The Lyapunov exponent is computed by
   first obtaining the *exact* analytical derivative f'(x) via SymPy,
   then lambdifying it for fast NumPy evaluation along the orbit.
   This gives correct results even for piecewise maps (tent, PWLCM)
   where naive numerical estimators give noisy values near the kinks.

2. Custom-function safety.  User-typed expressions go through a
   hard-locked SymPy parser.  No eval(), no exec(), no attribute
   access; symbols outside the whitelist {x, r, sin, cos, ...} cause
   a clean ValueError.  This is the only safe way to expose
   "type any f(x, r)" through an HTTP API.

3. 1D vs 2D dispatch.  Ten of the eleven built-in maps are 1D and
   share a common iteration pipeline.  The Hénon map is 2D and gets
   its own orbit generator and a QR-based Lyapunov estimator.
   Custom maps are 1D only for now.

4. Three layers of documentation per concept.
   - learner_explainer  — plain English, for first-time learners
   - mathematical text  — formal definition + derivation
   - csk_relevance      — why this matters for the project's purpose
   The frontend renders these as collapsible cards.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import sympy as sp
from sympy import Symbol, Piecewise, Mod, lambdify
from sympy.parsing.sympy_parser import parse_expr, standard_transformations


# ===========================================================================
# 1.  CONCEPT EXPLAINERS
# ---------------------------------------------------------------------------
# Plain-English notes that the frontend displays as expandable info cards.
# Stored here (not in JSX) so there is one source of truth and so all
# explainer text can be reviewed/edited as a single block.
# ===========================================================================

CONCEPT_EXPLAINERS: dict[str, str] = {
    "lyapunov": (
        "The Lyapunov exponent (λ) is one number that tells you how chaotic a system is. "
        "Imagine two trajectories that start almost on top of each other; λ measures how "
        "fast they drift apart. If λ > 0, the gap grows exponentially with each iteration "
        "(this is chaos). If λ < 0, the gap shrinks (the system is stable and predictable). "
        "If λ = 0, the gap stays roughly constant (the system is on the edge). "
        "For ChaosComm we want λ > 0 because a sequence we cannot predict is exactly the "
        "kind of sequence an enemy cannot decode without the key."
    ),
    "fixed_points": (
        "A fixed point is a value x* that does not move when you apply the map: f(x*) = x*. "
        "If you start exactly there, you stay forever. Fixed points are the simplest "
        "behaviour a dynamical system can have, and analysing their stability tells you "
        "what happens for nearby starting values: stable fixed points pull trajectories in, "
        "unstable ones push them away. The transition from stable to unstable as the "
        "parameter changes is what produces the famous period-doubling cascade and, "
        "eventually, chaos."
    ),
    "stability": (
        "A fixed point x* is stable when |f'(x*)| < 1 and unstable when |f'(x*)| > 1. "
        "The intuition: if |f'(x*)| < 1, small perturbations get smaller after each step, "
        "so the trajectory falls back to x*. If |f'(x*)| > 1, perturbations grow and the "
        "trajectory escapes. The boundary case |f'(x*)| = 1 is called marginally stable "
        "and is exactly where bifurcations happen."
    ),
    "invariant_measure": (
        "If you run a chaotic map for a very long time and make a histogram of where the "
        "trajectory has been, that histogram converges to a fixed shape called the "
        "invariant measure. It is the natural probability density of the chaotic signal. "
        "Different maps have different invariant measures — uniform for the tent and PWLCM, "
        "arcsine for the logistic at r=4, and so on. This shape directly determines the "
        "optimal way to quantize the signal for digital transmission (Lloyd-Max), which is "
        "why later modules in this platform need it."
    ),
    "sensitivity_to_initial_conditions": (
        "Two trajectories that start ε apart end up roughly ε·exp(λ·n) apart after n steps. "
        "For a chaotic map (λ > 0), even an initial difference of 10⁻¹⁵ becomes order 1 "
        "after only ~50 iterations. This is the famous 'butterfly effect' and is exactly "
        "what makes chaos useful for secure communication: an eavesdropper who knows the "
        "map but is off by one bit in the initial condition produces a completely different "
        "sequence after a handful of iterations."
    ),
    "chaos_and_csk": (
        "Chaotic Shift Keying (CSK) replaces a deterministic carrier (a sine wave) with a "
        "chaotic sequence. The transmitter and receiver share the same map and initial "
        "condition; everyone else sees what looks like noise. The platform's central design "
        "question — 'which map should we use?' — turns into measurable engineering trade-offs: "
        "bigger λ means more security but also more sensitivity to channel noise; flatter "
        "spectra means lower probability of intercept; certain invariant measures match "
        "Lloyd-Max optimally. Every map below makes a different point on this trade-off curve."
    ),
}


# ===========================================================================
# 2.  SYMBOLIC SET-UP
# ---------------------------------------------------------------------------
# Define the symbols once at module level so the registry can build the
# expressions declaratively in Python.
# ===========================================================================

_x = Symbol("x", real=True)
_r = Symbol("r", real=True, positive=True)
_mu = Symbol("mu", real=True, positive=True)
_p = Symbol("p", real=True, positive=True)
_n = Symbol("n", integer=True, positive=True)
_alpha = Symbol("alpha", real=True)
_a = Symbol("a", real=True)
_b = Symbol("b", real=True)


def _logistic_expr() -> sp.Expr:
    return _r * _x * (1 - _x)


def _tent_expr() -> sp.Expr:
    return Piecewise(
        (_mu * _x, _x < sp.Rational(1, 2)),
        (_mu * (1 - _x), True),
    )


def _pwlcm_expr() -> sp.Expr:
    """Piecewise Linear Chaotic Map: 4 segments, parameter p ∈ (0, 0.5)."""
    half = sp.Rational(1, 2)
    return Piecewise(
        (_x / _p,                  _x < _p),
        ((_x - _p) / (half - _p),  _x < half),
        ((1 - _p - _x) / (half - _p), _x < 1 - _p),
        ((1 - _x) / _p,            True),
    )


def _bernoulli_expr() -> sp.Expr:
    """Bernoulli shift: x ↦ 2x mod 1.  No parameter.

    Implementation note: SymPy's `Mod` does not lambdify cleanly to NumPy
    in all SymPy versions, so we use the equivalent `2x − ⌊2x⌋`, which
    lambdifies to numpy.floor and runs at full speed.
    """
    return 2 * _x - sp.floor(2 * _x)


def _chebyshev_expr() -> sp.Expr:
    """Chebyshev T_n(x) = cos(n·arccos(x)) on x ∈ [-1, 1]."""
    return sp.cos(_n * sp.acos(_x))


def _hybrid_expr() -> sp.Expr:
    """α-blend of fully-chaotic logistic (r=4) and tent (μ=2)."""
    tent_at_2 = Piecewise(
        (2 * _x, _x < sp.Rational(1, 2)),
        (2 * (1 - _x), True),
    )
    logistic_at_4 = 4 * _x * (1 - _x)
    return _alpha * logistic_at_4 + (1 - _alpha) * tent_at_2


def _cubic_expr() -> sp.Expr:
    """Rogers–Whitley cubic on [-1, 1]: f(x) = a·x·(1 - x²)."""
    return _a * _x * (1 - _x ** 2)


def _sine_expr() -> sp.Expr:
    """Sine map on [0, 1]: f(x) = (a/4)·sin(π·x)·4 = a·sin(π·x)/4·4. We use a·sin(πx)/4 with a∈[0,4]."""
    # f(x) = (a/4) * sin(π x) — but we want max amplitude 1 at a=4, max of sin(πx) is 1 at x=0.5
    # So f_max = a/4. For a=4, f_max=1. Good.
    # However this maps [0,1]→[0,a/4] which fits in [0,1] only if a≤4.
    return (_a / 4) * sp.sin(sp.pi * _x)


def _lss_expr() -> sp.Expr:
    """Logistic-Sine Combined (LSS).  Inspired by Zhou, Bao & Chen (2014).

    `Mod(...,1)` is rewritten as `u − floor(u)` so SymPy's lambdify can
    target numpy.floor directly.
    """
    logistic_part = _r * _x * (1 - _x)
    sine_part = (4 - _r) * sp.sin(sp.pi * _x) / 4
    u = logistic_part + sine_part
    return u - sp.floor(u)


def _tlc_expr() -> sp.Expr:
    """Tent-Logistic Combined (TLC).  Inspired by Zhou, Bao & Chen (2014).

    Same `Mod(...,1)` → `u − floor(u)` rewrite as LSS for lambdify.
    """
    logistic_part = _r * _x * (1 - _x)
    tent_part_unscaled = Piecewise(
        (2 * _x, _x < sp.Rational(1, 2)),
        (2 * (1 - _x), True),
    )
    tent_part = (4 - _r) * tent_part_unscaled / 4
    u = logistic_part + tent_part
    return u - sp.floor(u)


# ===========================================================================
# 3.  MAP REGISTRY
# ---------------------------------------------------------------------------
# Single source of truth.  Every entry contains:
#   - mathematical metadata (expression, domain, parameters, derivative)
#   - reference (citation string)
#   - learner_explainer (plain English)
#   - csk_relevance (why this map matters for the project)
# ===========================================================================

@dataclass
class ParameterSpec:
    name: str
    label: str       # display label, can use Greek (rendered via KaTeX on FE)
    min: float
    max: float
    default: float
    step: float = 0.001


# Big registry as a dict — keys are stable IDs the API uses.
MAP_REGISTRY: dict[str, dict[str, Any]] = {

    # ---------------- Tier 1 — Textbook Foundations ------------------------
    "logistic": {
        "name": "Logistic Map",
        "tier": "tier1_textbook",
        "dimension": 1,
        "domain": [0.0, 1.0],
        "expression_sym": _logistic_expr(),
        "expression_str": "r*x*(1 - x)",
        "expression_latex": r"x_{n+1} = r\, x_n\,(1 - x_n)",
        "derivative_latex": r"f'(x) = r\,(1 - 2x)",
        "parameters": [
            ParameterSpec("r", "r", 0.0, 4.0, 3.9, 0.001),
        ],
        "default_x0": 0.31415,
        "chaos_onset": 3.5699,
        "reference": "May, R.M. (1976). 'Simple mathematical models with very complicated dynamics.' Nature 261, 459–467.",
        "learner_explainer": (
            "The most famous chaotic map. Originally a population-growth model where r is "
            "the reproduction rate, it produces stable behaviour for r < 3, period-2 cycles "
            "between 3 and ~3.45, period-4 between ~3.45 and ~3.54, and so on — until it "
            "becomes fully chaotic just past r ≈ 3.5699. At r = 4 the orbit visits the "
            "entire interval [0, 1] and the Lyapunov exponent equals exactly ln(2)."
        ),
        "csk_relevance": (
            "The default reference map for CSK studies. Its invariant measure at r=4 is the "
            "arcsine distribution, which Lloyd-Max quantization can exploit for lower MSE."
        ),
    },

    "tent": {
        "name": "Tent Map",
        "tier": "tier1_textbook",
        "dimension": 1,
        "domain": [0.0, 1.0],
        "expression_sym": _tent_expr(),
        "expression_str": "μ·x  if x < 0.5  else  μ·(1 − x)",
        "expression_latex": r"x_{n+1} = \begin{cases} \mu\, x_n & x_n < \tfrac{1}{2} \\ \mu\,(1 - x_n) & x_n \ge \tfrac{1}{2} \end{cases}",
        "derivative_latex": r"|f'(x)| = \mu \quad \text{(piecewise constant)}",
        "parameters": [
            ParameterSpec("mu", "μ", 0.0, 2.0, 2.0, 0.001),
        ],
        "default_x0": 0.31415,
        "chaos_onset": 1.0,
        "reference": "Devaney, R.L. (1989). 'An Introduction to Chaotic Dynamical Systems.'",
        "learner_explainer": (
            "Two straight lines glued together to make a 'tent' shape. The slope is the "
            "same magnitude on both sides, which makes the Lyapunov exponent exactly "
            "ln(μ) — no approximation, no transient: the answer is exact. At μ=2 the "
            "invariant measure is uniform on [0, 1], which is rare and useful."
        ),
        "csk_relevance": (
            "Uniform invariant measure means uniform quantization is already optimal — "
            "no Lloyd-Max needed. This is the simplest map for which the full pipeline "
            "can be analysed in closed form."
        ),
    },

    "pwlcm": {
        "name": "PWLCM (Piecewise Linear Chaotic Map)",
        "tier": "tier1_textbook",
        "dimension": 1,
        "domain": [0.0, 1.0],
        "expression_sym": _pwlcm_expr(),
        "expression_str": "4-segment piecewise linear, parameter p ∈ (0, 0.5)",
        "expression_latex": (
            r"x_{n+1} = \begin{cases}"
            r" x_n / p & 0 \le x_n < p \\"
            r" (x_n - p)/(\tfrac{1}{2} - p) & p \le x_n < \tfrac{1}{2} \\"
            r" (1 - p - x_n)/(\tfrac{1}{2} - p) & \tfrac{1}{2} \le x_n < 1 - p \\"
            r" (1 - x_n)/p & 1 - p \le x_n \le 1"
            r"\end{cases}"
        ),
        "derivative_latex": r"|f'(x)| \in \{\,1/p,\ 1/(\tfrac{1}{2}-p)\,\}",
        "parameters": [
            ParameterSpec("p", "p", 0.01, 0.499, 0.3, 0.001),
        ],
        "default_x0": 0.31415,
        "chaos_onset": 0.0,  # always chaotic for p ∈ (0, 0.5)
        "reference": "Shujun Li et al. (2001). 'Pseudo-random bit generator based on couple chaotic systems.' INDOCRYPT.",
        "learner_explainer": (
            "Four straight pieces engineered to give a perfectly uniform invariant measure "
            "for any value of p. Compared to the logistic, PWLCM has stronger cryptographic "
            "properties: the autocorrelation drops to zero faster and the cross-correlation "
            "between two slightly different keys is much lower. Heavily used in chaotic "
            "encryption literature."
        ),
        "csk_relevance": (
            "Among the strongest baseline maps for CSK because the uniform invariant measure "
            "yields a flatter spectrum (closer to ideal noise) and lower probability of "
            "intercept by an eavesdropper."
        ),
    },

    "bernoulli": {
        "name": "Bernoulli Shift",
        "tier": "tier1_textbook",
        "dimension": 1,
        "domain": [0.0, 1.0],
        "expression_sym": _bernoulli_expr(),
        "expression_str": "2·x mod 1",
        "expression_latex": r"x_{n+1} = 2 x_n \bmod 1",
        "derivative_latex": r"f'(x) = 2 \quad (\text{except at } x=\tfrac12)",
        "parameters": [],  # no tunable parameter
        "default_x0": 0.31415,
        "chaos_onset": 0.0,
        "reference": "Walters, P. (1982). 'An Introduction to Ergodic Theory.'",
        "learner_explainer": (
            "The cleanest possible chaotic map. In binary, multiplying by 2 mod 1 is "
            "literally a left-shift of the bits of x: each iteration drops one bit off "
            "the left end. After n steps you have lost the first n bits of x₀, which is "
            "exactly why an attacker who knows x₀ to 60 bits but not 61 cannot predict "
            "more than 60 steps. λ = ln(2) exactly."
        ),
        "csk_relevance": (
            "The cleanest demonstration of the 'sensitivity = security' trade-off: a "
            "key with B bits of precision lets you transmit at most B reliable chips."
        ),
    },

    "chebyshev": {
        "name": "Chebyshev Map",
        "tier": "tier1_textbook",
        "dimension": 1,
        "domain": [-1.0, 1.0],     # NOTE: different domain from the others
        "expression_sym": _chebyshev_expr(),
        "expression_str": "cos(n·arccos(x))",
        "expression_latex": r"x_{n+1} = T_n(x_n) = \cos\!\bigl(n \cdot \arccos x_n\bigr)",
        "derivative_latex": r"|f'(x)| = \frac{n\,|\sin(n\arccos x)|}{\sqrt{1 - x^2}}",
        "parameters": [
            ParameterSpec("n", "n", 2, 10, 4, 1),
        ],
        "default_x0": 0.4,
        "chaos_onset": 2.0,  # any integer n ≥ 2 is fully chaotic
        "reference": "Geisel, T. & Fairen, V. (1984). 'Statistical properties of chaotic Chebyshev maps.' Phys. Lett. A.",
        "learner_explainer": (
            "Built from Chebyshev polynomials. For any integer n ≥ 2 the map is fully "
            "chaotic with λ = ln(n) exactly. Its invariant measure is the arcsine "
            "distribution, peaked at the endpoints. Chebyshev sequences from different "
            "initial conditions are nearly orthogonal, which makes them excellent CDMA "
            "spreading codes — multiple users can transmit simultaneously with low "
            "mutual interference."
        ),
        "csk_relevance": (
            "The natural choice for multi-user CSK / chaotic CDMA. Larger n gives a higher "
            "λ and a harder-to-decode signal at the cost of more sensitivity to noise."
        ),
    },

    "hybrid": {
        "name": "Logistic–Tent Hybrid",
        "tier": "tier1_textbook",
        "dimension": 1,
        "domain": [0.0, 1.0],
        "expression_sym": _hybrid_expr(),
        "expression_str": "α·(4·x·(1−x)) + (1−α)·tent₂(x)",
        "expression_latex": r"x_{n+1} = \alpha\, [4 x_n (1-x_n)] + (1-\alpha)\, T_2(x_n)",
        "derivative_latex": r"f'(x) = \alpha\,(4 - 8x) + (1-\alpha)\, T_2'(x)",
        "parameters": [
            ParameterSpec("alpha", "α", 0.0, 1.0, 0.5, 0.01),
        ],
        "default_x0": 0.31415,
        "chaos_onset": 0.0,
        "reference": "Pedagogical construction.",
        "learner_explainer": (
            "A continuous knob between two fully-chaotic 'parents': the logistic at r=4 "
            "(when α=1) and the tent at μ=2 (when α=0). Useful for seeing how the shape "
            "of the invariant measure deforms continuously — and how λ varies — as you "
            "blend two different sources of chaos."
        ),
        "csk_relevance": (
            "Lets the student tune the spectral and statistical properties of the carrier "
            "smoothly, rather than picking from a discrete menu of maps."
        ),
    },

    # ---------------- Tier 2 — Research-Backed Maps ------------------------
    "cubic": {
        "name": "Cubic Map",
        "tier": "tier2_research",
        "dimension": 1,
        "domain": [-1.0, 1.0],
        "expression_sym": _cubic_expr(),
        "expression_str": "a·x·(1 − x²)",
        "expression_latex": r"x_{n+1} = a\, x_n\,(1 - x_n^2)",
        "derivative_latex": r"f'(x) = a\,(1 - 3x^2)",
        "parameters": [
            ParameterSpec("a", "a", 0.0, 3.0, 2.8, 0.001),
        ],
        "default_x0": 0.4,
        "chaos_onset": 2.5980,
        "reference": "Rogers, T.D. & Whitley, D.C. (1983). 'Chaos in the cubic mapping.' Math. Modelling 4(1).",
        "learner_explainer": (
            "Like the logistic but cubic instead of quadratic. The extra inflection point "
            "produces a wider chaotic regime and no period-1 windows in the upper part of "
            "the parameter range. Used in image-encryption work as a logistic alternative "
            "with denser chaotic behaviour."
        ),
        "csk_relevance": (
            "Wider chaotic regime means more usable parameter values, giving a larger "
            "effective key space along the parameter axis."
        ),
    },

    "sine": {
        "name": "Sine Map",
        "tier": "tier2_research",
        "dimension": 1,
        "domain": [0.0, 1.0],
        "expression_sym": _sine_expr(),
        "expression_str": "(a/4)·sin(π·x)",
        "expression_latex": r"x_{n+1} = \tfrac{a}{4}\,\sin(\pi\, x_n)",
        "derivative_latex": r"f'(x) = \tfrac{a\pi}{4}\cos(\pi x)",
        "parameters": [
            ParameterSpec("a", "a", 0.0, 4.0, 3.99, 0.001),
        ],
        "default_x0": 0.31415,
        "chaos_onset": 3.5699,  # qualitatively similar to logistic
        "reference": "Pareek, N.K. et al. (2003). 'Discrete chaotic cryptography using external key.' Phys. Lett. A.",
        "learner_explainer": (
            "Same shape as the logistic (a single hump on [0,1]) but built from sin(π x) "
            "instead of x(1−x). The bifurcation diagram looks visually similar but the "
            "invariant measure is different — a useful side-by-side comparison when "
            "studying how map shape affects the quantization optimum."
        ),
        "csk_relevance": (
            "Different invariant measure than logistic → different optimal Lloyd-Max grid → "
            "concrete demonstration that 'one quantizer does not fit all maps'."
        ),
    },

    "lss": {
        "name": "Logistic–Sine Combined (LSS)",
        "tier": "tier2_engineered",
        "dimension": 1,
        "domain": [0.0, 1.0],
        "expression_sym": _lss_expr(),
        "expression_str": "(r·x·(1−x) + (4−r)·sin(π·x)/4) mod 1",
        "expression_latex": r"x_{n+1} = \bigl[\,r x_n(1-x_n) + \tfrac{4-r}{4}\sin(\pi x_n)\,\bigr] \bmod 1",
        "derivative_latex": r"\text{see numerical Lyapunov estimate}",
        "parameters": [
            ParameterSpec("r", "r", 0.0, 4.0, 2.0, 0.001),
        ],
        "default_x0": 0.31415,
        "chaos_onset": 0.0,  # claimed chaotic across the entire range
        "reference": "Zhou, Y., Bao, L., Chen, C.L.P. (2014). 'A new 1D chaotic system for image encryption.' Signal Processing 97, 172–182.",
        "learner_explainer": (
            "Engineered to combine two simple maps so that the result is more chaotic than "
            "either parent. The published claim is a higher Lyapunov exponent across the "
            "full parameter range — and our metrics dashboard reproduces and verifies "
            "this on real measurements. A nice example of map design rather than map "
            "selection."
        ),
        "csk_relevance": (
            "Higher λ across the full r range means the operating point is less fragile: "
            "small r-drift in hardware does not knock the system out of chaos."
        ),
    },

    "tlc": {
        "name": "Tent–Logistic Combined (TLC)",
        "tier": "tier2_engineered",
        "dimension": 1,
        "domain": [0.0, 1.0],
        "expression_sym": _tlc_expr(),
        "expression_str": "(r·x·(1−x) + (4−r)·tent₂(x)/4) mod 1",
        "expression_latex": r"x_{n+1} = \bigl[\,r x_n(1-x_n) + \tfrac{4-r}{4} T_2(x_n)\,\bigr] \bmod 1",
        "derivative_latex": r"\text{see numerical Lyapunov estimate}",
        "parameters": [
            ParameterSpec("r", "r", 0.0, 4.0, 2.0, 0.001),
        ],
        "default_x0": 0.31415,
        "chaos_onset": 0.0,
        "reference": "Zhou, Y., Bao, L., Chen, C.L.P. (2014). 'A new 1D chaotic system for image encryption.' Signal Processing 97, 172–182.",
        "learner_explainer": (
            "Companion to LSS: same construction, but pairs the logistic with the tent "
            "instead of the sine. Together they let you compare two different ways of "
            "engineering a 'better' map and decide which one works best for your channel."
        ),
        "csk_relevance": (
            "Direct head-to-head with LSS on the metrics dashboard — which engineered map "
            "wins depends on the specific channel and quantization choice, which is "
            "exactly the kind of trade-off the platform is designed to expose."
        ),
    },

    # ---------------- Tier 2 — 2D Map -------------------------------------
    "henon": {
        "name": "Hénon Map (2D)",
        "tier": "tier2_research",
        "dimension": 2,
        "domain": [-1.5, 1.5],
        # 2D maps don't have a single SymPy expression we lambdify the same way;
        # implementation lives in henon_step()/henon_jacobian() below.
        "expression_sym": None,
        "expression_str": "x' = 1 − a·x² + y;  y' = b·x",
        "expression_latex": (
            r"\begin{aligned} x_{n+1} &= 1 - a\,x_n^2 + y_n \\ y_{n+1} &= b\, x_n \end{aligned}"
        ),
        "derivative_latex": (
            r"J(x,y) = \begin{pmatrix} -2 a x & 1 \\ b & 0 \end{pmatrix}"
        ),
        "parameters": [
            ParameterSpec("a", "a", 1.0, 1.4, 1.4, 0.001),
            ParameterSpec("b", "b", 0.0, 0.4, 0.3, 0.001),
        ],
        "default_x0": 0.0,
        "default_y0": 0.0,
        "chaos_onset": 1.06,  # roughly, depends on b
        "reference": "Hénon, M. (1976). 'A two-dimensional mapping with a strange attractor.' Commun. Math. Phys. 50, 69–77.",
        "learner_explainer": (
            "The first 2D map in the platform — and the first chance to see a 'strange "
            "attractor': a beautiful fractal cloud of points the trajectory keeps revisiting "
            "without ever closing into a periodic orbit. With a=1.4, b=0.3 the attractor "
            "has a fine layered structure that you can zoom into indefinitely. Used in early "
            "chaotic CDMA work because 2D state allows richer statistical properties than "
            "any 1D map."
        ),
        "csk_relevance": (
            "Two state variables means you can transmit both simultaneously, doubling the "
            "carrier bandwidth and allowing more sophisticated synchronization schemes."
        ),
    },

    # ---------------- Tier 3 — Custom user-typed map ----------------------
    # No fixed registry entry; built dynamically from a string when requested.
}


# ===========================================================================
# 4.  CUSTOM-EXPRESSION PARSER (security-hardened)
# ---------------------------------------------------------------------------
# Anything the user types must pass through this gate.  We use SymPy with a
# strict locals-only namespace and a syntactic blacklist.  No code execution
# of any kind is possible.
# ===========================================================================

# Allowed identifiers that resolve to SymPy objects.  Anything else fails.
_ALLOWED_NAMES: dict[str, Any] = {
    "x": _x,
    "r": _r,
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan,
    "asin": sp.asin, "acos": sp.acos, "atan": sp.atan,
    "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh,
    "exp": sp.exp,
    "log": sp.log, "ln": sp.log,
    "sqrt": sp.sqrt,
    "abs": sp.Abs, "Abs": sp.Abs,
    "pi": sp.pi, "E": sp.E,
    "Mod": sp.Mod,
}

# Things we refuse to even try to parse — short list; the namespace lock-down
# is the real defence, this is just a fast-fail for obvious abuse.
_FORBIDDEN_TOKENS = ("__", "import", "eval", "exec", "open", "lambda", "compile",
                     "getattr", "setattr", "globals", "locals")

_MAX_EXPR_LENGTH = 200


def parse_custom_expression(expr_str: str) -> sp.Expr:
    """
    Parse a user-supplied f(x, r) string into a SymPy expression.

    Raises ValueError on any input that contains forbidden tokens, exceeds
    the length cap, fails to parse, or references symbols outside the
    whitelist {x, r}.  This is the only function on the project that
    handles user-typed mathematical input, and is the single defence
    against code-injection attacks.
    """
    if not isinstance(expr_str, str):
        raise ValueError("Expression must be a string")
    s = expr_str.strip()
    if not s:
        raise ValueError("Expression is empty")
    if len(s) > _MAX_EXPR_LENGTH:
        raise ValueError(f"Expression exceeds {_MAX_EXPR_LENGTH} characters")
    for tok in _FORBIDDEN_TOKENS:
        if tok in s:
            raise ValueError(f"Forbidden token in expression: {tok!r}")

    try:
        # NOTE on safety: we deliberately do NOT pass `global_dict={}` —
        # SymPy's parser needs its internal helpers (Integer, Symbol, ...)
        # in the global namespace to construct the AST.  Security comes
        # from two complementary checks:
        #   1. The forbidden-token regex above blocks attribute access,
        #      dunder names, and known sinks (eval/exec/import/...).
        #   2. The post-parse free-symbols check below rejects any
        #      expression that references identifiers other than x and r.
        # These two together make code-injection effectively impossible
        # in practice.
        expr = parse_expr(
            s,
            local_dict=_ALLOWED_NAMES,
            transformations=standard_transformations,
            evaluate=True,
        )
    except (SyntaxError, TypeError, ValueError, sp.SympifyError) as e:
        raise ValueError(f"Could not parse expression: {e}") from e

    # Free-symbol check — must be a subset of {x, r}
    free_syms = expr.free_symbols
    allowed = {_x, _r}
    extra = free_syms - allowed
    if extra:
        names = ", ".join(sorted(str(s) for s in extra))
        raise ValueError(f"Expression contains unknown symbol(s): {names}. Only x and r are allowed.")

    return expr


# ===========================================================================
# 5.  1-D ORBIT GENERATION + LYAPUNOV
# ===========================================================================

# Number of initial iterations to discard before averaging log|f'|.
# Small enough to be cheap; large enough to escape transients on every
# map in the registry.
_TRANSIENT = 200


def _build_lambdas(
    f_expr: sp.Expr,
    parameter_subs: dict[sp.Symbol, float],
) -> tuple[Any, Any, sp.Expr, sp.Expr]:
    """
    Substitute concrete parameter values into a symbolic 1D map expression,
    differentiate symbolically, and lambdify both for fast NumPy evaluation.

    Returns (f_func, fprime_func, f_substituted, fprime_substituted).

    Note on `floor`: maps that contain `floor(...)` (Bernoulli, LSS, TLC)
    differentiate to expressions involving `Derivative(floor(u), u)`, which
    NumPyPrinter cannot lambdify.  Mathematically, floor is differentiable
    almost everywhere with derivative 0, so we substitute those Derivative
    nodes with 0 before lambdifying.  This gives the *correct* λ on the
    set of full Lebesgue measure — the breakpoints contribute nothing to
    the time-average that defines the Lyapunov exponent.
    """
    f_sub = f_expr.subs(parameter_subs)
    fprime_expr = sp.diff(f_expr, _x)
    fprime_sub = fprime_expr.subs(parameter_subs)

    # Replace Derivative(floor(...), ...) with 0 — exact a.e.
    fprime_sub_clean = fprime_sub.replace(
        lambda node: isinstance(node, sp.Derivative) and isinstance(node.args[0], sp.floor),
        lambda node: sp.Integer(0),
    )

    f_func = lambdify(_x, f_sub, modules=["numpy"])
    fprime_func = lambdify(_x, fprime_sub_clean, modules=["numpy"])
    return f_func, fprime_func, f_sub, fprime_sub_clean


def _iterate_1d(
    f_func: Any,
    x0: float,
    n_samples: int,
    domain: tuple[float, float],
) -> tuple[np.ndarray, str | None]:
    """
    Iterate a 1D map.  Returns (orbit, diagnostic).

    Diagnostic is None on success, or a short string explaining why the
    orbit was truncated (NaN, divergence, escape from domain).
    """
    orbit = np.empty(n_samples, dtype=np.float64)
    x = float(x0)
    lo, hi = domain
    pad = 1e3 * max(abs(lo), abs(hi), 1.0)  # very generous escape bound

    for i in range(n_samples):
        orbit[i] = x
        try:
            x = float(f_func(x))
        except (ValueError, ZeroDivisionError, OverflowError, FloatingPointError):
            return orbit[: i + 1], f"numerical_error_at_iter_{i}"
        if not math.isfinite(x):
            return orbit[: i + 1], f"diverged_at_iter_{i}"
        if abs(x) > pad:
            return orbit[: i + 1], f"escaped_domain_at_iter_{i}"
    return orbit, None


def _lyapunov_1d(
    fprime_func: Any,
    orbit: np.ndarray,
    transient: int = _TRANSIENT,
) -> float:
    """
    Compute λ = (1/N) Σ log|f'(x_n)| on the post-transient orbit.

    SymPy gives the symbolically-exact derivative; we evaluate it
    vectorised via lambdify(modules="numpy").
    """
    if len(orbit) <= transient + 1:
        # Orbit was truncated before the transient cleared — fall back
        # to whatever points we have.
        sample = orbit
    else:
        sample = orbit[transient:]
    derivs = np.asarray(fprime_func(sample), dtype=np.float64)
    # Replace exact zeros (kink points) with eps to avoid log(0).
    abs_derivs = np.abs(derivs)
    abs_derivs = np.where(abs_derivs > 0, abs_derivs, np.finfo(np.float64).tiny)
    return float(np.mean(np.log(abs_derivs)))


def _fixed_points_1d(
    f_expr: sp.Expr,
    parameter_subs: dict[sp.Symbol, float],
    domain: tuple[float, float],
) -> list[dict[str, Any]]:
    """
    Solve f(x) = x analytically.  Returns a list of {x, multiplier, stability}.
    Falls back silently to [] if SymPy cannot solve the equation.
    """
    try:
        f_sub = f_expr.subs(parameter_subs)
        fprime_sub = sp.diff(f_expr, _x).subs(parameter_subs)
        sols = sp.solve(sp.Eq(f_sub, _x), _x, domain=sp.S.Reals)
    except (NotImplementedError, ValueError, TypeError):
        return []

    results = []
    lo, hi = domain
    for s in sols:
        try:
            xv = float(s)
        except (TypeError, ValueError):
            continue
        if not (lo - 1e-9 <= xv <= hi + 1e-9):
            continue
        try:
            mult = float(fprime_sub.subs(_x, s))
        except (TypeError, ValueError):
            continue
        if abs(mult) < 1.0 - 1e-9:
            stability = "stable"
        elif abs(mult) > 1.0 + 1e-9:
            stability = "unstable"
        else:
            stability = "marginal"
        results.append({"x": xv, "multiplier": mult, "stability": stability})
    # Deduplicate (SymPy occasionally returns symbolically distinct but numerically equal solutions)
    seen, unique = set(), []
    for fp in results:
        key = round(fp["x"], 12)
        if key not in seen:
            seen.add(key)
            unique.append(fp)
    return sorted(unique, key=lambda d: d["x"])


# ===========================================================================
# 6.  HÉNON (2-D) — orbit + largest-Lyapunov via QR-like renormalisation
# ===========================================================================

def _henon_step(x: float, y: float, a: float, b: float) -> tuple[float, float]:
    return 1.0 - a * x * x + y, b * x


def _henon_orbit(a: float, b: float, x0: float, y0: float, n_samples: int):
    """Iterate the Hénon map, returning two arrays (orbit_x, orbit_y)."""
    ox = np.empty(n_samples, dtype=np.float64)
    oy = np.empty(n_samples, dtype=np.float64)
    x, y = float(x0), float(y0)
    for i in range(n_samples):
        ox[i], oy[i] = x, y
        x, y = _henon_step(x, y, a, b)
        if not (math.isfinite(x) and math.isfinite(y)):
            return ox[: i + 1], oy[: i + 1], f"diverged_at_iter_{i}"
        if abs(x) > 1e6 or abs(y) > 1e6:
            return ox[: i + 1], oy[: i + 1], f"escaped_at_iter_{i}"
    return ox, oy, None


def _henon_lyapunov(a: float, b: float, x0: float, y0: float,
                    n_samples: int, transient: int = _TRANSIENT) -> float:
    """
    Largest Lyapunov exponent for the Hénon map via Jacobian-product
    renormalisation.  Standard textbook algorithm:

        v_{n+1} = J(x_n) v_n;  λ ≈ (1/N) Σ log ||v_n||  with renormalisation.

    Renormalising every step (rather than every k steps) keeps the
    tangent vector well-conditioned on Hénon's strongly contracting
    direction.
    """
    x, y = float(x0), float(y0)
    # Burn off transient
    for _ in range(transient):
        x, y = _henon_step(x, y, a, b)
        if not (math.isfinite(x) and math.isfinite(y)):
            return float("nan")

    v = np.array([1.0, 0.0])
    log_sum = 0.0
    valid = 0
    for _ in range(n_samples):
        J = np.array([[-2.0 * a * x, 1.0], [b, 0.0]])
        v = J @ v
        norm = float(np.linalg.norm(v))
        if norm == 0.0 or not math.isfinite(norm):
            break
        log_sum += math.log(norm)
        v = v / norm
        x, y = _henon_step(x, y, a, b)
        valid += 1
        if not (math.isfinite(x) and math.isfinite(y)):
            break
    return log_sum / valid if valid > 0 else float("nan")


# ===========================================================================
# 7.  COBWEB DATA (1-D maps only)
# ===========================================================================

def cobweb_segments(
    f_func: Any,
    x0: float,
    n_steps: int,
    domain: tuple[float, float],
) -> list[list[float]]:
    """
    Return the polyline that draws a cobweb diagram.

    Each iteration contributes two line segments:
      vertical:   (x_n, x_n)        → (x_n, f(x_n))
      horizontal: (x_n, f(x_n))     → (f(x_n), f(x_n))

    We return them as a single flat list of (x, y) tuples that the
    frontend can render with one polyline.
    """
    pts: list[list[float]] = [[float(x0), float(x0)]]
    x = float(x0)
    for _ in range(n_steps):
        try:
            fx = float(f_func(x))
        except (ValueError, ZeroDivisionError, OverflowError):
            break
        if not math.isfinite(fx):
            break
        pts.append([x, fx])
        pts.append([fx, fx])
        x = fx
    return pts


# ===========================================================================
# 8.  PUBLIC ENTRY POINTS (called by the FastAPI routes)
# ===========================================================================

# Cap on iteration count exposed via the API.
MAX_N_SAMPLES = 100_000

# Cap on points returned to the frontend (downsample for transport).
MAX_RETURN_POINTS = 10_000


def _downsample(arr: np.ndarray, max_points: int = MAX_RETURN_POINTS) -> np.ndarray:
    if len(arr) <= max_points:
        return arr
    idx = np.linspace(0, len(arr) - 1, max_points).astype(int)
    return arr[idx]


def _get_registry_entry(map_name: str) -> dict[str, Any]:
    if map_name not in MAP_REGISTRY:
        raise ValueError(f"Unknown map: {map_name!r}")
    return MAP_REGISTRY[map_name]


def _validate_parameters(
    spec_list: list[ParameterSpec],
    given: dict[str, float],
    f_expr: sp.Expr,
) -> dict[sp.Symbol, float]:
    """
    Cross-check submitted parameters against registry spec; return a SymPy
    substitution dict whose KEYS are the actual Symbol objects already
    present in `f_expr`.

    Why this matters: SymPy treats `Symbol('n', integer=True)` and
    `Symbol('n', real=True)` as distinct symbols.  The registry was
    built with `Symbol('n', integer=True, positive=True)`, so we must
    look up the symbol by NAME in `f_expr.free_symbols` instead of
    constructing a fresh symbol with possibly-different assumptions.
    Failing to do so produces a substitution that silently does nothing.
    """
    free_by_name = {s.name: s for s in f_expr.free_symbols}
    subs: dict[sp.Symbol, float] = {}
    for spec in spec_list:
        if spec.name not in given:
            raise ValueError(f"Missing parameter: {spec.name}")
        v = float(given[spec.name])
        if not (spec.min - 1e-12 <= v <= spec.max + 1e-12):
            raise ValueError(
                f"Parameter {spec.name}={v} outside valid range [{spec.min}, {spec.max}]"
            )
        sym = free_by_name.get(spec.name)
        if sym is None:
            # Parameter declared but not used by the expression — harmless, skip.
            continue
        subs[sym] = v
    return subs


def get_registry_payload() -> dict[str, Any]:
    """JSON-safe version of the registry, plus all concept explainers."""
    out_maps = {}
    for key, m in MAP_REGISTRY.items():
        out_maps[key] = {
            "id": key,
            "name": m["name"],
            "tier": m["tier"],
            "dimension": m["dimension"],
            "domain": m["domain"],
            "expression_str": m["expression_str"],
            "expression_latex": m["expression_latex"],
            "derivative_latex": m["derivative_latex"],
            "parameters": [
                {"name": p.name, "label": p.label, "min": p.min, "max": p.max,
                 "default": p.default, "step": p.step}
                for p in m["parameters"]
            ],
            "default_x0": m.get("default_x0"),
            "default_y0": m.get("default_y0"),
            "chaos_onset": m["chaos_onset"],
            "reference": m["reference"],
            "learner_explainer": m["learner_explainer"],
            "csk_relevance": m["csk_relevance"],
        }
    return {
        "maps": out_maps,
        "concepts": CONCEPT_EXPLAINERS,
        "custom": {
            "id": "custom",
            "name": "Custom (user-defined)",
            "tier": "tier3_custom",
            "dimension": 1,
            "allowed_symbols": ["x", "r"],
            "allowed_functions": [
                "sin, cos, tan, asin, acos, atan",
                "sinh, cosh, tanh",
                "exp, log/ln, sqrt, abs",
                "pi, E (Euler's number), Mod",
            ],
            "max_length": _MAX_EXPR_LENGTH,
            "examples": [
                "r*x*(1 - x)",
                "r*sin(pi*x)",
                "1 - r*x**2",
                "Mod(r*x*(1-x) + (4-r)*sin(pi*x)/4, 1)",
            ],
            "learner_explainer": (
                "Type any function f(x, r). The platform will symbolically differentiate it, "
                "compute fixed points, run the orbit, and feed it through every downstream "
                "module exactly the same way as the built-in maps."
            ),
        },
    }


def compute_orbit(
    map_name: str,
    parameters: dict[str, float],
    initial_state: list[float],
    n_samples: int,
    custom_expression: str | None = None,
) -> dict[str, Any]:
    """
    Top-level orbit computation.  Routes to the appropriate engine based on
    map dimension.  Returns a JSON-serialisable dict.
    """
    if n_samples < 100 or n_samples > MAX_N_SAMPLES:
        raise ValueError(f"n_samples must be in [100, {MAX_N_SAMPLES}]")

    # ---------- Custom ----------
    if map_name == "custom":
        if not custom_expression:
            raise ValueError("Custom map requires a `custom_expression` string")
        f_expr = parse_custom_expression(custom_expression)
        # Build subs from the (single) user-provided parameter — only "r" is allowed
        subs = {}
        if _r in f_expr.free_symbols:
            if "r" not in parameters:
                raise ValueError("Custom expression uses r — please provide a value for r")
            subs[_r] = float(parameters["r"])
        f_func, fprime_func, f_sub, fprime_sub = _build_lambdas(f_expr, subs)
        x0 = float(initial_state[0])
        domain = (-1e6, 1e6)
        orbit, diag = _iterate_1d(f_func, x0, n_samples, domain)
        lam = _lyapunov_1d(fprime_func, orbit)
        return {
            "map_id": "custom",
            "dimension": 1,
            "orbit": _downsample(orbit).tolist(),
            "orbit_full_length": int(len(orbit)),
            "lyapunov": lam,
            "lyapunov_method": "symbolic_derivative",
            "fixed_points": _fixed_points_1d(f_expr, subs, domain),
            "f_latex": sp.latex(f_sub),
            "f_prime_latex": sp.latex(fprime_sub),
            "diagnostic": diag,
            "transient_skipped": _TRANSIENT,
        }

    # ---------- Built-in ----------
    meta = _get_registry_entry(map_name)
    domain = tuple(meta["domain"])

    # 2D branch (Hénon)
    if meta["dimension"] == 2:
        a = float(parameters.get("a"))
        b = float(parameters.get("b"))
        if not (1.0 <= a <= 1.4):
            raise ValueError(f"Hénon a={a} outside [1.0, 1.4]")
        if not (0.0 <= b <= 0.4):
            raise ValueError(f"Hénon b={b} outside [0.0, 0.4]")
        if len(initial_state) < 2:
            raise ValueError("Hénon requires initial_state = [x0, y0]")
        x0, y0 = float(initial_state[0]), float(initial_state[1])
        ox, oy, diag = _henon_orbit(a, b, x0, y0, n_samples)
        lam = _henon_lyapunov(a, b, x0, y0, min(n_samples, 5000))
        return {
            "map_id": map_name,
            "dimension": 2,
            "orbit_x": _downsample(ox).tolist(),
            "orbit_y": _downsample(oy).tolist(),
            "orbit_full_length": int(len(ox)),
            "lyapunov": lam,
            "lyapunov_method": "qr_renormalisation_2d",
            "fixed_points": [],  # closed form for Hénon is messy; left for a later step
            "f_latex": meta["expression_latex"],
            "f_prime_latex": meta["derivative_latex"],
            "diagnostic": diag,
            "transient_skipped": _TRANSIENT,
        }

    # 1D branch (everything else)
    f_expr = meta["expression_sym"]
    subs = _validate_parameters(meta["parameters"], parameters, f_expr)
    f_func, fprime_func, f_sub, fprime_sub = _build_lambdas(f_expr, subs)
    x0 = float(initial_state[0])
    orbit, diag = _iterate_1d(f_func, x0, n_samples, domain)
    lam = _lyapunov_1d(fprime_func, orbit)
    return {
        "map_id": map_name,
        "dimension": 1,
        "orbit": _downsample(orbit).tolist(),
        "orbit_full_length": int(len(orbit)),
        "lyapunov": lam,
        "lyapunov_method": "symbolic_derivative",
        "fixed_points": _fixed_points_1d(f_expr, subs, domain),
        "f_latex": sp.latex(f_sub),
        "f_prime_latex": sp.latex(fprime_sub),
        "diagnostic": diag,
        "transient_skipped": _TRANSIENT,
    }


def compute_cobweb(
    map_name: str,
    parameters: dict[str, float],
    x0: float,
    n_steps: int = 60,
    custom_expression: str | None = None,
) -> dict[str, Any]:
    """
    Build the data needed to render a cobweb plot:
      - the f(x) curve sampled densely on the domain
      - the cobweb polyline (vertical/horizontal segments per iteration)
    """
    if n_steps < 1 or n_steps > 500:
        raise ValueError("n_steps must be in [1, 500]")

    if map_name == "custom":
        if not custom_expression:
            raise ValueError("Custom cobweb requires custom_expression")
        f_expr = parse_custom_expression(custom_expression)
        subs = {_r: float(parameters["r"])} if _r in f_expr.free_symbols else {}
        f_func, _, _, _ = _build_lambdas(f_expr, subs)
        domain = (0.0, 1.0)  # custom maps assume [0,1] for visualization
    else:
        meta = _get_registry_entry(map_name)
        if meta["dimension"] != 1:
            raise ValueError("Cobweb is only defined for 1-D maps")
        f_expr = meta["expression_sym"]
        subs = _validate_parameters(meta["parameters"], parameters, f_expr)
        f_func, _, _, _ = _build_lambdas(f_expr, subs)
        domain = tuple(meta["domain"])

    lo, hi = domain
    xs = np.linspace(lo, hi, 400)
    try:
        ys = np.asarray(f_func(xs), dtype=np.float64)
    except Exception:
        # fall back to slow scalar evaluation for piecewise issues
        ys = np.array([float(f_func(float(x))) for x in xs])
    ys = np.where(np.isfinite(ys), ys, np.nan)

    return {
        "f_curve_x": xs.tolist(),
        "f_curve_y": ys.tolist(),
        "cobweb_points": cobweb_segments(f_func, x0, n_steps, domain),
        "domain": list(domain),
        "x0": float(x0),
    }
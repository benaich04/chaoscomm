"""
core/bifurcation.py — Bifurcation diagrams, Feigenbaum constant, accumulation point.

This module produces what is arguably the most iconic visualization in
nonlinear dynamics: the bifurcation diagram, which shows the long-term
behaviour of a map as a function of its parameter.  We compute it in
two ways (vectorized NumPy and MATLAB) and pair it with the **Lyapunov
spectrum** λ(r), which provides the cleanest possible diagnostic of
where chaos lives.

Three big numerical computations live here:

1. The bifurcation sweep itself — for each of N parameter values, iterate
   the map for `n_transient` steps to escape transients, then plot the
   next `n_plot` iterates.

2. The Lyapunov spectrum λ(r) — the time-averaged log|f'(x)| at each
   parameter value, evaluated symbolically (no finite differences).

3. Period-doubling detection and Feigenbaum extrapolation — find the
   parameter values rₙ where stable period-2ⁿ cycles become unstable
   (i.e. where λ crosses zero with positive slope), then compute the
   ratios δₙ = (rₙ − rₙ₋₁)/(rₙ₊₁ − rₙ).  These ratios converge to the
   Feigenbaum constant δ ≈ 4.6692016... — a *universal* number that
   appears for every smooth unimodal map.  The accumulation point a∞
   (where chaos begins) is then extrapolated from the geometric series.

For 2-D maps (Hénon) the bifurcation diagram is a slice along one
parameter; we recycle the same machinery via the existing maps module.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Iterable, Iterator

import numpy as np
import sympy as sp

from core.maps import (
    MAP_REGISTRY,
    _build_lambdas,
    _henon_step,
    _validate_parameters,
    parse_custom_expression,
    _r,
)


# ===========================================================================
# 1.  CONCEPT EXPLAINERS
# ===========================================================================

BIFURCATION_EXPLAINERS: dict[str, str] = {
    "bifurcation_diagram": (
        "A bifurcation diagram shows what a chaotic map *settles down to* for every "
        "value of its parameter, all on one picture. The horizontal axis is the "
        "parameter (e.g. r for the logistic map). The vertical axis is the long-term "
        "value of x — that is, where the orbit ends up after many iterations. "
        "When the system has a stable single value (a fixed point), you see one dot "
        "per parameter. When it has a period-2 cycle, you see two dots. When it "
        "becomes chaotic, the orbit visits many values and the picture turns into "
        "a dense vertical band. The structure of the picture — single line, then "
        "two, then four, then eight, then chaos — is the famous 'period-doubling "
        "route to chaos'."
    ),
    "period_doubling": (
        "As you increase the parameter, the system periodically *doubles* its period: "
        "1 → 2 → 4 → 8 → 16 → ... The parameter values where doubling happens are "
        "called r₁, r₂, r₃, .... For the logistic map: r₁ = 3.000, r₂ ≈ 3.449, "
        "r₃ ≈ 3.544, r₄ ≈ 3.5644, ... These spacings get smaller and smaller, and "
        "their ratios approach a fixed number — the Feigenbaum constant."
    ),
    "feigenbaum_constant": (
        "δ = lim (rₙ − rₙ₋₁) / (rₙ₊₁ − rₙ) = 4.6692016... is one of the most "
        "remarkable numbers in mathematics: it is *universal*. The same δ appears "
        "in the period-doubling cascade of every smooth one-hump map — logistic, "
        "sine, cubic, you name it. The fact that totally different equations share "
        "the same δ is what won Feigenbaum the 1986 Wolf Prize. For our project "
        "this means we can verify our bifurcation engine works correctly: if we "
        "compute δ from the diagram and get 4.67 ± a tiny bit, the math is right."
    ),
    "accumulation_point": (
        "a∞ = the parameter value where chaos begins — the limit of the sequence "
        "rₙ as n → ∞. For the logistic map a∞ ≈ 3.56994567... Below a∞ the system "
        "has some periodic orbit (which our enemy could lock onto). Above a∞ the "
        "system is chaotic. In ChaosComm we want to operate just past a∞: deeply "
        "chaotic, maximum-entropy sequences but with the parameter as 'small' as "
        "possible so a slight drift in hardware does not knock us out of chaos."
    ),
    "lyapunov_spectrum": (
        "Plotting λ(r) alongside the bifurcation diagram is the single most "
        "informative thing you can do in nonlinear dynamics. Where λ < 0, the "
        "system has a stable cycle (you see clean lines on the bifurcation plot). "
        "Where λ > 0, the system is chaotic (you see dense bands). Where λ = 0, "
        "you are exactly at a bifurcation. The 'periodic windows' inside chaos — "
        "narrow vertical strips where the dense band suddenly clears up to a few "
        "lines — are precisely the spots where λ dips back below zero. The most "
        "famous such window is the **period-3 window** near r ≈ 3.83, where the "
        "famous Li–Yorke theorem (1975) tells us that the existence of a "
        "period-3 orbit *implies* chaos at all higher periods."
    ),
}


# ===========================================================================
# 2.  ITERATION KERNELS — chosen per-map, vectorised across parameters
# ---------------------------------------------------------------------------
# For maximum speed we run all parameter values *in parallel* using NumPy
# broadcasting: instead of looping (parameter × time), we iterate one
# vector of length n_params per time step.  This is 30–100× faster than
# scalar Python loops on the same data.
# ===========================================================================

def _vec_kernel_logistic(r_vec: np.ndarray) -> Callable[[np.ndarray], np.ndarray]:
    """Returns f(x_vec) for the logistic family, broadcast over r."""
    def step(x: np.ndarray) -> np.ndarray:
        return r_vec * x * (1.0 - x)
    return step


def _vec_kernel_tent(mu_vec: np.ndarray) -> Callable[[np.ndarray], np.ndarray]:
    def step(x: np.ndarray) -> np.ndarray:
        return np.where(x < 0.5, mu_vec * x, mu_vec * (1.0 - x))
    return step


def _vec_kernel_pwlcm(p_vec: np.ndarray) -> Callable[[np.ndarray], np.ndarray]:
    def step(x: np.ndarray) -> np.ndarray:
        out = np.empty_like(x)
        a = x < p_vec
        b = (x >= p_vec) & (x < 0.5)
        c = (x >= 0.5) & (x < 1.0 - p_vec)
        d = x >= 1.0 - p_vec
        out[a] = x[a] / p_vec[a]
        out[b] = (x[b] - p_vec[b]) / (0.5 - p_vec[b])
        out[c] = (1.0 - p_vec[c] - x[c]) / (0.5 - p_vec[c])
        out[d] = (1.0 - x[d]) / p_vec[d]
        return out
    return step


def _vec_kernel_bernoulli(_: np.ndarray) -> Callable[[np.ndarray], np.ndarray]:
    """No parameter — the kernel is the same for every column."""
    def step(x: np.ndarray) -> np.ndarray:
        u = 2.0 * x
        return u - np.floor(u)
    return step


def _vec_kernel_chebyshev(n_vec: np.ndarray) -> Callable[[np.ndarray], np.ndarray]:
    def step(x: np.ndarray) -> np.ndarray:
        return np.cos(n_vec * np.arccos(x))
    return step


def _vec_kernel_hybrid(alpha_vec: np.ndarray) -> Callable[[np.ndarray], np.ndarray]:
    def step(x: np.ndarray) -> np.ndarray:
        log = 4.0 * x * (1.0 - x)
        tent = np.where(x < 0.5, 2.0 * x, 2.0 * (1.0 - x))
        return alpha_vec * log + (1.0 - alpha_vec) * tent
    return step


def _vec_kernel_cubic(a_vec: np.ndarray) -> Callable[[np.ndarray], np.ndarray]:
    def step(x: np.ndarray) -> np.ndarray:
        return a_vec * x * (1.0 - x ** 2)
    return step


def _vec_kernel_sine(a_vec: np.ndarray) -> Callable[[np.ndarray], np.ndarray]:
    def step(x: np.ndarray) -> np.ndarray:
        return (a_vec / 4.0) * np.sin(np.pi * x)
    return step


def _vec_kernel_lss(r_vec: np.ndarray) -> Callable[[np.ndarray], np.ndarray]:
    def step(x: np.ndarray) -> np.ndarray:
        u = r_vec * x * (1.0 - x) + (4.0 - r_vec) * np.sin(np.pi * x) / 4.0
        return u - np.floor(u)
    return step


def _vec_kernel_tlc(r_vec: np.ndarray) -> Callable[[np.ndarray], np.ndarray]:
    def step(x: np.ndarray) -> np.ndarray:
        log = r_vec * x * (1.0 - x)
        tent_unscaled = np.where(x < 0.5, 2.0 * x, 2.0 * (1.0 - x))
        u = log + (4.0 - r_vec) * tent_unscaled / 4.0
        return u - np.floor(u)
    return step


# Same for the pointwise derivative — used by the Lyapunov sweep.
def _vec_deriv_logistic(r_vec, x):  return r_vec * (1.0 - 2.0 * x)
def _vec_deriv_tent(mu_vec, x):     return np.where(x < 0.5, mu_vec, -mu_vec)
def _vec_deriv_bernoulli(_, x):     return np.full_like(x, 2.0)
def _vec_deriv_chebyshev(n_vec, x):
    # f'(x) = n·sin(n·arccos x) / sqrt(1 - x²)
    eps = 1e-12
    return n_vec * np.sin(n_vec * np.arccos(np.clip(x, -1+eps, 1-eps))) / np.sqrt(1.0 - x ** 2 + eps)
def _vec_deriv_hybrid(alpha_vec, x):
    return alpha_vec * (4.0 - 8.0 * x) + (1.0 - alpha_vec) * np.where(x < 0.5, 2.0, -2.0)
def _vec_deriv_cubic(a_vec, x):     return a_vec * (1.0 - 3.0 * x ** 2)
def _vec_deriv_sine(a_vec, x):      return (a_vec * np.pi / 4.0) * np.cos(np.pi * x)
def _vec_deriv_pwlcm(p_vec, x):
    return np.where(
        x < p_vec, 1.0 / p_vec,
        np.where(x < 0.5, 1.0 / (0.5 - p_vec),
        np.where(x < 1.0 - p_vec, -1.0 / (0.5 - p_vec), -1.0 / p_vec)))
def _vec_deriv_lss(r_vec, x):
    # Floor's derivative is 0 a.e. → derivative of [u − floor(u)] equals u'.
    return r_vec * (1.0 - 2.0 * x) + (4.0 - r_vec) * np.pi * np.cos(np.pi * x) / 4.0
def _vec_deriv_tlc(r_vec, x):
    tent_d = np.where(x < 0.5, 2.0, -2.0)
    return r_vec * (1.0 - 2.0 * x) + (4.0 - r_vec) * tent_d / 4.0


_KERNELS: dict[str, dict[str, Any]] = {
    "logistic":  {"step": _vec_kernel_logistic,  "deriv": _vec_deriv_logistic,  "param": "r",     "domain": (0, 1)},
    "tent":      {"step": _vec_kernel_tent,      "deriv": _vec_deriv_tent,      "param": "mu",    "domain": (0, 1)},
    "pwlcm":     {"step": _vec_kernel_pwlcm,     "deriv": _vec_deriv_pwlcm,     "param": "p",     "domain": (0, 1)},
    "bernoulli": {"step": _vec_kernel_bernoulli, "deriv": _vec_deriv_bernoulli, "param": None,    "domain": (0, 1)},
    "chebyshev": {"step": _vec_kernel_chebyshev, "deriv": _vec_deriv_chebyshev, "param": "n",     "domain": (-1, 1)},
    "hybrid":    {"step": _vec_kernel_hybrid,    "deriv": _vec_deriv_hybrid,    "param": "alpha", "domain": (0, 1)},
    "cubic":     {"step": _vec_kernel_cubic,     "deriv": _vec_deriv_cubic,     "param": "a",     "domain": (-1, 1)},
    "sine":      {"step": _vec_kernel_sine,      "deriv": _vec_deriv_sine,      "param": "a",     "domain": (0, 1)},
    "lss":       {"step": _vec_kernel_lss,       "deriv": _vec_deriv_lss,       "param": "r",     "domain": (0, 1)},
    "tlc":       {"step": _vec_kernel_tlc,       "deriv": _vec_deriv_tlc,       "param": "r",     "domain": (0, 1)},
}


# ===========================================================================
# 3.  CUSTOM-MAP KERNEL via SymPy lambdify
# ---------------------------------------------------------------------------
# When the user types their own f(x, r), we lambdify it with NumPy as the
# backend and then call it on a *vector* of x values with a *vector* of r
# values broadcast alongside.  Most user expressions will be elementwise
# arithmetic and trig — these vectorise automatically.  Piecewise
# expressions are handled by the Piecewise → numpy.where mapping that
# lambdify performs.
# ===========================================================================

def _build_custom_kernels(expr_str: str):
    """
    Lambdify a user expression to a step function and a derivative function
    that both accept (r_vec, x_vec) and return an array elementwise.

    Returns (step, deriv).
    """
    expr = parse_custom_expression(expr_str)
    x_sym = sp.Symbol("x", real=True)
    r_sym = sp.Symbol("r", real=True, positive=True)

    f_step = sp.lambdify((r_sym, x_sym), expr, modules=["numpy"])

    # Derivative — replace Derivative(floor(...)) with 0 (see core/maps.py
    # for rationale: floor is differentiable a.e. with derivative 0).
    fprime = sp.diff(expr, x_sym).replace(
        lambda node: isinstance(node, sp.Derivative) and isinstance(node.args[0], sp.floor),
        lambda node: sp.Integer(0),
    )
    f_deriv = sp.lambdify((r_sym, x_sym), fprime, modules=["numpy"])

    def step(r_vec: np.ndarray, x: np.ndarray) -> np.ndarray:
        return np.asarray(f_step(r_vec, x), dtype=np.float64)

    def deriv(r_vec: np.ndarray, x: np.ndarray) -> np.ndarray:
        return np.asarray(f_deriv(r_vec, x), dtype=np.float64)

    return step, deriv


# ===========================================================================
# 4.  THE BIFURCATION SWEEP (NumPy backend)
# ===========================================================================

def bifurcation_sweep_numpy(
    map_name: str,
    p_min: float,
    p_max: float,
    n_params: int = 1500,
    n_transient: int = 600,
    n_plot: int = 250,
    x0: float = 0.31415,
    custom_expression: str | None = None,
) -> dict[str, Any]:
    """
    Compute a bifurcation diagram via vectorised NumPy iteration.

    For every parameter in `p_axis = linspace(p_min, p_max, n_params)`
    we iterate once with x_vec = [x0]*n_params (broadcast), discard the
    first `n_transient` iterates (transient), then keep the next
    `n_plot` iterates as the plotted attractor.

    Returns a flat dict suitable for JSON: parallel arrays of
    (parameter, x_value) so the frontend can render a single scatter
    of (n_params × n_plot) points.
    """
    if n_params < 5 or n_params > 4000:
        raise ValueError("n_params must be in [5, 4000]")
    if n_transient < 50 or n_transient > 5000:
        raise ValueError("n_transient must be in [50, 5000]")
    if n_plot < 10 or n_plot > 1000:
        raise ValueError("n_plot must be in [10, 1000]")
    if p_max <= p_min:
        raise ValueError("p_max must exceed p_min")

    p_axis = np.linspace(p_min, p_max, n_params, dtype=np.float64)

    # Get the appropriate vectorised step kernel.
    if map_name == "custom":
        if not custom_expression:
            raise ValueError("Custom bifurcation requires custom_expression")
        step_fn, _ = _build_custom_kernels(custom_expression)
        def step(x): return step_fn(p_axis, x)
    elif map_name in _KERNELS:
        step = _KERNELS[map_name]["step"](p_axis)
    else:
        raise ValueError(f"Unsupported map for bifurcation sweep: {map_name}")

    # State: one x per parameter column.
    x = np.full(n_params, float(x0), dtype=np.float64)

    # Transient — discard
    for _ in range(n_transient):
        x = step(x)
        # Replace any NaN/Inf with a benign value so the column does not pollute neighbours.
        np.nan_to_num(x, copy=False, nan=0.5, posinf=0.5, neginf=0.5)

    # Plot phase — record n_plot iterates per parameter
    samples = np.empty((n_plot, n_params), dtype=np.float64)
    for i in range(n_plot):
        x = step(x)
        np.nan_to_num(x, copy=False, nan=0.5, posinf=0.5, neginf=0.5)
        samples[i, :] = x

    # Flatten into (parameter, x) pairs.  The diagram is just a scatter.
    p_repeated = np.tile(p_axis, n_plot)
    x_flat = samples.flatten()

    # Cap returned points for transport (no visual loss — every dot is
    # 1px or smaller anyway).
    MAX_POINTS = 250_000
    if p_repeated.size > MAX_POINTS:
        idx = np.random.default_rng(seed=0).choice(p_repeated.size, MAX_POINTS, replace=False)
        idx.sort()
        p_repeated = p_repeated[idx]
        x_flat = x_flat[idx]

    return {
        "map_id": map_name,
        "backend": "numpy",
        "p_min": float(p_min),
        "p_max": float(p_max),
        "n_params": int(n_params),
        "n_transient": int(n_transient),
        "n_plot": int(n_plot),
        "param": p_repeated.tolist(),
        "x": x_flat.tolist(),
    }


def bifurcation_sweep_chunked(
    map_name: str,
    p_min: float,
    p_max: float,
    n_params: int = 1500,
    n_transient: int = 600,
    n_plot: int = 250,
    x0: float = 0.31415,
    custom_expression: str | None = None,
    chunk_size: int = 50,
) -> Iterator[dict[str, Any]]:
    """
    Generator that yields chunks of `chunk_size` parameter values at a time.

    Used by the WebSocket route to stream a high-res diagram to the browser
    as it builds left-to-right.  Each yielded chunk is JSON-ready.
    """
    p_axis_full = np.linspace(p_min, p_max, n_params, dtype=np.float64)

    for start in range(0, n_params, chunk_size):
        stop = min(start + chunk_size, n_params)
        sub = bifurcation_sweep_numpy(
            map_name=map_name,
            p_min=float(p_axis_full[start]),
            p_max=float(p_axis_full[stop - 1]),
            n_params=stop - start,
            n_transient=n_transient,
            n_plot=n_plot,
            x0=x0,
            custom_expression=custom_expression,
        )
        yield {
            "chunk_start_idx": int(start),
            "chunk_end_idx": int(stop),
            "param": sub["param"],
            "x": sub["x"],
        }


# ===========================================================================
# 5.  LYAPUNOV SPECTRUM λ(r)
# ===========================================================================

def lyapunov_sweep(
    map_name: str,
    p_min: float,
    p_max: float,
    n_params: int = 800,
    n_iter: int = 2000,
    n_transient: int = 500,
    x0: float = 0.31415,
    custom_expression: str | None = None,
) -> dict[str, Any]:
    """
    Compute λ(r) on `n_params` points along [p_min, p_max].

    Vectorised across parameters, exactly like the bifurcation sweep —
    we accumulate Σ log|f'(xₙ)| over the post-transient orbit for every
    parameter column simultaneously.
    """
    if n_params < 5 or n_params > 5000:
        raise ValueError("n_params must be in [5, 5000]")

    p_axis = np.linspace(p_min, p_max, n_params, dtype=np.float64)

    if map_name == "custom":
        if not custom_expression:
            raise ValueError("Custom Lyapunov sweep requires custom_expression")
        step_fn, deriv_fn = _build_custom_kernels(custom_expression)
        def step(x):  return step_fn(p_axis, x)
        def deriv(x): return deriv_fn(p_axis, x)
    elif map_name in _KERNELS:
        K = _KERNELS[map_name]
        step = K["step"](p_axis)
        deriv_raw = K["deriv"]
        def deriv(x): return deriv_raw(p_axis, x)
    else:
        raise ValueError(f"Unsupported map for Lyapunov sweep: {map_name}")

    x = np.full(n_params, float(x0), dtype=np.float64)
    for _ in range(n_transient):
        x = step(x)
        np.nan_to_num(x, copy=False, nan=0.5, posinf=0.5, neginf=0.5)

    log_sum = np.zeros(n_params, dtype=np.float64)
    tiny = np.finfo(np.float64).tiny
    for _ in range(n_iter):
        d = np.abs(deriv(x))
        d = np.maximum(d, tiny)
        log_sum += np.log(d)
        x = step(x)
        np.nan_to_num(x, copy=False, nan=0.5, posinf=0.5, neginf=0.5)

    lam = log_sum / n_iter

    return {
        "map_id": map_name,
        "p_min": float(p_min),
        "p_max": float(p_max),
        "n_params": int(n_params),
        "param": p_axis.tolist(),
        "lyapunov": lam.tolist(),
    }


# ===========================================================================
# 6.  PERIOD-DOUBLING DETECTION + FEIGENBAUM CONSTANT
# ---------------------------------------------------------------------------
# We detect period-doublings by directly counting the period of the orbit
# at each parameter value: iterate until transients die, then count how
# many distinct values (within tolerance) the orbit visits.  This produces
# 1 (fixed point), 2 (period-2), 4, 8, ... in succession before saturating
# to "many" in the chaotic region.  The rₙ values are the parameter values
# where this count first reaches 2, 4, 8, ...
#
# Lyapunov-zero-crossing detection sounds elegant but does NOT work in
# practice: λ stays negative throughout the entire periodic cascade and
# only crosses zero at the chaos onset.  The period-doublings inside the
# cascade are visible only in the orbit, not in λ.
# ===========================================================================

def _orbit_period_at(
    map_name: str,
    param_value: float,
    x0: float = 0.31415,
    n_transient: int = 2000,
    n_plot: int = 256,
    tol: float = 1e-3,
    custom_expression: str | None = None,
) -> int:
    """
    Iterate the map at a single parameter value, discard transients, then
    count how many distinct attractor points the orbit visits (within `tol`).

    Returns the period (1, 2, 4, 8, ...) or `n_plot` if the orbit looks
    chaotic / non-periodic.
    """
    p_arr = np.array([param_value], dtype=np.float64)

    if map_name == "custom":
        if not custom_expression:
            raise ValueError("Custom orbit-period query requires custom_expression")
        step_fn, _ = _build_custom_kernels(custom_expression)
        def step(x): return step_fn(p_arr, x)
    elif map_name in _KERNELS:
        step = _KERNELS[map_name]["step"](p_arr)
    else:
        raise ValueError(f"Unsupported map: {map_name}")

    x = np.array([float(x0)], dtype=np.float64)
    for _ in range(n_transient):
        x = step(x)
        np.nan_to_num(x, copy=False, nan=0.5, posinf=0.5, neginf=0.5)

    samples = []
    for _ in range(n_plot):
        x = step(x)
        np.nan_to_num(x, copy=False, nan=0.5, posinf=0.5, neginf=0.5)
        samples.append(float(x[0]))

    samples_sorted = np.sort(samples)
    # Count clusters: walk the sorted list, start a new cluster when the gap > tol.
    clusters = 1
    for i in range(1, len(samples_sorted)):
        if samples_sorted[i] - samples_sorted[i - 1] > tol:
            clusters += 1
    return clusters


def detect_period_doublings(
    parameter: np.ndarray,
    lyapunov: np.ndarray,    # kept for backward compat — no longer used
    map_name: str = "logistic",
    max_count: int = 5,
    tol: float = 1e-3,
    custom_expression: str | None = None,
) -> list[float]:
    """
    Find the parameter values rₙ where the orbit's period first becomes
    2, 4, 8, 16, ...

    `parameter` and `lyapunov` arrays remain in the signature for
    backward compatibility, but the algorithm now uses the parameter
    array as a *probing grid* — we evaluate the orbit period at each
    grid point and look for the doublings.

    For best accuracy `parameter` should densely cover the cascade
    region (e.g. 2000+ points on [2.9, 3.57] for logistic).
    """
    p = np.asarray(parameter, dtype=np.float64)
    if p.size < 10:
        return []

    # Probe orbit period at every grid point.  This is N×(transient+plot)
    # iterations; with vectorised kernels and modest grid it runs in <1s.
    targets = [2 ** k for k in range(1, max_count + 1)]  # [2, 4, 8, 16, 32]
    found: list[float] = []
    target_idx = 0

    for r in p:
        if target_idx >= len(targets):
            break
        period = _orbit_period_at(
            map_name, float(r),
            n_transient=1000, n_plot=128, tol=tol,
            custom_expression=custom_expression,
        )
        if period >= targets[target_idx]:
            found.append(float(r))
            target_idx += 1

    return found


def feigenbaum_delta(rn_values: list[float]) -> dict[str, Any]:
    """
    From a list of period-doubling parameter values rₙ, compute the
    successive Feigenbaum ratios

        δₙ = (rₙ - rₙ₋₁) / (rₙ₊₁ - rₙ)

    and the accumulation point a∞ via the geometric-series extrapolation

        a∞ ≈ rₙ + (rₙ - rₙ₋₁) / (δ - 1)

    Need at least 3 rₙ values for a single δ estimate.

    Note: detecting more than the first 2-3 doublings reliably from a
    Lyapunov sweep on a typical [p_min, p_max] requires very high n_params,
    because the spacings between successive rₙ shrink by a factor of δ
    each time.  For the logistic map's first few:
      r₁ = 3.000, r₂ ≈ 3.449, r₃ ≈ 3.544
    """
    if len(rn_values) < 3:
        return {
            "rn": [float(r) for r in rn_values],
            "deltas": [],
            "delta_estimate": None,
            "delta_theoretical": 4.6692016091,
            "a_infinity_estimate": None,
            "a_infinity_theoretical_logistic": 3.5699456718,
            "warning": "Need at least 3 period-doubling values to estimate δ",
        }

    deltas: list[float] = []
    for i in range(1, len(rn_values) - 1):
        num = rn_values[i] - rn_values[i - 1]
        den = rn_values[i + 1] - rn_values[i]
        if abs(den) < 1e-12:
            continue
        deltas.append(float(num / den))

    delta_est = float(deltas[-1]) if deltas else None

    # a∞ extrapolation from the last two ratios
    a_inf = None
    if delta_est and abs(delta_est - 1.0) > 1e-6:
        rn_last = rn_values[-1]
        spacing_last = rn_values[-1] - rn_values[-2]
        a_inf = float(rn_last + spacing_last / (delta_est - 1.0))

    return {
        "rn": [float(r) for r in rn_values],
        "deltas": deltas,
        "delta_estimate": delta_est,
        "delta_theoretical": 4.6692016091,
        "a_infinity_estimate": a_inf,
        "a_infinity_theoretical_logistic": 3.5699456718,
    }


# ===========================================================================
# 7.  PUBLIC ENTRY POINTS
# ===========================================================================

def bifurcation_sweep_matlab(
    map_name: str,
    p_min: float,
    p_max: float,
    n_params: int = 1500,
    n_transient: int = 600,
    n_plot: int = 250,
    x0: float = 0.31415,
    matlab_engine_wrapper: Any = None,
) -> dict[str, Any]:
    """
    MATLAB-accelerated bifurcation sweep.  Calls bifurcation_matlab.m
    via the engine wrapper.  Falls back to NumPy if MATLAB is not
    available — the route handler is responsible for choosing.

    Custom maps are NOT supported on the MATLAB path (would require
    code-generation each call).  Custom expressions always use NumPy.
    """
    if matlab_engine_wrapper is None:
        raise RuntimeError("matlab_engine_wrapper must be supplied")
    if map_name == "custom":
        raise ValueError("Custom maps must use the NumPy backend")
    if map_name not in {"logistic", "tent", "pwlcm", "cubic", "sine", "lss", "tlc", "hybrid"}:
        raise ValueError(f"MATLAB backend does not support map: {map_name}")

    result = matlab_engine_wrapper.call(
        "bifurcation_matlab",
        map_name, float(p_min), float(p_max),
        int(n_params), int(n_transient), int(n_plot),
        float(x0),
        nargout=1,
    )
    # MATLAB returns a struct → converted to dict by _to_numpy.
    # Each field is a 1×N numpy array.
    p_arr = np.asarray(result["param"]).flatten()
    x_arr = np.asarray(result["x"]).flatten()

    # Apply the same downsampling cap as the NumPy path.
    MAX_POINTS = 250_000
    if p_arr.size > MAX_POINTS:
        idx = np.random.default_rng(seed=0).choice(p_arr.size, MAX_POINTS, replace=False)
        idx.sort()
        p_arr = p_arr[idx]
        x_arr = x_arr[idx]

    return {
        "map_id": map_name,
        "backend": "matlab",
        "p_min": float(p_min),
        "p_max": float(p_max),
        "n_params": int(n_params),
        "n_transient": int(n_transient),
        "n_plot": int(n_plot),
        "param": p_arr.tolist(),
        "x": x_arr.tolist(),
    }


def get_bifurcation_explainers() -> dict[str, str]:
    """Frontend-ready concept text for the bifurcation page."""
    return BIFURCATION_EXPLAINERS


def feigenbaum_for_map(
    map_name: str,
    p_min: float,
    p_max: float,
    n_params: int = 1500,
    custom_expression: str | None = None,
) -> dict[str, Any]:
    """
    End-to-end pipeline: λ(r) sweep → period-doubling detection → δ + a∞.
    Returns everything a Feigenbaum panel needs in one shot.

    Implementation note: the orbit-period probing is the expensive step
    (one full transient+plot sweep per probed parameter).  We use a
    coarser probing grid than the displayed Lyapunov sweep — the rₙ
    spacings narrow geometrically, so the first three are easy to find
    but the fourth and fifth need very fine resolution.
    """
    sweep = lyapunov_sweep(
        map_name=map_name,
        p_min=p_min,
        p_max=p_max,
        n_params=n_params,
        custom_expression=custom_expression,
    )
    # Use a coarser grid for orbit-period probing (expensive)
    n_probe = min(n_params, 200)
    probe_grid = np.linspace(p_min, p_max, n_probe)
    rns = detect_period_doublings(
        probe_grid,
        np.zeros_like(probe_grid),  # dummy — no longer used
        map_name=map_name,
        max_count=5,
        custom_expression=custom_expression,
    )
    feig = feigenbaum_delta(rns)
    feig["lyapunov_sweep"] = sweep
    return feig


# ---------------------------------------------------------------------------
# Default parameter ranges per map — sensible defaults for "show me the cascade"
# ---------------------------------------------------------------------------
DEFAULT_RANGES: dict[str, tuple[float, float]] = {
    "logistic":  (2.5, 4.0),
    "tent":      (0.0, 2.0),
    "pwlcm":     (0.01, 0.499),
    "chebyshev": (2.0, 10.0),    # integer-valued, but we handle the float case
    "hybrid":    (0.0, 1.0),
    "cubic":     (1.5, 3.0),
    "sine":      (0.0, 4.0),
    "lss":       (0.0, 4.0),
    "tlc":       (0.0, 4.0),
    # Bernoulli has no parameter; the bifurcation diagram is undefined.
}


def default_range_for(map_name: str) -> tuple[float, float]:
    if map_name not in DEFAULT_RANGES:
        raise ValueError(f"No default bifurcation range defined for map {map_name!r}")
    return DEFAULT_RANGES[map_name]
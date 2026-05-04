"""
core/quantization.py — From continuous chaos to discrete symbols.

This module bridges chaotic dynamics and digital communication.  Chaotic
maps produce continuous values in [0,1]; digital transmission requires
discrete levels.  Quantization maps continuous x → discrete x̂ = Q(x).

Five quantization methods implemented:

1. UNIFORM (Midrise and Midtread)
   The simplest: divide [0,1] into N equal bins.
   MSE = Δ²/12 for a uniform PDF;  SQNR = 6.02·B + 1.76 dB

2. μ-LAW COMPANDING (ITU-T G.711, North America)
   Compresses dynamic range before uniform quantization.
   F(x) = sgn(x)·log(1+μ|x|)/log(1+μ),  μ = 255

3. A-LAW COMPANDING (ITU-T G.711, Europe)
   Similar to μ-law with slightly different characteristic.

4. LLOYD-MAX OPTIMAL (the star of this module)
   Minimizes MSE for a *given* PDF.  Iterates:
     Step 1: compute centroids (reconstruction levels)
     Step 2: recompute boundaries as midpoints
     Step 3: repeat until MSE converges
   The PDF comes from core/pdf_estimator.py — which estimates the
   map's invariant measure.  So logistic@r=4 gets arcsine-optimal
   boundaries, tent gets uniform-optimal (= plain uniform).

5. SQNR ANALYSIS
   Signal-to-Quantization-Noise Ratio = 6.02·B + 1.76 dB for uniform
   quantization of a uniform PDF.  For non-uniform PDFs, SQNR depends
   on the match between the quantizer and the signal's statistics.

LEARNER EXPLAINER (top-level):
  Imagine you have a chaotic signal that takes values like 0.3141592653...
  but you can only transmit one of 8 possible levels (3 bits).  Which 8
  levels should you pick?  If the signal visits all values equally (tent
  map), equally-spaced levels are optimal.  But if the signal spends more
  time near x=0 and x=1 (logistic map), you should pack more levels near
  the edges and fewer in the middle.  That's what Lloyd-Max does: it
  reads the signal's probability density and places levels where they
  minimize the average squared error.
"""

from __future__ import annotations

import math
import warnings
from typing import Any

import numpy as np
from scipy.integrate import quad
from scipy.interpolate import interp1d


# ===========================================================================
# CONCEPT EXPLAINERS
# ===========================================================================

QUANTIZATION_EXPLAINERS: dict[str, str] = {
    "what_is_quantization": (
        "Quantization is the process of mapping a continuous value to one of a "
        "finite set of discrete levels.  Every digital system does this: your "
        "microphone, your camera sensor, and our chaotic transmitter.  The "
        "quantization error ε = x − Q(x) is the price of going digital.  The "
        "goal is to make that error as small as possible with as few bits as "
        "possible."
    ),
    "sqnr_formula": (
        "SQNR = 6.02·B + 1.76 dB is one of the most cited formulas in signal "
        "processing.  It says: every extra bit of resolution buys you about "
        "6 dB of signal-to-noise improvement — but ONLY if the signal's PDF "
        "is uniform AND you use uniform quantization.  For a non-uniform PDF "
        "(like the logistic map's arcsine distribution), uniform quantization "
        "wastes levels in low-probability regions and the actual SQNR is worse "
        "than this formula predicts.  Lloyd-Max fixes this."
    ),
    "lloyd_max": (
        "Lloyd-Max quantization (Stuart Lloyd, 1957; Joel Max, 1960) is an "
        "iterative algorithm that finds the quantization levels that minimize "
        "the mean squared error for a given probability density.  It alternates "
        "two steps: (1) given the decision boundaries, compute the centroids "
        "(probability-weighted centers) of each bin — these are the optimal "
        "reconstruction levels; (2) given the reconstruction levels, recompute "
        "the boundaries as midpoints between adjacent levels.  Repeat until "
        "MSE converges.  The result is always at least as good as uniform "
        "quantization, and often dramatically better for non-uniform PDFs."
    ),
    "mu_law": (
        "μ-law companding (ITU-T G.711) is used in North American telephone "
        "networks.  It compresses the input through a logarithmic curve before "
        "uniform quantization, then expands it at the receiver.  The effect: "
        "small signals get more quantization levels (better resolution) while "
        "large signals get fewer (acceptable distortion).  This gives roughly "
        "constant SNR across a wide dynamic range — 30+ dB improvement for "
        "speech signals compared to uniform quantization at the same bit rate."
    ),
    "a_law": (
        "A-law companding (ITU-T G.711) is the European counterpart to μ-law. "
        "It uses a slightly different compression curve — linear for very small "
        "signals, logarithmic for larger ones.  In practice A-law and μ-law "
        "perform similarly; the choice is a legacy of different telephone "
        "standards."
    ),
    "quantization_for_csk": (
        "For CSK, quantization serves a specific purpose: the chaotic carrier "
        "must be transmitted digitally, so each sample x_n must be mapped to "
        "a finite number of bits.  The quantizer's job is to preserve as much "
        "of the signal's chaotic structure as possible with the fewest bits.  "
        "A badly-chosen quantizer can destroy the correlation properties that "
        "the matched filter relies on — effectively turning your carefully "
        "designed chaotic waveform into noise that not even the receiver can "
        "decode.  Lloyd-Max matched to the map's invariant measure is the "
        "right answer."
    ),
}


# ===========================================================================
# 1.  UNIFORM QUANTIZATION
# ===========================================================================

def uniform_midrise(x: np.ndarray, n_levels: int,
                    domain: tuple[float, float] = (0.0, 1.0)) -> dict[str, Any]:
    """
    Midrise uniform quantizer: no level sits exactly on zero.

    Q(x) = Δ · (⌊x/Δ⌋ + 0.5)
    where Δ = (xmax − xmin) / N

    Returns quantized values, boundaries, reconstruction levels, MSE.
    """
    lo, hi = domain
    delta = (hi - lo) / n_levels
    boundaries = np.linspace(lo, hi, n_levels + 1)
    levels = np.array([lo + (k + 0.5) * delta for k in range(n_levels)])

    x_arr = np.asarray(x, dtype=np.float64)
    indices = np.clip(((x_arr - lo) / delta).astype(int), 0, n_levels - 1)
    x_hat = levels[indices]
    mse = float(np.mean((x_arr - x_hat) ** 2))

    return {
        "method": "uniform_midrise",
        "n_levels": n_levels,
        "n_bits": math.ceil(math.log2(max(n_levels, 2))),
        "delta": float(delta),
        "boundaries": boundaries.tolist(),
        "levels": levels.tolist(),
        "quantized": x_hat.tolist(),
        "mse": mse,
        "sqnr_db": float(10 * np.log10(np.var(x_arr) / mse)) if mse > 0 else float("inf"),
    }


def uniform_midtread(x: np.ndarray, n_levels: int,
                     domain: tuple[float, float] = (0.0, 1.0)) -> dict[str, Any]:
    """
    Midtread uniform quantizer: a level sits exactly on zero (or the
    domain center).

    Q(x) = Δ · round(x / Δ)
    """
    lo, hi = domain
    delta = (hi - lo) / (n_levels - 1) if n_levels > 1 else (hi - lo)
    levels = np.linspace(lo, hi, n_levels)
    boundaries = np.concatenate([
        [lo],
        [(levels[k] + levels[k + 1]) / 2 for k in range(n_levels - 1)],
        [hi],
    ])

    x_arr = np.asarray(x, dtype=np.float64)
    indices = np.clip(np.round((x_arr - lo) / delta).astype(int), 0, n_levels - 1)
    x_hat = levels[indices]
    mse = float(np.mean((x_arr - x_hat) ** 2))

    return {
        "method": "uniform_midtread",
        "n_levels": n_levels,
        "n_bits": math.ceil(math.log2(max(n_levels, 2))),
        "delta": float(delta),
        "boundaries": boundaries.tolist(),
        "levels": levels.tolist(),
        "quantized": x_hat.tolist(),
        "mse": mse,
        "sqnr_db": float(10 * np.log10(np.var(x_arr) / mse)) if mse > 0 else float("inf"),
    }


# ===========================================================================
# 2.  μ-LAW AND A-LAW COMPANDING
# ===========================================================================

def mu_law_quantize(x: np.ndarray, n_levels: int, mu: float = 255.0,
                    domain: tuple[float, float] = (0.0, 1.0)) -> dict[str, Any]:
    """
    μ-law companding + uniform quantization.

    Compress:   F(x) = sgn(x) · log(1 + μ|x|) / log(1 + μ)
    Then uniform-quantize the compressed signal.
    Expand:     F⁻¹(y) = sgn(y) · (1/μ) · ((1+μ)^|y| − 1)
    """
    lo, hi = domain
    x_arr = np.asarray(x, dtype=np.float64)

    # Normalize to [-1, 1]
    x_norm = 2.0 * (x_arr - lo) / (hi - lo) - 1.0

    # Compress
    compressed = np.sign(x_norm) * np.log(1.0 + mu * np.abs(x_norm)) / np.log(1.0 + mu)

    # Uniform quantize the compressed signal on [-1, 1]
    delta = 2.0 / n_levels
    indices = np.clip(((compressed + 1.0) / delta).astype(int), 0, n_levels - 1)
    comp_levels = np.linspace(-1.0 + delta / 2, 1.0 - delta / 2, n_levels)
    comp_hat = comp_levels[indices]

    # Expand back
    expanded = np.sign(comp_hat) * (1.0 / mu) * ((1.0 + mu) ** np.abs(comp_hat) - 1.0)

    # Rescale to original domain
    x_hat = (expanded + 1.0) / 2.0 * (hi - lo) + lo
    mse = float(np.mean((x_arr - x_hat) ** 2))

    return {
        "method": "mu_law",
        "mu": float(mu),
        "n_levels": n_levels,
        "n_bits": math.ceil(math.log2(max(n_levels, 2))),
        "quantized": x_hat.tolist(),
        "mse": mse,
        "sqnr_db": float(10 * np.log10(np.var(x_arr) / mse)) if mse > 0 else float("inf"),
    }


def a_law_quantize(x: np.ndarray, n_levels: int, A: float = 87.6,
                   domain: tuple[float, float] = (0.0, 1.0)) -> dict[str, Any]:
    """
    A-law companding + uniform quantization.

    F(x) = A|x|/(1+log A)         for |x| ≤ 1/A
    F(x) = (1+log(A|x|))/(1+logA) for 1/A < |x| ≤ 1
    """
    lo, hi = domain
    x_arr = np.asarray(x, dtype=np.float64)
    x_norm = 2.0 * (x_arr - lo) / (hi - lo) - 1.0

    abs_x = np.abs(x_norm)
    denom = 1.0 + np.log(A)
    compressed = np.where(
        abs_x <= 1.0 / A,
        A * abs_x / denom,
        (1.0 + np.log(A * np.maximum(abs_x, 1e-15))) / denom,
    )
    compressed = np.sign(x_norm) * compressed

    # Uniform quantize compressed signal
    delta = 2.0 / n_levels
    indices = np.clip(((compressed + 1.0) / delta).astype(int), 0, n_levels - 1)
    comp_levels = np.linspace(-1.0 + delta / 2, 1.0 - delta / 2, n_levels)
    comp_hat = comp_levels[indices]

    # Expand — inverse of A-law
    abs_comp = np.abs(comp_hat)
    expanded = np.where(
        abs_comp < 1.0 / (1.0 + np.log(A)),
        abs_comp * (1.0 + np.log(A)) / A,
        np.exp(abs_comp * (1.0 + np.log(A)) - 1.0) / A,
    )
    expanded = np.sign(comp_hat) * expanded

    x_hat = (expanded + 1.0) / 2.0 * (hi - lo) + lo
    mse = float(np.mean((x_arr - x_hat) ** 2))

    return {
        "method": "a_law",
        "A": float(A),
        "n_levels": n_levels,
        "n_bits": math.ceil(math.log2(max(n_levels, 2))),
        "quantized": x_hat.tolist(),
        "mse": mse,
        "sqnr_db": float(10 * np.log10(np.var(x_arr) / mse)) if mse > 0 else float("inf"),
    }


# ===========================================================================
# 3.  LLOYD-MAX OPTIMAL QUANTIZATION
# ===========================================================================

def lloyd_max(
    x: np.ndarray,
    n_levels: int,
    pdf_x: np.ndarray | None = None,
    pdf_density: np.ndarray | None = None,
    domain: tuple[float, float] = (0.0, 1.0),
    max_iterations: int = 200,
    tol: float = 1e-6,
) -> dict[str, Any]:
    """
    Lloyd-Max optimal quantizer matched to a given PDF.

    Algorithm (iterate until convergence):
      1. Given boundaries {t_k}, compute optimal reconstruction levels:
           r_k = ∫[t_k to t_{k+1}] x·p(x) dx  /  ∫[t_k to t_{k+1}] p(x) dx
      2. Given levels {r_k}, recompute boundaries:
           t_k = (r_{k-1} + r_k) / 2

    If pdf_x / pdf_density are not provided, falls back to a histogram-
    based density estimate from the orbit itself.

    Returns the full iteration history so the frontend can animate the
    convergence step by step.
    """
    lo, hi = domain
    x_arr = np.asarray(x, dtype=np.float64)

    # Build a continuous PDF function from the supplied grid (or estimate)
    if pdf_x is not None and pdf_density is not None:
        px = np.asarray(pdf_x, dtype=np.float64)
        pd = np.asarray(pdf_density, dtype=np.float64)
        pd = np.maximum(pd, 0.0)
        # Normalize
        dx = px[1] - px[0] if len(px) > 1 else 1.0
        total = np.sum(pd) * dx
        if total > 0:
            pd = pd / total
        pdf_func = interp1d(px, pd, kind="linear", bounds_error=False, fill_value=0.0)
    else:
        # Fall back to histogram estimate
        n_bins = min(200, max(50, len(x_arr) // 20))
        counts, edges = np.histogram(x_arr, bins=n_bins, range=(lo, hi), density=True)
        centers = (edges[:-1] + edges[1:]) / 2.0
        pdf_func = interp1d(centers, counts, kind="linear", bounds_error=False, fill_value=0.0)

    # Initialize: uniform boundaries
    boundaries = np.linspace(lo, hi, n_levels + 1)
    levels = np.zeros(n_levels)
    iteration_history = []

    for iteration in range(max_iterations):
        # Step 1: compute centroids (reconstruction levels)
        for k in range(n_levels):
            t_lo, t_hi = boundaries[k], boundaries[k + 1]
            if t_hi - t_lo < 1e-14:
                levels[k] = (t_lo + t_hi) / 2.0
                continue
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                num, _ = quad(lambda v: v * pdf_func(v), t_lo, t_hi, limit=100)
                den, _ = quad(lambda v: pdf_func(v), t_lo, t_hi, limit=100)
            levels[k] = num / den if den > 1e-15 else (t_lo + t_hi) / 2.0

        # Step 2: recompute boundaries as midpoints
        new_boundaries = boundaries.copy()
        for k in range(1, n_levels):
            new_boundaries[k] = (levels[k - 1] + levels[k]) / 2.0

        # Compute MSE for this iteration
        indices = np.clip(
            np.searchsorted(new_boundaries[1:-1], x_arr),
            0, n_levels - 1,
        )
        x_hat = levels[indices]
        mse = float(np.mean((x_arr - x_hat) ** 2))

        iteration_history.append({
            "iteration": iteration,
            "boundaries": new_boundaries.tolist(),
            "levels": levels.copy().tolist(),
            "mse": mse,
        })

        # Convergence check
        boundary_shift = float(np.max(np.abs(new_boundaries - boundaries)))
        boundaries = new_boundaries
        if boundary_shift < tol:
            break

    # Final quantization with converged levels
    indices = np.clip(
        np.searchsorted(boundaries[1:-1], x_arr),
        0, n_levels - 1,
    )
    x_hat = levels[indices]
    mse = float(np.mean((x_arr - x_hat) ** 2))

    return {
        "method": "lloyd_max",
        "n_levels": n_levels,
        "n_bits": math.ceil(math.log2(max(n_levels, 2))),
        "boundaries": boundaries.tolist(),
        "levels": levels.tolist(),
        "quantized": x_hat.tolist(),
        "mse": mse,
        "sqnr_db": float(10 * np.log10(np.var(x_arr) / mse)) if mse > 0 else float("inf"),
        "iterations": len(iteration_history),
        "converged": len(iteration_history) < max_iterations,
        "iteration_history": iteration_history,
    }


# ===========================================================================
# 4.  SQNR FORMULA + COMPARISON UTILITIES
# ===========================================================================

def sqnr_theoretical(n_bits: int) -> float:
    """SQNR = 6.02·B + 1.76 dB (uniform quantization, uniform PDF)."""
    return 6.02 * n_bits + 1.76


def mse_vs_levels(
    x: np.ndarray,
    levels_list: list[int],
    methods: list[str] = None,
    pdf_x: np.ndarray | None = None,
    pdf_density: np.ndarray | None = None,
    domain: tuple[float, float] = (0.0, 1.0),
) -> dict[str, Any]:
    """
    Compute MSE and SQNR for each method at each level count.

    Returns a table that the frontend can plot as MSE-vs-N curves
    (one line per method), demonstrating that Lloyd-Max is always ≤
    uniform and often dramatically better.
    """
    if methods is None:
        methods = ["uniform_midrise", "mu_law", "lloyd_max"]

    results = {}
    x_arr = np.asarray(x, dtype=np.float64)

    for method in methods:
        curve = []
        for n in levels_list:
            if n < 2:
                continue
            if method == "uniform_midrise":
                r = uniform_midrise(x_arr, n, domain)
            elif method == "uniform_midtread":
                r = uniform_midtread(x_arr, n, domain)
            elif method == "mu_law":
                r = mu_law_quantize(x_arr, n, domain=domain)
            elif method == "a_law":
                r = a_law_quantize(x_arr, n, domain=domain)
            elif method == "lloyd_max":
                r = lloyd_max(x_arr, n, pdf_x, pdf_density, domain, max_iterations=50)
            else:
                continue
            curve.append({
                "n_levels": n,
                "n_bits": r["n_bits"],
                "mse": r["mse"],
                "sqnr_db": r["sqnr_db"],
            })
        results[method] = curve

    # Add theoretical SQNR line for comparison
    results["theoretical_uniform"] = [
        {
            "n_levels": n,
            "n_bits": math.ceil(math.log2(max(n, 2))),
            "sqnr_db": sqnr_theoretical(math.ceil(math.log2(max(n, 2)))),
        }
        for n in levels_list if n >= 2
    ]

    return results


# ===========================================================================
# 5.  PUBLIC ENTRY POINT — single request for quantization of a chaotic orbit
# ===========================================================================

def quantize_orbit(
    orbit: np.ndarray,
    method: str,
    n_levels: int,
    pdf_x: np.ndarray | None = None,
    pdf_density: np.ndarray | None = None,
    domain: tuple[float, float] = (0.0, 1.0),
    **kwargs,
) -> dict[str, Any]:
    """
    Quantize a chaotic orbit using the specified method.

    Methods: "uniform_midrise", "uniform_midtread", "mu_law", "a_law", "lloyd_max"
    """
    x = np.asarray(orbit, dtype=np.float64)
    if method == "uniform_midrise":
        return uniform_midrise(x, n_levels, domain)
    elif method == "uniform_midtread":
        return uniform_midtread(x, n_levels, domain)
    elif method == "mu_law":
        return mu_law_quantize(x, n_levels, domain=domain, **kwargs)
    elif method == "a_law":
        return a_law_quantize(x, n_levels, domain=domain, **kwargs)
    elif method == "lloyd_max":
        return lloyd_max(x, n_levels, pdf_x, pdf_density, domain, **kwargs)
    else:
        raise ValueError(f"Unknown quantization method: {method}")


def get_quantization_explainers() -> dict[str, str]:
    return QUANTIZATION_EXPLAINERS
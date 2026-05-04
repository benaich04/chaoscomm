"""
core/pdf_estimator.py — Probability density estimation from chaotic orbits.

This module takes a raw orbit (a sequence of iterates from any chaotic
map) and estimates the map's invariant measure — the probability density
function (PDF) that describes where the trajectory spends its time.

Two estimation approaches:

1. KDE (Kernel Density Estimation) — nonparametric, works for any map.
   Uses scipy.stats.gaussian_kde with automatic bandwidth selection.
   This is the default and is always correct, though slightly noisy.

2. Parametric fitting — fits a known distribution family to the data.
   For specific maps we know the analytical form:
     - Logistic at r=4:  arcsine on [0,1]  →  Beta(0.5, 0.5)
     - Tent at μ=2:      uniform on [0,1]
     - Chebyshev T_n:    arcsine on [-1,1]
   Parametric fits are smoother and more accurate when the assumption
   holds, but wrong when it doesn't.  The module tries both and reports
   which one the user should trust.

The estimated PDF is used by Lloyd-Max quantization (core/quantization.py)
to place decision boundaries optimally: more levels where the density is
high, fewer where it's low.

LEARNER EXPLAINER:
  Think of the PDF as an answer to "if I pick a random iterate from a
  very long orbit, how likely is it to be near x?"  For the logistic
  map at r=4, the orbit spends most of its time near x=0 and x=1 (the
  edges) and rushes through x=0.5 (the middle).  The PDF captures this:
  it's high at the edges and low in the middle — the famous arcsine
  distribution.  For the tent map at μ=2, the orbit visits every x
  equally often — uniform distribution.  Knowing this shape is the key
  to optimal quantization: put more quantization levels where the orbit
  visits most.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy.stats import gaussian_kde, beta, uniform, kstest


# ===========================================================================
# 1.  KDE (non-parametric, always works)
# ===========================================================================

def estimate_kde(
    orbit: np.ndarray,
    n_eval: int = 200,
    domain: tuple[float, float] = (0.0, 1.0),
    transient: int = 200,
) -> dict[str, Any]:
    """
    Estimate the PDF of the orbit's invariant measure using Gaussian KDE.

    Returns:
        x_grid:  ndarray of shape (n_eval,) — evaluation points
        density: ndarray of shape (n_eval,) — estimated p(x)
        bandwidth: float — KDE bandwidth (Scott's rule)
    """
    samples = np.asarray(orbit[transient:], dtype=np.float64)
    samples = samples[np.isfinite(samples)]
    if len(samples) < 50:
        raise ValueError("Need at least 50 post-transient samples for KDE")

    lo, hi = domain
    # Clip to domain (some numerical maps escape slightly)
    samples = np.clip(samples, lo + 1e-12, hi - 1e-12)

    kde = gaussian_kde(samples, bw_method="scott")
    x_grid = np.linspace(lo, hi, n_eval)
    density = kde(x_grid)

    # Normalize so ∫ p(x) dx ≈ 1 on the grid
    dx = x_grid[1] - x_grid[0]
    total = np.sum(density) * dx
    if total > 0:
        density = density / total

    return {
        "x": x_grid,
        "density": density,
        "bandwidth": float(kde.factor),
        "method": "kde",
        "n_samples": int(len(samples)),
    }


# ===========================================================================
# 2.  PARAMETRIC FITTING
# ===========================================================================

# Known analytical PDFs for specific (map, parameter) combinations.
KNOWN_PDFS = {
    "logistic_r4": {
        "name": "Arcsine (Beta(0.5, 0.5))",
        "latex": r"p(x) = \frac{1}{\pi\sqrt{x(1-x)}}",
        "family": "beta",
        "params": {"a": 0.5, "b": 0.5},
        "domain": (0, 1),
        "learner": (
            "At r=4, the logistic map's orbit spends the most time near "
            "x=0 and x=1 (the turning points of the parabola) and rushes "
            "through x=0.5. This is the arcsine distribution — a special "
            "case of the Beta distribution with parameters (0.5, 0.5)."
        ),
    },
    "tent_mu2": {
        "name": "Uniform",
        "latex": r"p(x) = 1 \quad \text{for } x \in [0,1]",
        "family": "uniform",
        "params": {},
        "domain": (0, 1),
        "learner": (
            "At μ=2, the tent map visits every x equally often — the "
            "invariant measure is perfectly uniform.  This means uniform "
            "quantization is already optimal (Lloyd-Max = uniform)."
        ),
    },
    "pwlcm_any": {
        "name": "Uniform",
        "latex": r"p(x) = 1 \quad \text{for } x \in [0,1]",
        "family": "uniform",
        "params": {},
        "domain": (0, 1),
        "learner": (
            "PWLCM is engineered to have a perfectly uniform invariant "
            "measure for any value of p.  Uniform quantization is optimal."
        ),
    },
    "chebyshev_any": {
        "name": "Arcsine on [-1,1]",
        "latex": r"p(x) = \frac{1}{\pi\sqrt{1-x^2}}",
        "family": "arcsine_symmetric",
        "params": {},
        "domain": (-1, 1),
        "learner": (
            "Chebyshev maps always produce the arcsine distribution on "
            "[-1,1], peaked at both endpoints.  This is the natural measure "
            "of the cos(n·arccos(x)) dynamics."
        ),
    },
}


def _identify_known_pdf(map_name: str, parameters: dict) -> dict | None:
    """Try to match the (map, params) to a known analytical PDF."""
    if map_name == "logistic" and abs(parameters.get("r", 0) - 4.0) < 0.001:
        return KNOWN_PDFS["logistic_r4"]
    if map_name == "tent" and abs(parameters.get("mu", 0) - 2.0) < 0.001:
        return KNOWN_PDFS["tent_mu2"]
    if map_name == "pwlcm":
        return KNOWN_PDFS["pwlcm_any"]
    if map_name == "chebyshev":
        return KNOWN_PDFS["chebyshev_any"]
    return None


def fit_parametric(
    orbit: np.ndarray,
    domain: tuple[float, float] = (0.0, 1.0),
    transient: int = 200,
) -> dict[str, Any]:
    """
    Fit several parametric distribution families and return the best.
    Uses the Kolmogorov-Smirnov test to rank fits.

    Returns dict with:
        family, params, ks_statistic, ks_pvalue, x, density
    """
    samples = np.asarray(orbit[transient:], dtype=np.float64)
    samples = samples[np.isfinite(samples)]
    lo, hi = domain
    samples = np.clip(samples, lo + 1e-12, hi - 1e-12)

    if len(samples) < 50:
        raise ValueError("Need at least 50 samples for parametric fitting")

    # Scale samples to [0,1] for Beta fitting
    scaled = (samples - lo) / (hi - lo)
    scaled = np.clip(scaled, 1e-6, 1 - 1e-6)

    results = []

    # Try Beta distribution
    try:
        a_hat, b_hat, loc, scale = beta.fit(scaled, floc=0, fscale=1)
        ks_stat, ks_p = kstest(scaled, "beta", args=(a_hat, b_hat))
        results.append({
            "family": "beta",
            "params": {"a": float(a_hat), "b": float(b_hat)},
            "ks_statistic": float(ks_stat),
            "ks_pvalue": float(ks_p),
        })
    except Exception:
        pass

    # Try uniform
    try:
        ks_stat, ks_p = kstest(scaled, "uniform")
        results.append({
            "family": "uniform",
            "params": {},
            "ks_statistic": float(ks_stat),
            "ks_pvalue": float(ks_p),
        })
    except Exception:
        pass

    if not results:
        return {"family": "unknown", "params": {}, "ks_statistic": 1.0, "ks_pvalue": 0.0}

    # Pick best by highest p-value (least likely to reject the fit)
    best = max(results, key=lambda r: r["ks_pvalue"])

    # Generate the fitted density curve
    x_grid = np.linspace(0, 1, 200)
    if best["family"] == "beta":
        density = beta.pdf(x_grid, best["params"]["a"], best["params"]["b"])
    elif best["family"] == "uniform":
        density = np.ones_like(x_grid)
    else:
        density = np.ones_like(x_grid)

    # Rescale x_grid to the original domain
    x_domain = x_grid * (hi - lo) + lo
    density_domain = density / (hi - lo)  # adjust for domain width

    best["x"] = x_domain
    best["density"] = density_domain
    return best


# ===========================================================================
# 3.  PUBLIC ENTRY POINT — combines KDE + parametric + known-PDF lookup
# ===========================================================================

def estimate_pdf(
    orbit: np.ndarray,
    map_name: str = "",
    parameters: dict = None,
    domain: tuple[float, float] = (0.0, 1.0),
    n_eval: int = 200,
    transient: int = 200,
) -> dict[str, Any]:
    """
    Full PDF estimation pipeline.  Returns KDE density, optional parametric
    fit, and (when available) the known analytical PDF.

    This is what the Lloyd-Max quantizer consumes.
    """
    parameters = parameters or {}
    result = {}

    # KDE (always)
    kde_result = estimate_kde(orbit, n_eval=n_eval, domain=domain, transient=transient)
    # Sanitize for JSON (arcsine PDFs can produce inf at boundaries)
    kde_density = np.nan_to_num(np.asarray(kde_result["density"]), nan=0.0, posinf=0.0, neginf=0.0)
    result["kde"] = {
        "x": kde_result["x"].tolist(),
        "density": kde_density.tolist(),
        "bandwidth": kde_result["bandwidth"],
        "n_samples": kde_result["n_samples"],
    }

    # Parametric fit
    try:
        para = fit_parametric(orbit, domain=domain, transient=transient)
        para_density = np.nan_to_num(np.asarray(para["density"]), nan=0.0, posinf=0.0, neginf=0.0)
        result["parametric"] = {
            "family": para["family"],
            "params": para["params"],
            "ks_statistic": para["ks_statistic"],
            "ks_pvalue": para["ks_pvalue"],
            "x": para["x"].tolist(),
            "density": para_density.tolist(),
        }
    except Exception:
        result["parametric"] = None

    # Known analytical PDF
    known = _identify_known_pdf(map_name, parameters)
    if known:
        lo, hi = domain
        x_grid = np.linspace(lo + 1e-6, hi - 1e-6, n_eval)
        if known["family"] == "beta":
            scaled = (x_grid - lo) / (hi - lo)
            density = beta.pdf(scaled, known["params"]["a"], known["params"]["b"]) / (hi - lo)
        elif known["family"] == "uniform":
            density = np.ones(n_eval) / (hi - lo)
        elif known["family"] == "arcsine_symmetric":
            density = 1.0 / (np.pi * np.sqrt(1.0 - x_grid ** 2 + 1e-12))
            dx = x_grid[1] - x_grid[0]
            density = density / (np.sum(density) * dx)
        else:
            density = np.ones(n_eval) / (hi - lo)

        # Sanitize for JSON (arcsine has singularities)
        density = np.nan_to_num(density, nan=0.0, posinf=0.0, neginf=0.0)

        result["known_analytical"] = {
            "name": known["name"],
            "latex": known["latex"],
            "learner": known["learner"],
            "x": x_grid.tolist(),
            "density": density.tolist(),
        }
    else:
        result["known_analytical"] = None

    return result
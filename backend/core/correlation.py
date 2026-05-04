"""
core/correlation.py — Correlation Analysis for Chaotic Sequences.

This module computes the correlation properties of chaotic sequences —
the mathematical foundation of why chaos is useful for spread-spectrum
communication and radar.

A good spreading sequence for CSK must have:
  1. Sharp autocorrelation peak at lag 0, near-zero elsewhere (δ-function like)
  2. Low cross-correlation between different sequences (bit 0 sequence vs bit 1)

Chaotic sequences approximate these properties — not as well as Gold codes
or m-sequences in the short run, but with the advantage of an infinite number
of distinct sequences (any x₀ gives a new sequence) and no algebraic
structure for an adversary to exploit.

Computed quantities:

AUTOCORRELATION
  R_xx[k] = Σ_n x[n]·x[n+k]   (unnormalized)
  or normalized: R̂_xx[k] = R_xx[k] / R_xx[0]
  Ideal: R̂_xx[k] = δ[k] (1 at k=0, 0 elsewhere)

CROSS-CORRELATION
  R_xy[k] = Σ_n x[n]·y[n+k]
  Ideal: R_xy[k] ≈ 0 for all k (sequences are orthogonal)

MERIT FACTOR (Golay 1972)
  F = R_xx[0]² / (2 · Σ_{k≠0} R_xx[k]²)
  Higher is better.  m-sequences achieve F ≈ 1 asymptotically.
  Chaotic sequences typically F ∈ [0.5, 3].

PEAK SIDELOBE LEVEL (PSL)
  PSL = max_{k≠0} |R_xx[k]| / R_xx[0]
  Lower is better.  Ideal sequence: PSL = 0.

AMBIGUITY FUNCTION (radar / joint delay-Doppler)
  χ(τ, ν) = |∫ x(t)·x*(t−τ)·exp(j2πνt) dt|
  Shows how the matched filter responds to targets at delay τ and
  Doppler shift ν simultaneously.  Good radar waveform: thumbtack shape
  (sharp peak at (0,0), low everywhere else).

LEARNER EXPLAINER:
  Correlation is the mathematical way of asking "how similar are two
  signals at different time offsets?"  If you slide a copy of signal x
  past itself and multiply+sum at each offset, you get the
  autocorrelation.  A chaotic sequence has a beautiful property: its
  autocorrelation is large only when the sequences are perfectly aligned
  (offset = 0).  At any other offset, the values are nearly random and
  the sum is near zero.  This property — sharp peak, low sidelobes —
  is exactly what makes a good radar pulse and a good spread-spectrum
  code.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np


# ===========================================================================
# CONCEPT EXPLAINERS
# ===========================================================================

CORRELATION_EXPLAINERS: dict[str, str] = {
    "autocorrelation": (
        "Autocorrelation measures how much a signal resembles itself when shifted "
        "in time.  R_xx[k] = Σ x[n]·x[n+k].  At lag k=0 you get the maximum "
        "(the signal perfectly matches itself).  At any other lag, a 'good' "
        "spreading sequence should have near-zero correlation.  This sharpness "
        "is the property that allows a receiver to synchronize to the sequence "
        "by scanning lags until it finds the correlation peak."
    ),
    "cross_correlation": (
        "Cross-correlation measures similarity between two DIFFERENT signals: "
        "R_xy[k] = Σ x[n]·y[n+k].  For CSK, x might be the template for bit 0 "
        "and y the template for bit 1.  Low cross-correlation means the receiver "
        "can tell them apart even in noise.  Ideally R_xy[k] ≈ 0 for all k — "
        "the sequences are orthogonal.  In practice, chaotic sequences achieve "
        "low (but not zero) cross-correlation."
    ),
    "merit_factor": (
        "The Merit Factor (Golay, 1972) summarizes autocorrelation quality in a "
        "single number: F = R[0]² / (2·Σ_{k≠0} R[k]²).  It's the ratio of "
        "mainlobe energy to sidelobe energy.  Larger F = better sequence.  "
        "Perfectly random binary sequences achieve F ≈ 1.  The best known "
        "sequences (Legendre sequences) approach F ≈ 6.  Chaotic sequences "
        "typically fall between 0.5 and 3 depending on the map and parameter — "
        "not the best, but with an infinite supply of distinct sequences."
    ),
    "peak_sidelobe": (
        "The Peak Sidelobe Level (PSL) is the ratio of the largest off-peak "
        "autocorrelation value to the mainlobe peak: PSL = max_{k≠0}|R[k]|/R[0].  "
        "Lower is better.  For radar, a high sidelobe could be mistaken for a "
        "second target next to a bright one.  For CSK, a high sidelobe means "
        "the receiver might mistake a slightly-offset sequence for a hit."
    ),
    "ambiguity_function": (
        "The ambiguity function χ(τ,ν) shows how the matched filter responds to "
        "a target at delay τ AND Doppler shift ν simultaneously.  The ideal "
        "radar waveform has a 'thumbtack' ambiguity function: a sharp peak at "
        "(0,0) and near-zero everywhere else.  Chaotic waveforms have excellent "
        "ambiguity properties because the spectrum is flat — no periodic "
        "structure that would cause ambiguity ridges at specific delays or "
        "Dopplers.  This is one reason chaotic radar outperforms sinusoidal "
        "radar in range-Doppler resolution."
    ),
    "chaos_vs_pn_sequences": (
        "Pseudonoise (PN) sequences like Gold codes or m-sequences are the "
        "classic spread-spectrum codes.  They have provably low cross-correlation "
        "(Welch bound) and high merit factor (up to ~6).  Chaotic sequences have "
        "lower merit factor (~1-3) but offer infinite code space (vs 2^n − 1 for "
        "m-sequences), unpredictability without a register structure, and "
        "parameter-tunable statistics.  For LPI (Low Probability of Intercept) "
        "applications, the absence of algebraic structure is a security feature."
    ),
}


# ===========================================================================
# HELPERS
# ===========================================================================

def _normalize(r: np.ndarray) -> np.ndarray:
    """Normalize correlation to [-1, 1] by dividing by zero-lag value."""
    peak = r[len(r) // 2] if len(r) % 2 == 1 else r[len(r) // 2]
    if abs(peak) < 1e-15:
        return r
    return r / abs(peak)


def _json_safe(x: float) -> float:
    """Replace inf/nan with large finite values for JSON serialization."""
    if not math.isfinite(x):
        return 0.0
    return float(x)


# ===========================================================================
# 1.  AUTOCORRELATION
# ===========================================================================

def autocorrelation(
    sequence: np.ndarray,
    normalize: bool = True,
    max_lag: int | None = None,
) -> dict[str, Any]:
    """
    Compute the autocorrelation of a sequence.

    R_xx[k] = Σ_n x[n] · x[n+k]

    Returns lags, R_xx, normalized R_xx, and key metrics.
    """
    x = np.asarray(sequence, dtype=np.float64)
    N = len(x)

    # Full circular or linear autocorrelation
    R = np.correlate(x, x, mode="full")
    center = N - 1  # index of lag-0
    lags = np.arange(-(N - 1), N, dtype=int)

    # Trim to max_lag if specified
    if max_lag is not None:
        mask = np.abs(lags) <= max_lag
        R = R[mask]
        lags = lags[mask]
        center = int(np.searchsorted(lags, 0))

    R_norm = _normalize(R) if normalize else R / (abs(R[center]) or 1.0)

    # Metrics
    mainlobe = float(R[center])
    sidelobes = np.concatenate([R[:center], R[center+1:]])
    psl = float(np.max(np.abs(sidelobes)) / abs(mainlobe)) if abs(mainlobe) > 0 else 0.0
    isl = float(np.sum(sidelobes ** 2) / mainlobe ** 2) if abs(mainlobe) > 0 else 0.0
    merit_factor = 1.0 / (2.0 * isl) if isl > 0 else float("inf")

    return {
        "lags": lags.tolist(),
        "R": R.tolist(),
        "R_normalized": R_norm.tolist(),
        "mainlobe_value": _json_safe(mainlobe),
        "psl": _json_safe(psl),
        "isl": _json_safe(isl),
        "merit_factor": _json_safe(min(merit_factor, 1000.0)),
        "sequence_length": N,
        "lag_0_index": center,
    }


# ===========================================================================
# 2.  CROSS-CORRELATION
# ===========================================================================

def cross_correlation(
    seq_x: np.ndarray,
    seq_y: np.ndarray,
    normalize: bool = True,
    max_lag: int | None = None,
) -> dict[str, Any]:
    """
    Compute cross-correlation R_xy[k] = Σ x[n]·y[n+k].

    For CSK: x = template for bit 0, y = template for bit 1.
    """
    x = np.asarray(seq_x, dtype=np.float64)
    y = np.asarray(seq_y, dtype=np.float64)
    N = min(len(x), len(y))
    x, y = x[:N], y[:N]

    R_xy = np.correlate(x, y, mode="full")
    lags = np.arange(-(N - 1), N, dtype=int)
    center = N - 1

    if max_lag is not None:
        mask = np.abs(lags) <= max_lag
        R_xy = R_xy[mask]
        lags = lags[mask]
        center = int(np.searchsorted(lags, 0))

    # Normalize by geometric mean of auto-correlations at lag 0
    R_xx = float(np.dot(x, x))
    R_yy = float(np.dot(y, y))
    norm = math.sqrt(R_xx * R_yy) if R_xx > 0 and R_yy > 0 else 1.0
    R_norm = R_xy / norm if normalize else R_xy

    # Max cross-correlation (excluding zero lag for offset sequences)
    max_xcorr = float(np.max(np.abs(R_xy)))
    max_xcorr_norm = float(max_xcorr / norm) if norm > 0 else 0.0

    return {
        "lags": lags.tolist(),
        "R_xy": R_xy.tolist(),
        "R_xy_normalized": R_norm.tolist(),
        "max_xcorr": _json_safe(max_xcorr),
        "max_xcorr_normalized": _json_safe(max_xcorr_norm),
        "zero_lag_value": _json_safe(float(R_xy[center])),
        "zero_lag_normalized": _json_safe(float(R_norm[center])),
        "sequence_length": N,
    }


# ===========================================================================
# 3.  MERIT FACTOR vs PARAMETER SWEEP
# ===========================================================================

def merit_factor_sweep(
    map_name: str,
    param_values: list[float],
    seq_length: int = 256,
    x0: float = 0.31415,
) -> dict[str, Any]:
    """
    Compute Merit Factor as a function of the map's parameter.

    Useful for showing that some parameter values produce "better"
    chaotic sequences (higher F) than others.
    """
    from core.signal_processing import _generate_chaotic_sequence

    merit_factors = []
    psls = []

    for param in param_values:
        seq = _generate_chaotic_sequence(map_name, param, x0, seq_length)
        result = autocorrelation(seq, normalize=False)
        merit_factors.append(_json_safe(result["merit_factor"]))
        psls.append(_json_safe(result["psl"]))

    return {
        "param_values": param_values,
        "merit_factors": merit_factors,
        "psls": psls,
        "map_name": map_name,
        "seq_length": seq_length,
    }


# ===========================================================================
# 4.  AMBIGUITY FUNCTION (2D delay-Doppler)
# ===========================================================================

def ambiguity_function(
    sequence: np.ndarray,
    max_delay: int | None = None,
    n_doppler: int = 32,
    doppler_range: float = 0.5,
) -> dict[str, Any]:
    """
    Compute the discrete ambiguity function χ(τ, ν).

    χ(τ, ν) = |Σ_n x[n] · x*[n+τ] · exp(j2πν·n/N)|

    Returns a 2D matrix (delays × Doppler shifts) for the heatmap.
    """
    x = np.asarray(sequence, dtype=np.float64)
    N = len(x)

    if max_delay is None:
        max_delay = min(N // 2, 64)

    delays = np.arange(-max_delay, max_delay + 1, dtype=int)
    dopplers = np.linspace(-doppler_range, doppler_range, n_doppler)

    chi = np.zeros((len(delays), n_doppler), dtype=np.float64)
    t = np.arange(N, dtype=np.float64)

    for di, delay in enumerate(delays):
        # Compute x[n] · x[n+τ]
        if delay >= 0:
            prod = x[:N - delay] * x[delay:]
            t_prod = t[:N - delay]
        else:
            prod = x[-delay:] * x[:N + delay]
            t_prod = t[-delay:]

        for fi, nu in enumerate(dopplers):
            phase = np.exp(2j * np.pi * nu * t_prod)
            chi[di, fi] = abs(np.dot(prod, phase))

    # Normalize
    chi_max = np.max(chi)
    if chi_max > 0:
        chi_norm = chi / chi_max
    else:
        chi_norm = chi

    return {
        "chi": chi_norm.tolist(),
        "delays": delays.tolist(),
        "dopplers": dopplers.tolist(),
        "n_delays": len(delays),
        "n_doppler": n_doppler,
        "peak_delay": int(delays[np.unravel_index(np.argmax(chi), chi.shape)[0]]),
        "peak_doppler": float(dopplers[np.unravel_index(np.argmax(chi), chi.shape)[1]]),
    }


# ===========================================================================
# 5.  FULL ANALYSIS: auto + cross + merit factor for two sequences
# ===========================================================================

def full_correlation_analysis(
    seq_a: np.ndarray,
    seq_b: np.ndarray,
    max_lag: int | None = None,
) -> dict[str, Any]:
    """
    Complete correlation analysis for two sequences (e.g., CSK bit-0 and bit-1 templates).

    Returns autocorrelation of each, their cross-correlation, and summary metrics.
    """
    a = np.asarray(seq_a, dtype=np.float64)
    b = np.asarray(seq_b, dtype=np.float64)
    N = min(len(a), len(b))
    a, b = a[:N], b[:N]

    max_lag_use = max_lag or min(N - 1, 128)

    auto_a = autocorrelation(a, normalize=True, max_lag=max_lag_use)
    auto_b = autocorrelation(b, normalize=True, max_lag=max_lag_use)
    xcorr  = cross_correlation(a, b, normalize=True, max_lag=max_lag_use)

    return {
        "autocorr_a": auto_a,
        "autocorr_b": auto_b,
        "cross_corr": xcorr,
        "summary": {
            "merit_factor_a": auto_a["merit_factor"],
            "merit_factor_b": auto_b["merit_factor"],
            "psl_a": auto_a["psl"],
            "psl_b": auto_b["psl"],
            "max_xcorr_normalized": xcorr["max_xcorr_normalized"],
            "sequence_length": N,
        },
    }


def get_correlation_explainers() -> dict[str, str]:
    return CORRELATION_EXPLAINERS





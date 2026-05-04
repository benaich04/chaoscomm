"""
core/spectrum.py — Spectral Analysis of Chaotic Waveforms.

Computes the power spectral density (PSD) and derived LPI metrics
for chaotic sequences and CSK waveforms.

Key quantities:
  PSD via Welch's method (averaged periodogram)
  Spectral flatness (Wiener entropy) — how noise-like the signal is
  Spectral entropy — Shannon entropy of the normalized PSD
  Peak-to-average ratio — flatness in linear domain
  3dB bandwidth, null-to-null bandwidth

For LPI (Low Probability of Intercept):
  A signal with spectral flatness ≈ 1 looks like white noise to an
  interceptor's energy detector.  Chaotic spreading achieves this
  because the invariant measure of most maps is approximately uniform
  across frequency (flat spectrum) — unlike a sinusoidal carrier which
  concentrates all energy at one frequency.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.signal import welch


SPECTRUM_EXPLAINERS = {
    "psd": (
        "The Power Spectral Density (PSD) shows how signal power is distributed "
        "across frequencies.  A sine wave has all its power at one frequency "
        "(a spike).  White noise spreads power equally across all frequencies "
        "(flat).  Chaotic signals approximate the flat spectrum — this is the "
        "LPI property.  We compute PSD using Welch's method: split the signal "
        "into overlapping windows, compute FFT of each, then average the "
        "magnitude squared results to reduce variance."
    ),
    "spectral_flatness": (
        "Spectral flatness (Wiener entropy) = geometric_mean(PSD) / "
        "arithmetic_mean(PSD).  Range: 0 (all power at one frequency) to 1 "
        "(perfectly flat, white noise).  Chaotic waveforms typically achieve "
        "0.6–0.95 depending on the map.  This metric directly measures LPI "
        "quality: an interceptor using an energy detector cannot distinguish "
        "a flat-spectrum signal from thermal noise."
    ),
    "spectral_entropy": (
        "Spectral entropy treats the normalized PSD as a probability "
        "distribution and computes its Shannon entropy: H = -Σ p_k log₂(p_k).  "
        "Maximum entropy = log₂(N/2) bits (white noise).  Lower entropy means "
        "the signal has spectral structure that an adversary could exploit.  "
        "For CSK, high spectral entropy is a security feature."
    ),
    "lpi": (
        "Low Probability of Intercept (LPI) is the property of a waveform that "
        "makes it hard for an adversary to detect that a transmission is "
        "occurring.  The key metric is spectral flatness — a flat spectrum "
        "looks like receiver thermal noise to a wideband energy detector.  "
        "Chaotic spreading naturally achieves LPI because the orbit's invariant "
        "measure (arcsine for logistic, uniform for tent/PWLCM) translates "
        "directly to a flat frequency spectrum."
    ),
}


def compute_spectrum(
    signal: np.ndarray,
    fs: float = 1.0,
    nperseg: int | None = None,
    noverlap: int | None = None,
) -> dict[str, Any]:
    """
    Compute PSD via Welch's method + all spectral metrics.
    """
    x = np.asarray(signal, dtype=np.float64)
    N = len(x)

    nperseg = nperseg or min(256, N // 4)
    nperseg = max(16, nperseg)
    noverlap = noverlap or nperseg // 2

    freq, psd = welch(x, fs=fs, nperseg=nperseg, noverlap=noverlap)
    psd = np.maximum(psd, 1e-30)

    # Spectral flatness (Wiener entropy)
    log_mean = float(np.mean(np.log(psd)))
    arith_mean = float(np.mean(psd))
    flatness = float(np.exp(log_mean) / arith_mean) if arith_mean > 0 else 0.0

    # Spectral entropy
    psd_norm = psd / np.sum(psd)
    entropy = float(-np.sum(psd_norm * np.log2(psd_norm + 1e-30)))
    max_entropy = math.log2(len(psd)) if len(psd) > 1 else 1.0
    entropy_normalized = entropy / max_entropy if max_entropy > 0 else 0.0

    # Peak-to-average (dB)
    psd_db = 10 * np.log10(psd)
    par_db = float(np.max(psd_db) - np.mean(psd_db))

    # 3dB bandwidth
    peak_db = float(np.max(psd_db))
    above = freq[psd_db >= peak_db - 3.0]
    bw_3db = float(above[-1] - above[0]) if len(above) > 1 else 0.0

    return {
        "freq": freq.tolist(),
        "psd_db": psd_db.tolist(),
        "psd_linear": psd.tolist(),
        "spectral_flatness": flatness,
        "spectral_flatness_pct": flatness * 100,
        "spectral_entropy": entropy,
        "spectral_entropy_normalized": entropy_normalized,
        "peak_to_average_db": par_db,
        "bandwidth_3db": bw_3db,
        "n_freq_bins": len(freq),
        "signal_length": N,
    }


def compare_maps_spectrum(
    map_configs: list[dict],
    seq_length: int = 1024,
    fs: float = 1.0,
) -> dict[str, Any]:
    """
    Compute spectrum for multiple (map, parameter) pairs.
    Each entry in map_configs: {name, map_name, parameter, x0}
    """
    from core.signal_processing import _generate_chaotic_sequence

    results = []
    for cfg in map_configs:
        seq = _generate_chaotic_sequence(
            cfg["map_name"], cfg["parameter"],
            cfg.get("x0", 0.31415), seq_length,
        )
        spec = compute_spectrum(seq, fs=fs)
        results.append({
            "name": cfg["name"],
            "map_name": cfg["map_name"],
            "parameter": cfg["parameter"],
            "freq": spec["freq"],
            "psd_db": spec["psd_db"],
            "spectral_flatness": spec["spectral_flatness"],
            "spectral_entropy_normalized": spec["spectral_entropy_normalized"],
            "peak_to_average_db": spec["peak_to_average_db"],
        })

    return {"results": results}


def get_spectrum_explainers() -> dict[str, str]:
    return SPECTRUM_EXPLAINERS
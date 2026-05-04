"""
core/matched_filter.py — Three implementations of the matched filter.

The matched filter maximizes output SNR at the sampling instant.
Given received signal r(t) = s(t) + n(t), the optimal linear filter is:

    h(t) = s*(T − t)    (time-reversed conjugate of the signal)

Maximum output SNR = 2Eₛ/N₀  (Cauchy-Schwarz bound, independent of
signal shape — one of the most beautiful results in detection theory).

Three equivalent implementations:

1. CONVOLUTION FILTER
   h[k] = s[N−k]  (time-reversed signal as FIR taps)
   y[n] = Σ_k r[n−k] · h[k]   (direct convolution)
   Complexity: O(N²) for N-point signal

2. CORRELATOR
   y = Σ_k r[k] · s[k]   (multiply and sum)
   Mathematically identical to the MF sampled at t=T
   More intuitive for CSK: correlate received with template
   Complexity: O(N) per decision

3. FFT-BASED (fast convolution)
   Y(f) = R(f) · H(f) = R(f) · S*(f)
   y = IFFT(FFT(r) · conj(FFT(s)))
   Complexity: O(N log N) — essential for long chaotic sequences

All three give identical output at the sampling instant; they differ
only in computational complexity and streaming capability.

LEARNER EXPLAINER:
  The matched filter is the receiver's secret weapon.  Imagine you're
  listening for a specific pattern in a noisy signal — like trying to
  hear your name called in a crowded room.  The matched filter is
  mathematically the best possible listener: it maximizes the peak
  signal power relative to the noise power at exactly the right moment.
  The trick: the filter's shape is literally a mirror image of the
  signal you're looking for.  When the signal arrives, the filter
  "recognizes" it and produces a sharp peak.  When only noise arrives,
  the output stays low.  The ratio of peak to noise is the SNR, and
  it equals exactly 2Eₛ/N₀ — no other linear filter can do better.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np


# ===========================================================================
# CONCEPT EXPLAINERS
# ===========================================================================

MF_EXPLAINERS: dict[str, str] = {
    "matched_filter_theory": (
        "The matched filter theorem says: to detect a known signal s(t) in "
        "white Gaussian noise, the filter that maximizes the output SNR at "
        "the sampling instant is h(t) = s*(T−t) — the time-reversed, complex "
        "conjugate of the signal.  The maximum SNR equals 2Eₛ/N₀, where Eₛ "
        "is the signal energy.  This is derived via the Cauchy-Schwarz "
        "inequality and is independent of the signal's shape — a rectangular "
        "pulse and a chaotic waveform achieve the same SNR if they have the "
        "same energy.  What changes with shape is the sidelobe structure, "
        "which matters for radar (range resolution) but not for CSK detection."
    ),
    "convolution_implementation": (
        "The convolution implementation treats the matched filter as a standard "
        "FIR filter with taps h[k] = s[N−1−k].  The received signal r[n] is "
        "convolved with h[k] to produce y[n] = Σ r[n−k]·h[k].  The peak of "
        "y[n] occurs at n = N−1 (the 'sampling instant') and equals the "
        "cross-correlation of r and s at zero lag.  This is the most intuitive "
        "implementation — you can literally draw the filter as a tapped delay "
        "line — but also the slowest: O(N²) operations for an N-point signal."
    ),
    "correlator_implementation": (
        "The correlator is mathematically identical to the matched filter "
        "sampled at t = T.  Instead of filtering, you simply multiply the "
        "received signal r[k] by the template s[k] element-by-element and "
        "sum: z = Σ r[k]·s[k].  This gives the same decision statistic as "
        "the matched filter peak.  For CSK, the correlator is the natural "
        "choice: correlate with template₀ and template₁, pick the higher.  "
        "Complexity: O(N) per bit — much faster than convolution when you "
        "only need the value at one sampling instant (which is the CSK case)."
    ),
    "fft_implementation": (
        "The FFT-based matched filter computes convolution in the frequency "
        "domain: Y(f) = R(f)·S*(f), then y = IFFT(Y).  This gives the FULL "
        "output y[n] for all time indices simultaneously — not just the peak — "
        "in O(N log N) time.  Essential for radar, where you need to scan the "
        "entire range axis for targets.  For single-bit CSK detection it's "
        "overkill (the correlator is faster), but for radar ambiguity functions "
        "and multi-target detection it's the standard approach."
    ),
    "processing_gain": (
        "Processing gain Gp = 10·log₁₀(N) dB, where N is the number of chips "
        "per bit.  This is the SNR improvement gained by spreading each bit "
        "across N chaotic chips and then correlating at the receiver.  A 100-chip "
        "sequence gives 20 dB of processing gain — meaning the receiver can "
        "detect signals 100× weaker than the noise floor.  This is the same "
        "principle as CDMA spread spectrum and is the reason chaotic spreading "
        "gives anti-jam protection."
    ),
    "roc_curves": (
        "The ROC (Receiver Operating Characteristic) curve plots probability of "
        "detection P_d vs probability of false alarm P_fa as you sweep the "
        "detection threshold.  A perfect detector hugs the top-left corner "
        "(P_d = 1, P_fa = 0).  A coin flip follows the diagonal.  The area "
        "under the ROC curve (AUC) summarizes detector performance in a single "
        "number.  For the matched filter in AWGN, the ROC depends only on the "
        "SNR — and since the MF maximizes SNR, its ROC is the best achievable "
        "by any linear detector."
    ),
    "why_mf_for_csk": (
        "In CSK, the matched filter's job is to decide which chaotic sequence "
        "was transmitted: s₀ or s₁.  It does this by computing two correlations "
        "(one against each template) and picking the larger.  This is optimal "
        "in the Neyman-Pearson sense: no other decision rule gives a lower "
        "bit-error rate for the same noise level.  The connection to radar: "
        "the same matched filter that detects CSK bits also detects radar "
        "echoes — it's the universal optimal detector for known signals in "
        "white noise."
    ),
}


# ===========================================================================
# 1.  MATCHED FILTER — CONVOLUTION (FIR)
# ===========================================================================

def mf_convolution(
    received: np.ndarray,
    template: np.ndarray,
) -> dict[str, Any]:
    """
    Matched filter via direct convolution.

    h[k] = s[N−1−k]  (time-reversed template)
    y[n] = Σ r[n−k] · h[k]

    Returns the full output y[n] and the peak location/value.
    """
    r = np.asarray(received, dtype=np.float64)
    s = np.asarray(template, dtype=np.float64)
    N = len(s)

    # h = time-reversed template (real signals → no conjugate needed)
    h = s[::-1].copy()

    # Convolve
    y = np.convolve(r, h, mode="full")

    # Peak
    peak_idx = int(np.argmax(np.abs(y)))
    peak_val = float(y[peak_idx])

    # Template energy
    energy = float(np.sum(s ** 2))

    return {
        "method": "convolution",
        "output": y.tolist(),
        "filter_taps": h.tolist(),
        "peak_index": peak_idx,
        "peak_value": peak_val,
        "template_energy": energy,
        "output_length": len(y),
        "complexity": f"O(N²) = O({N}²) = {N*N} multiplications",
    }


# ===========================================================================
# 2.  CORRELATOR
# ===========================================================================

def mf_correlator(
    received: np.ndarray,
    template: np.ndarray,
) -> dict[str, Any]:
    """
    Correlator: z = Σ r[k] · s[k]

    Returns the single decision statistic z (equivalent to the MF peak
    at the correct sampling instant) plus a sliding correlation for
    visualization (cross-correlation at all lags).
    """
    r = np.asarray(received, dtype=np.float64)
    s = np.asarray(template, dtype=np.float64)
    N = len(s)

    # Single-point correlation (the actual detector output)
    z = float(np.dot(r[:N], s[:N]))

    # Sliding correlation for visualization (cross-correlation at all lags)
    # Equivalent to convolving r with time-reversed s
    sliding = np.correlate(r, s, mode="full")

    # Template energy
    energy = float(np.sum(s ** 2))

    return {
        "method": "correlator",
        "decision_statistic": z,
        "sliding_correlation": sliding.tolist(),
        "template_energy": energy,
        "peak_index": int(np.argmax(np.abs(sliding))),
        "peak_value": float(sliding[np.argmax(np.abs(sliding))]),
        "complexity": f"O(N) = O({N}) = {N} multiplications (single point)",
    }


# ===========================================================================
# 3.  FFT-BASED MATCHED FILTER
# ===========================================================================

def mf_fft(
    received: np.ndarray,
    template: np.ndarray,
) -> dict[str, Any]:
    """
    FFT-based matched filter: Y(f) = R(f) · S*(f), y = IFFT(Y).

    Returns the full output (identical to convolution) computed in
    O(N log N) time.
    """
    r = np.asarray(received, dtype=np.float64)
    s = np.asarray(template, dtype=np.float64)
    N = len(s)

    # Pad to power of 2 for FFT efficiency
    nfft = 1
    while nfft < len(r) + len(s) - 1:
        nfft *= 2

    R = np.fft.fft(r, n=nfft)
    S = np.fft.fft(s, n=nfft)

    # Matched filter in frequency domain: H(f) = S*(f)
    Y = R * np.conj(S)
    y = np.real(np.fft.ifft(Y))

    # Trim to valid length
    valid_len = len(r) + len(s) - 1
    y = y[:valid_len]

    # Frequency response of the matched filter
    H = np.conj(S)
    H_mag = np.abs(H[:nfft // 2]).tolist()
    freq = (np.arange(nfft // 2) / nfft).tolist()

    peak_idx = int(np.argmax(np.abs(y)))
    peak_val = float(y[peak_idx])
    energy = float(np.sum(s ** 2))

    return {
        "method": "fft",
        "output": y.tolist(),
        "peak_index": peak_idx,
        "peak_value": peak_val,
        "template_energy": energy,
        "output_length": len(y),
        "nfft": nfft,
        "frequency_response_mag": H_mag,
        "frequency_axis": freq,
        "complexity": f"O(N log N) = O({nfft}·{int(math.log2(nfft))}) = {nfft * int(math.log2(nfft))} multiplications",
    }


# ===========================================================================
# 4.  PROCESSING GAIN
# ===========================================================================

def processing_gain(n_chips: int) -> dict[str, float]:
    """Processing gain = 10·log₁₀(N) dB."""
    gp = 10.0 * math.log10(max(n_chips, 1))
    return {
        "n_chips": n_chips,
        "processing_gain_db": gp,
        "processing_gain_linear": float(n_chips),
    }


# ===========================================================================
# 5.  SNR AT DETECTOR OUTPUT
# ===========================================================================

def snr_at_output(
    signal_energy: float,
    noise_variance: float,
) -> dict[str, float]:
    """
    Output SNR of the matched filter.

    SNR_out = 2·Eₛ / N₀ = Eₛ / σ²  (for two-sided N₀/2 = σ²)

    In practice for discrete signals: SNR_out = Eₛ² / (Eₛ · σ²) = Eₛ/σ²
    """
    if noise_variance <= 0:
        return {"snr_linear": float("inf"), "snr_db": float("inf")}
    snr = signal_energy / noise_variance
    return {
        "snr_linear": float(snr),
        "snr_db": float(10 * math.log10(snr)) if snr > 0 else float("-inf"),
        "signal_energy": float(signal_energy),
        "noise_variance": float(noise_variance),
    }


# ===========================================================================
# 6.  ROC CURVE COMPUTATION
# ===========================================================================

def compute_roc(
    signal_energy: float,
    noise_variance: float,
    n_thresholds: int = 200,
) -> dict[str, Any]:
    """
    Theoretical ROC curve for the matched filter in AWGN.

    P_d = Q(Q⁻¹(P_fa) − √(2·SNR))

    where Q(x) = 0.5·erfc(x/√2) is the Q-function.
    """
    from scipy.special import erfc, erfcinv

    def Q(x):
        return 0.5 * erfc(x / math.sqrt(2.0))

    def Q_inv(p):
        if p <= 0: return 10.0
        if p >= 1: return -10.0
        return math.sqrt(2.0) * erfcinv(2.0 * p)

    snr = signal_energy / noise_variance if noise_variance > 0 else 100.0
    sqrt_2snr = math.sqrt(2.0 * snr)

    pfa_values = np.logspace(-6, 0, n_thresholds)
    pd_values = []
    for pfa in pfa_values:
        threshold = Q_inv(pfa)
        pd = Q(threshold - sqrt_2snr)
        pd_values.append(float(pd))

    # AUC (approximate via trapezoidal rule)
    _trapz = getattr(np, "trapezoid", None) or getattr(np, "trapz")
    auc = float(_trapz(pd_values, pfa_values))

    return {
        "pfa": pfa_values.tolist(),
        "pd": pd_values,
        "auc": auc,
        "snr_db": float(10 * math.log10(snr)) if snr > 0 else float("-inf"),
    }


# ===========================================================================
# 7.  COMPARE ALL THREE IMPLEMENTATIONS
# ===========================================================================

def compare_implementations(
    received: np.ndarray,
    template: np.ndarray,
) -> dict[str, Any]:
    """
    Run all three MF implementations on the same received + template
    and return results for side-by-side comparison.
    """
    r = np.asarray(received, dtype=np.float64)
    s = np.asarray(template, dtype=np.float64)

    conv = mf_convolution(r, s)
    corr = mf_correlator(r, s)
    fft = mf_fft(r, s)

    # Verify all three give the same peak value (within numerical precision)
    peaks_match = (
        abs(conv["peak_value"] - corr["peak_value"]) < 1e-6 * abs(conv["peak_value"] + 1e-30)
        and abs(conv["peak_value"] - fft["peak_value"]) < 1e-6 * abs(conv["peak_value"] + 1e-30)
    )

    return {
        "convolution": conv,
        "correlator": corr,
        "fft": fft,
        "peaks_match": peaks_match,
        "template_length": len(s),
        "received_length": len(r),
    }


def get_mf_explainers() -> dict[str, str]:
    return MF_EXPLAINERS
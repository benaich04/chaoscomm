"""
core/waveform.py — Signal Construction from Quantized Chaotic Samples.

This module bridges quantization and modulation.  After a chaotic orbit
is quantized to N discrete levels (from core/quantization.py), the
resulting chip sequence must be turned into a continuous-time baseband
waveform before it can be transmitted.

The construction is:  s(t) = Σ_n  x̂_n · φ(t − nT_c)

where x̂_n is the n-th quantized sample, φ(t) is the pulse shape, and
T_c is the chip duration.

Three pulse shapes implemented:

1. NRZ (Non-Return-to-Zero) — rectangular pulse
   φ(t) = 1 for 0 ≤ t < T_c, 0 otherwise
   Bandwidth: infinite (sinc spectrum), but simple and robust.
   The "default" in most CSK literature.

2. Raised Cosine — smooth rolloff, zero ISI at sampling instants
   Controlled by roll-off factor α ∈ [0, 1]:
     α = 0 → sinc (ideal, infinite bandwidth)
     α = 1 → widest transition band, most bandwidth but smoothest
   Bandwidth: (1+α)/(2T_c) Hz

3. Root-Raised Cosine (RRC) — matched filter pair
   When both transmitter and receiver use RRC, the cascade is a
   raised cosine → zero ISI.  This is the pulse shape used in
   real digital communication systems (WCDMA, LTE, etc.)

LEARNER EXPLAINER:
  Think of quantized chaotic samples as a list of numbers: 0.31, 0.87,
  0.12, 0.65, ...  Each number is just a voltage level.  To transmit
  them as a signal, you need to decide: how long does each voltage last
  (chip duration T_c)?  And what shape is the transition between
  consecutive voltages?  A rectangular pulse (NRZ) just holds each
  value flat for T_c then jumps to the next — simple but creates sharp
  edges that spread energy across all frequencies.  A raised-cosine
  pulse smooths the transitions, concentrating energy in a narrower
  band at the cost of spreading each chip's influence over neighboring
  chip intervals.  The choice of pulse shape is a bandwidth–ISI
  trade-off.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.signal import welch


# ===========================================================================
# CONCEPT EXPLAINERS
# ===========================================================================

WAVEFORM_EXPLAINERS: dict[str, str] = {
    "what_is_waveform_construction": (
        "Waveform construction is the step where a sequence of discrete numbers "
        "(your quantized chaotic samples) becomes a continuous signal that can "
        "travel through a channel.  Each sample x̂_n is multiplied by a pulse "
        "shape φ(t) centered at time nT_c, and all the pulses are added together: "
        "s(t) = Σ x̂_n · φ(t − nT_c).  The result is a smooth (or stepped) "
        "waveform whose amplitude at each chip interval carries one sample's "
        "worth of information."
    ),
    "nrz_pulse": (
        "NRZ (Non-Return-to-Zero) is the simplest pulse: a rectangle that holds "
        "the chip value constant for the entire chip duration, then jumps instantly "
        "to the next value.  Its spectrum is a sinc function with infinite bandwidth — "
        "the sharp edges create high-frequency content.  Despite this, NRZ is the "
        "default choice in most CSK simulation literature because it is trivial to "
        "implement and the infinite bandwidth is handled by the channel model."
    ),
    "raised_cosine": (
        "The raised-cosine pulse eliminates inter-symbol interference (ISI) at the "
        "sampling instants while keeping bandwidth finite.  The roll-off factor α "
        "controls the trade-off: α=0 gives the narrowest bandwidth (sinc pulse, "
        "but infinitely long in time), α=1 gives the widest bandwidth but the "
        "smoothest, shortest pulse.  Bandwidth = (1+α)/(2T_c) Hz."
    ),
    "root_raised_cosine": (
        "Root-raised cosine (RRC) is designed so that when BOTH the transmitter "
        "and receiver use it, the cascade is a raised cosine — giving zero ISI.  "
        "This is the pulse shape used in real-world systems like WCDMA and LTE.  "
        "A single RRC pulse does NOT have zero ISI by itself; only the matched "
        "pair does.  This connects directly to the matched filter module."
    ),
    "bandwidth_tradeoff": (
        "Every pulse shape embodies a fundamental trade-off: narrower bandwidth "
        "means less interference with adjacent channels but longer time-domain "
        "spread (the pulse 'leaks' into neighboring chip intervals, causing ISI).  "
        "Wider bandwidth means shorter, cleaner pulses but more spectrum consumed.  "
        "For chaotic CSK, the signal is already wideband by nature (chaos has a "
        "flat spectrum), so NRZ is usually acceptable — the pulse shape matters "
        "more for narrowband systems."
    ),
    "signal_energy": (
        "The energy of a signal is E = ∫|s(t)|² dt.  For a chip sequence with NRZ "
        "pulses, E = T_c · Σ x̂_n².  Energy per chip E_c = T_c · x̂_n² and energy "
        "per bit E_b = E_c · (chips per bit).  The ratio E_b/N₀ (energy per bit "
        "to noise spectral density) is THE fundamental metric for BER performance "
        "and appears in every communication theory textbook."
    ),
}


# ===========================================================================
# 1.  PULSE SHAPE GENERATORS
# ===========================================================================

def _nrz_pulse(samples_per_chip: int) -> np.ndarray:
    """Rectangular pulse — constant 1 for the chip duration."""
    return np.ones(samples_per_chip, dtype=np.float64)


def _raised_cosine_pulse(samples_per_chip: int, alpha: float = 0.5,
                          n_symbols: int = 6) -> np.ndarray:
    """
    Raised-cosine pulse truncated to ±n_symbols chip intervals.

    H(f) = { T_c,                                   |f| ≤ (1-α)/(2T_c)
           { T_c/2 · [1 + cos(π T_c/α (|f|-(1-α)/(2T_c)))],  ...
           { 0,                                      |f| > (1+α)/(2T_c)

    Time domain: h(t) = sinc(t/T_c) · cos(πα t/T_c) / (1 − (2αt/T_c)²)
    """
    spc = samples_per_chip
    half_len = n_symbols * spc
    t = np.arange(-half_len, half_len + 1, dtype=np.float64) / spc  # in units of T_c

    # sinc(t)
    sinc = np.sinc(t)  # numpy sinc includes the π

    # cos(π α t) / (1 − (2αt)²)
    denom = 1.0 - (2.0 * alpha * t) ** 2
    # Avoid division by zero at t = ±1/(2α)
    safe = np.abs(denom) > 1e-12
    cos_term = np.ones_like(t)
    cos_term[safe] = np.cos(np.pi * alpha * t[safe]) / denom[safe]
    # At the singularities, L'Hôpital gives π/4
    cos_term[~safe] = np.pi / 4.0

    pulse = sinc * cos_term
    # Normalize to unit energy per chip
    pulse = pulse / (np.sqrt(np.sum(pulse ** 2) / spc))
    return pulse


def _rrc_pulse(samples_per_chip: int, alpha: float = 0.5,
               n_symbols: int = 6) -> np.ndarray:
    """
    Root-raised cosine pulse (square root of the raised-cosine spectrum).

    h(t) = [sin(π(1-α)t/T) + 4α(t/T)cos(π(1+α)t/T)] / [π(t/T)(1-(4αt/T)²)]
    """
    spc = samples_per_chip
    half_len = n_symbols * spc
    t = np.arange(-half_len, half_len + 1, dtype=np.float64) / spc

    pulse = np.zeros_like(t)
    for i, ti in enumerate(t):
        if abs(ti) < 1e-12:
            pulse[i] = 1.0 - alpha + 4.0 * alpha / np.pi
        elif abs(abs(ti) - 1.0 / (4.0 * alpha)) < 1e-12 and alpha > 0:
            pulse[i] = (alpha / np.sqrt(2.0)) * (
                (1.0 + 2.0 / np.pi) * np.sin(np.pi / (4.0 * alpha)) +
                (1.0 - 2.0 / np.pi) * np.cos(np.pi / (4.0 * alpha))
            )
        else:
            num = (np.sin(np.pi * ti * (1.0 - alpha)) +
                   4.0 * alpha * ti * np.cos(np.pi * ti * (1.0 + alpha)))
            den = np.pi * ti * (1.0 - (4.0 * alpha * ti) ** 2)
            if abs(den) > 1e-15:
                pulse[i] = num / den
            else:
                pulse[i] = 0.0

    # Normalize
    pulse = pulse / (np.sqrt(np.sum(pulse ** 2) / spc))
    return pulse


PULSE_SHAPES = {
    "nrz": {
        "name": "NRZ (rectangular)",
        "generator": _nrz_pulse,
        "has_alpha": False,
    },
    "raised_cosine": {
        "name": "Raised Cosine",
        "generator": _raised_cosine_pulse,
        "has_alpha": True,
    },
    "rrc": {
        "name": "Root-Raised Cosine",
        "generator": _rrc_pulse,
        "has_alpha": True,
    },
}


# ===========================================================================
# 2.  WAVEFORM CONSTRUCTION
# ===========================================================================

def construct_waveform(
    chips: list[float] | np.ndarray,
    pulse_shape: str = "nrz",
    samples_per_chip: int = 8,
    alpha: float = 0.5,
) -> dict[str, Any]:
    """
    Construct a continuous-time waveform from a chip sequence.

    s(t) = Σ_n  x̂_n · φ(t − n·spc)

    For NRZ: simple np.repeat (each chip held for spc samples).
    For RC/RRC: convolve chip impulse train with the pulse shape.

    Returns:
        waveform:          the constructed signal s(t)
        pulse:             the pulse shape φ(t)
        time:              time axis in samples
        samples_per_chip:  oversampling factor
        energy:            total signal energy
        energy_per_chip:   average energy per chip
        bandwidth:         estimated 3dB bandwidth
    """
    chip_arr = np.asarray(chips, dtype=np.float64)
    n_chips = len(chip_arr)

    if pulse_shape == "nrz":
        pulse = _nrz_pulse(samples_per_chip)
        waveform = np.repeat(chip_arr, samples_per_chip)
    else:
        gen = PULSE_SHAPES.get(pulse_shape, PULSE_SHAPES["nrz"])
        if gen["has_alpha"]:
            pulse = gen["generator"](samples_per_chip, alpha)
        else:
            pulse = gen["generator"](samples_per_chip)

        # Build impulse train: one impulse per chip at chip-rate positions
        impulse_train = np.zeros(n_chips * samples_per_chip, dtype=np.float64)
        for i, val in enumerate(chip_arr):
            impulse_train[i * samples_per_chip] = val

        # Convolve
        waveform = np.convolve(impulse_train, pulse, mode="same")

    # Time axis
    time = np.arange(len(waveform), dtype=np.float64)

    # Energy metrics
    energy = float(np.sum(waveform ** 2))
    energy_per_chip = energy / n_chips if n_chips > 0 else 0.0

    # Bandwidth estimate via PSD
    bw_info = _estimate_bandwidth(waveform, samples_per_chip)

    return {
        "waveform": waveform.tolist(),
        "pulse": pulse.tolist(),
        "time": time.tolist(),
        "n_chips": n_chips,
        "n_samples": len(waveform),
        "samples_per_chip": samples_per_chip,
        "pulse_shape": pulse_shape,
        "alpha": alpha if pulse_shape != "nrz" else None,
        "energy": energy,
        "energy_per_chip": energy_per_chip,
        "bandwidth_3db": bw_info["bandwidth_3db"],
        "bandwidth_null_to_null": bw_info["bandwidth_null_to_null"],
    }


def _estimate_bandwidth(waveform: np.ndarray, spc: int) -> dict[str, float]:
    """Estimate 3-dB and null-to-null bandwidth from the waveform PSD."""
    if len(waveform) < 32:
        return {"bandwidth_3db": 0.0, "bandwidth_null_to_null": 0.0}

    nperseg = min(256, len(waveform) // 2)
    freq, psd = welch(waveform, fs=float(spc), nperseg=nperseg)
    psd_db = 10 * np.log10(np.maximum(psd, 1e-30))

    peak_db = np.max(psd_db)
    # 3-dB bandwidth: freq range where PSD > peak - 3
    above_3db = freq[psd_db >= peak_db - 3.0]
    bw_3db = float(above_3db[-1] - above_3db[0]) if len(above_3db) > 1 else 0.0

    # Null-to-null: first null after the mainlobe peak
    # Find first freq where PSD drops below peak - 30 dB
    above_30 = freq[psd_db >= peak_db - 30.0]
    bw_null = float(above_30[-1]) if len(above_30) > 0 else 0.0

    return {
        "bandwidth_3db": bw_3db,
        "bandwidth_null_to_null": bw_null,
    }


# ===========================================================================
# 3.  COMPARISON: same chips through all three pulse shapes
# ===========================================================================

def compare_pulse_shapes(
    chips: list[float] | np.ndarray,
    samples_per_chip: int = 8,
    alpha: float = 0.5,
) -> dict[str, Any]:
    """
    Construct the waveform for the same chip sequence with NRZ, RC, and RRC.
    Returns all three waveforms + their PSD for side-by-side comparison.
    """
    results = {}
    for ps in ["nrz", "raised_cosine", "rrc"]:
        wav = construct_waveform(chips, ps, samples_per_chip, alpha)
        # Compute PSD
        wf = np.asarray(wav["waveform"])
        nperseg = min(256, len(wf) // 2) if len(wf) > 32 else len(wf)
        if nperseg >= 16:
            freq, psd = welch(wf, fs=float(samples_per_chip), nperseg=nperseg)
            psd_db = (10 * np.log10(np.maximum(psd, 1e-30))).tolist()
            freq = freq.tolist()
        else:
            freq, psd_db = [], []

        results[ps] = {
            "name": PULSE_SHAPES[ps]["name"],
            "waveform": wav["waveform"],
            "pulse": wav["pulse"],
            "energy": wav["energy"],
            "bandwidth_3db": wav["bandwidth_3db"],
            "psd_freq": freq,
            "psd_db": psd_db,
        }
    return results


def get_waveform_explainers() -> dict[str, str]:
    return WAVEFORM_EXPLAINERS
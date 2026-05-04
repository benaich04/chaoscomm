import numpy as np
import math
from typing import Dict, Any


def logistic_seq(n: int, x0: float = 0.31415, r: float = 3.9) -> np.ndarray:
    x = np.empty(n)
    x[0] = x0
    for i in range(1, n):
        x[i] = r * x[i - 1] * (1 - x[i - 1])
    return x


def generate_chaotic_pulse(length: int = 256, x0: float = 0.31415, r: float = 3.9) -> np.ndarray:
    seq = logistic_seq(length + 200, x0=x0, r=r)[200:]
    seq = seq - np.mean(seq)
    seq = seq / (np.std(seq) + 1e-8)
    return seq


def simulate_echo(tx, delay=20, doppler=0.0, snr_db=20.0, rng_seed=42):
    rng = np.random.default_rng(rng_seed)
    n = len(tx)
    t = np.arange(n)

    rx = np.zeros(n, dtype=np.complex128)

    if delay < n:
        idx = np.arange(n - delay)
        phase = np.exp(1j * 2 * np.pi * doppler * idx)
        rx[delay:] = tx[: n - delay] * phase

    signal_power = np.mean(np.abs(rx) ** 2)
    snr_linear = 10 ** (snr_db / 10.0)
    noise_power = signal_power / (snr_linear + 1e-12)

    noise = rng.normal(0, math.sqrt(noise_power / 2), n) + 1j * rng.normal(
        0, math.sqrt(noise_power / 2), n
    )

    return rx + noise


def matched_filter(tx, rx):
    mf = np.conj(tx[::-1])
    corr = np.convolve(rx, mf, mode="same")
    return np.abs(corr)


def cfar_detection(signal, threshold_scale=3.0):
    noise_floor = np.mean(signal)
    threshold = threshold_scale * noise_floor
    detections = np.where(signal > threshold)[0]
    return threshold, detections.tolist()


def ambiguity_surface_with_rx(
    rx: np.ndarray,
    template: np.ndarray,
    delays: np.ndarray,
    dopplers: np.ndarray,
    mode: str = "matched_filter",
) -> np.ndarray:
    n = len(template)
    t = np.arange(n)

    surface = np.zeros((len(dopplers), len(delays)))

    for i, fd in enumerate(dopplers):
        phase = np.exp(-1j * 2 * np.pi * fd * t)
        rx_doppler_corrected = rx * phase

        for j, d in enumerate(delays):
            if d >= n:
                continue

            received_window = np.zeros(n, dtype=np.complex128)
            received_window[: n - d] = rx_doppler_corrected[d:]

            if mode == "matched_filter":
                val = np.abs(np.dot(received_window, np.conj(template)))

            elif mode == "wrong_key":
                val = np.abs(np.dot(received_window, np.conj(template)))

            elif mode == "simple_correlator":
                val = np.abs(np.sum(np.sign(received_window.real) * np.sign(template.real)))

            elif mode == "raw_energy":
                val = np.sum(np.abs(received_window) ** 2)

            else:
                val = 0.0

            surface[i, j] = float(val)

    return surface


def surface_confidence(surface: np.ndarray) -> Dict[str, Any]:
    flat = surface.flatten()
    peak = float(np.max(flat))
    mean = float(np.mean(flat))
    std = float(np.std(flat) + 1e-8)
    confidence = float(peak / (mean + 1e-8))

    if confidence >= 8:
        label = "High"
    elif confidence >= 4:
        label = "Medium"
    else:
        label = "Low"

    return {
        "peak": peak,
        "background_mean": mean,
        "background_std": std,
        "confidence_score": confidence,
        "quality": label,
    }


def run_radar_simulation(
    length: int = 256,
    delay: int = 20,
    doppler: float = 0.05,
    snr_db: float = 20.0,
) -> Dict[str, Any]:
    tx = generate_chaotic_pulse(length)
    rx = simulate_echo(tx, delay, doppler, snr_db)

    range_profile = matched_filter(tx, rx)
    threshold, detections = cfar_detection(range_profile)

    delays = np.arange(0, length)
    dopplers = np.linspace(-0.1, 0.1, 40)

    amb = ambiguity_surface_with_rx(rx, tx, delays, dopplers, mode="matched_filter")

    return {
        "tx": tx.real.tolist(),
        "rx": rx.real.tolist(),
        "range_profile": range_profile.tolist(),
        "threshold": float(threshold),
        "detections": detections,
        "ambiguity": amb.tolist(),
        "ambiguity_metrics": surface_confidence(amb),
        "delays": delays.tolist(),
        "dopplers": dopplers.tolist(),
    }


def compare_radar_processors(
    length: int = 256,
    delay: int = 20,
    doppler: float = 0.05,
    snr_db: float = 20.0,
) -> Dict[str, Any]:
    tx = generate_chaotic_pulse(length)
    rx = simulate_echo(tx, delay, doppler, snr_db)

    wrong_key = generate_chaotic_pulse(length, x0=0.27182, r=3.7)

    delays = np.arange(0, length)
    dopplers = np.linspace(-0.1, 0.1, 40)

    matched = ambiguity_surface_with_rx(rx, tx, delays, dopplers, mode="matched_filter")
    raw = ambiguity_surface_with_rx(rx, tx, delays, dopplers, mode="raw_energy")
    wrong = ambiguity_surface_with_rx(rx, wrong_key, delays, dopplers, mode="wrong_key")
    simple = ambiguity_surface_with_rx(rx, tx, delays, dopplers, mode="simple_correlator")

    return {
        "delays": delays.tolist(),
        "dopplers": dopplers.tolist(),
        "processors": [
            {
                "key": "matched_filter",
                "title": "Matched Filter",
                "description": "Uses the correct chaotic waveform as the reference.",
                "surface": matched.tolist(),
                "metrics": surface_confidence(matched),
            },
            {
                "key": "raw_energy",
                "title": "Raw Energy",
                "description": "Only measures energy, so it cannot recognize the waveform pattern.",
                "surface": raw.tolist(),
                "metrics": surface_confidence(raw),
            },
            {
                "key": "wrong_key",
                "title": "Wrong-Key Matched Filter",
                "description": "Uses the wrong chaotic key, so the target peak should weaken or collapse.",
                "surface": wrong.tolist(),
                "metrics": surface_confidence(wrong),
            },
            {
                "key": "simple_correlator",
                "title": "Simple Correlator",
                "description": "Uses a simpler real-valued correlation, less robust than the matched filter.",
                "surface": simple.tolist(),
                "metrics": surface_confidence(simple),
            },
        ],
    }
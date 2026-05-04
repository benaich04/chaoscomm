import math
from typing import Any, Dict, List

import numpy as np


# ============================================================================
# CHAOTIC MAP GENERATORS
# ============================================================================

def logistic_seq(n: int, x0: float = 0.31415, r: float = 3.9) -> np.ndarray:
    x = np.empty(n, dtype=float)
    x[0] = x0
    for i in range(1, n):
        x[i] = r * x[i - 1] * (1.0 - x[i - 1])
    return x


def tent_seq(n: int, x0: float = 0.31415, mu: float = 1.99) -> np.ndarray:
    x = np.empty(n, dtype=float)
    x[0] = x0
    for i in range(1, n):
        x[i] = mu * x[i - 1] if x[i - 1] < 0.5 else mu * (1.0 - x[i - 1])
        x[i] = min(max(x[i], 0.0), 1.0)
    return x


def bernoulli_seq(n: int, x0: float = 0.31415) -> np.ndarray:
    x = np.empty(n, dtype=float)
    x[0] = x0
    for i in range(1, n):
        x[i] = (2.0 * x[i - 1]) % 1.0
    return x


def chebyshev_seq(n: int, x0: float = 0.31415, order: int = 3) -> np.ndarray:
    # Work in [-1, 1], then normalize to [0, 1]
    y = np.empty(n, dtype=float)
    y[0] = 2.0 * x0 - 1.0
    for i in range(1, n):
        y[i] = math.cos(order * math.acos(float(np.clip(y[i - 1], -1.0, 1.0))))
    return (y + 1.0) / 2.0


def get_sequence(map_name: str, n: int, x0: float, r: float) -> np.ndarray:
    name = map_name.lower()
    if name == "logistic":
        return logistic_seq(n, x0=x0, r=r)
    if name == "tent":
        return tent_seq(n, x0=x0, mu=min(max(r / 2.0, 0.1), 1.999))
    if name == "bernoulli":
        return bernoulli_seq(n, x0=x0)
    if name == "chebyshev":
        return chebyshev_seq(n, x0=x0, order=3)
    return logistic_seq(n, x0=x0, r=r)


# ============================================================================
# METRICS
# ============================================================================

def _safe_float(x: Any) -> float:
    try:
        y = float(x)
        if math.isnan(y) or math.isinf(y):
            return 0.0
        return y
    except Exception:
        return 0.0


def shannon_entropy(x: np.ndarray, bins: int = 32) -> float:
    hist, _ = np.histogram(x, bins=bins, range=(0.0, 1.0), density=False)
    p = hist / max(np.sum(hist), 1)
    p = p[p > 0]
    return _safe_float(-np.sum(p * np.log2(p)))


def lyapunov_logistic(x: np.ndarray, r: float) -> float:
    deriv = np.abs(r * (1.0 - 2.0 * x))
    deriv = np.maximum(deriv, 1e-12)
    return _safe_float(np.mean(np.log(deriv)))


def variance_metric(x: np.ndarray) -> float:
    return _safe_float(np.var(x))


def spectral_flatness(x: np.ndarray) -> float:
    x = x - np.mean(x)
    psd = np.abs(np.fft.rfft(x)) ** 2
    psd = psd[1:] + 1e-12
    geo = np.exp(np.mean(np.log(psd)))
    arith = np.mean(psd)
    return _safe_float(geo / arith)


def autocorr_sidelobe_ratio(x: np.ndarray) -> float:
    x = x - np.mean(x)
    corr = np.correlate(x, x, mode="full")
    corr = np.abs(corr)
    center = len(corr) // 2
    peak = corr[center] + 1e-12
    sidelobes = np.delete(corr, center)
    max_side = float(np.max(sidelobes)) if len(sidelobes) else 0.0
    ratio_db = 20.0 * math.log10(peak / (max_side + 1e-12))
    return _safe_float(ratio_db)


def approximate_entropy(x: np.ndarray, m: int = 2, r_ratio: float = 0.2) -> float:
    x = np.asarray(x, dtype=float)
    n = len(x)
    if n < m + 2:
        return 0.0

    tol = r_ratio * np.std(x)
    if tol <= 0:
        return 0.0

    def _phi(mm: int) -> float:
        patterns = np.array([x[i : i + mm] for i in range(n - mm + 1)])
        counts = []
        for p in patterns:
            dist = np.max(np.abs(patterns - p), axis=1)
            counts.append(np.mean(dist <= tol))
        counts = np.maximum(np.array(counts), 1e-12)
        return float(np.mean(np.log(counts)))

    return _safe_float(_phi(m) - _phi(m + 1))


def bin_crossing_rate(x: np.ndarray, levels: int = 16) -> float:
    # Personal contribution style metric:
    # how often the chaotic sequence jumps across quantization bins.
    bins = np.floor(np.clip(x, 0, 0.999999) * levels).astype(int)
    crossings = np.sum(bins[1:] != bins[:-1])
    return _safe_float(crossings / max(len(bins) - 1, 1))


def quantization_aware_score(x: np.ndarray, lyap: float, levels: int = 16) -> float:
    ent = shannon_entropy(x, bins=levels)
    bcr = bin_crossing_rate(x, levels=levels)
    flat = spectral_flatness(x)

    ent_norm = min(ent / math.log2(levels), 1.0)
    lyap_norm = 1.0 / (1.0 + math.exp(-lyap))
    score = 100.0 * (0.35 * ent_norm + 0.30 * bcr + 0.20 * flat + 0.15 * lyap_norm)
    return _safe_float(score)


# ============================================================================
# SIMPLE RANDOMNESS TESTS
# ============================================================================

def bits_from_sequence(x: np.ndarray) -> np.ndarray:
    return (x > np.median(x)).astype(int)


def monobit_test(bits: np.ndarray) -> Dict[str, Any]:
    n = len(bits)
    ones = int(np.sum(bits))
    zeros = n - ones
    balance = abs(ones - zeros) / max(n, 1)
    p_value = math.exp(-6.0 * balance)
    return {
        "name": "Frequency / Monobit",
        "p_value": _safe_float(p_value),
        "passed": bool(p_value > 0.01),
        "note": "Checks whether 0s and 1s are balanced.",
    }


def runs_test(bits: np.ndarray) -> Dict[str, Any]:
    n = len(bits)
    if n < 2:
        return {"name": "Runs", "p_value": 0.0, "passed": False, "note": "Too short."}

    runs = 1 + int(np.sum(bits[1:] != bits[:-1]))
    expected = (2.0 * np.sum(bits) * (n - np.sum(bits))) / max(n, 1) + 1.0
    deviation = abs(runs - expected) / max(expected, 1.0)
    p_value = math.exp(-3.0 * deviation)
    return {
        "name": "Runs",
        "p_value": _safe_float(p_value),
        "passed": bool(p_value > 0.01),
        "note": "Checks whether bit changes happen too often or too rarely.",
    }


def block_frequency_test(bits: np.ndarray, block_size: int = 64) -> Dict[str, Any]:
    n_blocks = len(bits) // block_size
    if n_blocks == 0:
        return {"name": "Block Frequency", "p_value": 0.0, "passed": False, "note": "Too short."}

    blocks = bits[: n_blocks * block_size].reshape(n_blocks, block_size)
    props = np.mean(blocks, axis=1)
    deviation = float(np.mean(np.abs(props - 0.5)))
    p_value = math.exp(-8.0 * deviation)
    return {
        "name": "Block Frequency",
        "p_value": _safe_float(p_value),
        "passed": bool(p_value > 0.01),
        "note": "Checks balance inside local blocks.",
    }


def dft_test(bits: np.ndarray) -> Dict[str, Any]:
    y = 2 * bits - 1
    spectrum = np.abs(np.fft.rfft(y))
    if len(spectrum) < 2:
        return {"name": "DFT / Spectrum", "p_value": 0.0, "passed": False, "note": "Too short."}

    peak_ratio = float(np.max(spectrum[1:]) / (np.mean(spectrum[1:]) + 1e-12))
    p_value = math.exp(-0.25 * max(peak_ratio - 3.0, 0.0))
    return {
        "name": "DFT / Spectrum",
        "p_value": _safe_float(p_value),
        "passed": bool(p_value > 0.01),
        "note": "Checks whether strong periodic structure exists.",
    }


def randomness_tests(x: np.ndarray) -> List[Dict[str, Any]]:
    bits = bits_from_sequence(x)
    return [
        monobit_test(bits),
        block_frequency_test(bits),
        runs_test(bits),
        dft_test(bits),
    ]


# ============================================================================
# MAIN DASHBOARD
# ============================================================================

def analyze_map(map_name: str, n: int = 2048, x0: float = 0.31415, r: float = 3.9, levels: int = 16) -> Dict[str, Any]:
    x = get_sequence(map_name, n + 200, x0, r)[200:]

    if map_name.lower() == "logistic":
        lyap = lyapunov_logistic(x, r)
    else:
        # Approximate local divergence numerically for non-logistic maps
        eps = 1e-8
        y = get_sequence(map_name, n + 200, min(x0 + eps, 0.999999), r)[200:]
        diff = np.abs(y - x) + 1e-12
        lyap = _safe_float(np.mean(np.log(diff[1:] / (diff[:-1] + 1e-12))))

    metrics = {
        "lyapunov": lyap,
        "entropy": shannon_entropy(x),
        "approx_entropy": approximate_entropy(x),
        "variance": variance_metric(x),
        "spectral_flatness": spectral_flatness(x),
        "autocorr_pslr_db": autocorr_sidelobe_ratio(x),
        "bin_crossing_rate": bin_crossing_rate(x, levels),
        "qa_chaos_score": quantization_aware_score(x, lyap, levels),
    }

    return {
        "map": map_name,
        "n": int(n),
        "x0": float(x0),
        "r": float(r),
        "levels": int(levels),
        "sequence_preview": [float(v) for v in x[:250]],
        "histogram": histogram_payload(x),
        "metrics": {k: _safe_float(v) for k, v in metrics.items()},
        "tests": randomness_tests(x),
    }


def histogram_payload(x: np.ndarray, bins: int = 32) -> Dict[str, Any]:
    counts, edges = np.histogram(x, bins=bins, range=(0.0, 1.0))
    return {
        "bins": [float((edges[i] + edges[i + 1]) / 2.0) for i in range(len(counts))],
        "counts": [int(c) for c in counts],
    }


def compare_maps(n: int = 2048, x0: float = 0.31415, r: float = 3.9, levels: int = 16) -> Dict[str, Any]:
    names = ["logistic", "tent", "bernoulli", "chebyshev"]
    results = [analyze_map(name, n=n, x0=x0, r=r, levels=levels) for name in names]

    radar_chart = []
    for res in results:
        m = res["metrics"]
        radar_chart.append({
            "map": res["map"],
            "Entropy": min(m["entropy"] / 5.0, 1.0) * 100.0,
            "Lyapunov": min(max((m["lyapunov"] + 1.0) / 2.0, 0.0), 1.0) * 100.0,
            "Flatness": min(max(m["spectral_flatness"], 0.0), 1.0) * 100.0,
            "BCR": min(max(m["bin_crossing_rate"], 0.0), 1.0) * 100.0,
            "QA Score": m["qa_chaos_score"],
        })

    return {
        "results": results,
        "radar_chart": radar_chart,
        "summary": best_summary(results),
    }


def best_summary(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    best = max(results, key=lambda r: r["metrics"]["qa_chaos_score"])
    return {
        "best_map": best["map"],
        "best_score": best["metrics"]["qa_chaos_score"],
        "explanation": "Best map is selected by the Quantization-Aware Chaos Score, combining entropy, spectral flatness, bin-crossing behavior, and Lyapunov sensitivity.",
    }


def get_metrics_explainers() -> Dict[str, str]:
    return {
        "page": "This dashboard answers one question: how good is this chaotic signal for communication, security, and radar?",
        "lyapunov": "Lyapunov measures sensitivity. Higher means tiny changes grow faster, which is useful for unpredictability.",
        "entropy": "Entropy measures how evenly the signal explores its possible values.",
        "spectral_flatness": "Spectral flatness tells whether the signal looks noise-like in frequency.",
        "bcr": "Bin-Crossing Rate is a quantization-aware metric: it checks how often the signal jumps between digital bins.",
        "qa_score": "The Quantization-Aware Chaos Score is your custom combined score for choosing maps after digitization.",
        "nist": "The listed tests are lightweight randomness checks inspired by NIST-style testing. They are educational, not a certified cryptographic test suite.",
    }

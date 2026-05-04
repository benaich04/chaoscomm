"""
Tests for core/matched_filter.py
"""

import math
import numpy as np
import pytest

from core.matched_filter import (
    mf_convolution,
    mf_correlator,
    mf_fft,
    processing_gain,
    snr_at_output,
    compute_roc,
    compare_implementations,
    get_mf_explainers,
)


def _chaotic_signal(n=100):
    x = np.empty(n)
    x[0] = 0.31415
    for i in range(1, n): x[i] = 3.9 * x[i-1] * (1 - x[i-1])
    return x


# ---------------------------------------------------------------------------
# All three give the same peak
# ---------------------------------------------------------------------------

def test_three_implementations_match():
    s = _chaotic_signal(64)
    r = s + np.random.default_rng(42).normal(0, 0.1, len(s))
    result = compare_implementations(r, s)
    assert result["peaks_match"]


def test_convolution_peak_at_correct_index():
    s = _chaotic_signal(32)
    # Received = signal padded with zeros (signal starts at index 10)
    r = np.zeros(60)
    r[10:42] = s
    result = mf_convolution(r, s)
    # Peak should be near index 10 + 31 = 41
    assert abs(result["peak_index"] - 41) <= 1


def test_correlator_decision_statistic_positive_for_matching():
    s = _chaotic_signal(50)
    r = s.copy()
    result = mf_correlator(r, s)
    assert result["decision_statistic"] > 0


def test_correlator_low_for_noise_only():
    s = _chaotic_signal(50)
    noise = np.random.default_rng(42).normal(0, 0.01, 50)
    result = mf_correlator(noise, s)
    # Should be much smaller than template energy
    assert abs(result["decision_statistic"]) < result["template_energy"] * 0.5


def test_fft_output_same_length_as_convolution():
    s = _chaotic_signal(40)
    r = s + np.random.default_rng(42).normal(0, 0.1, 40)
    conv = mf_convolution(r, s)
    fft = mf_fft(r, s)
    assert fft["output_length"] == conv["output_length"]


def test_fft_has_frequency_response():
    s = _chaotic_signal(64)
    r = s.copy()
    result = mf_fft(r, s)
    assert len(result["frequency_response_mag"]) > 0
    assert len(result["frequency_axis"]) > 0


# ---------------------------------------------------------------------------
# Processing gain
# ---------------------------------------------------------------------------

def test_processing_gain_formula():
    pg = processing_gain(100)
    assert abs(pg["processing_gain_db"] - 20.0) < 0.01   # 10·log10(100)=20


def test_processing_gain_1_chip():
    pg = processing_gain(1)
    assert pg["processing_gain_db"] == 0.0


# ---------------------------------------------------------------------------
# SNR
# ---------------------------------------------------------------------------

def test_snr_at_output():
    result = snr_at_output(signal_energy=10.0, noise_variance=1.0)
    assert abs(result["snr_db"] - 10.0) < 0.01   # 10·log10(10)


# ---------------------------------------------------------------------------
# ROC
# ---------------------------------------------------------------------------

def test_roc_shape():
    roc = compute_roc(signal_energy=10.0, noise_variance=1.0)
    assert len(roc["pfa"]) == 200
    assert len(roc["pd"]) == 200
    # P_d should be monotonically non-decreasing with P_fa
    for i in range(1, len(roc["pd"])):
        assert roc["pd"][i] >= roc["pd"][i-1] - 1e-10
    # AUC should be close to 1 at high SNR
    assert roc["auc"] > 0.9


def test_roc_low_snr_auc():
    roc = compute_roc(signal_energy=0.1, noise_variance=1.0)
    # Low SNR → AUC closer to 0.5 (coin flip)
    assert roc["auc"] < 0.95


# ---------------------------------------------------------------------------
# Explainers
# ---------------------------------------------------------------------------

def test_explainers():
    e = get_mf_explainers()
    assert "matched_filter_theory" in e
    assert "convolution_implementation" in e
    assert "correlator_implementation" in e
    assert "fft_implementation" in e
    assert "processing_gain" in e
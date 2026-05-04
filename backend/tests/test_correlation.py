"""Tests for core/correlation.py"""
import math
import numpy as np
import pytest
from core.correlation import (
    autocorrelation,
    cross_correlation,
    merit_factor_sweep,
    ambiguity_function,
    full_correlation_analysis,
    get_correlation_explainers,
)


def _logistic(n=256, r=3.9, x0=0.31415):
    x = np.empty(n)
    x[0] = x0
    for i in range(1, n): x[i] = r * x[i-1] * (1 - x[i-1])
    return x


def _logistic2(n=256, r=3.6, x0=0.7):
    x = np.empty(n)
    x[0] = x0
    for i in range(1, n): x[i] = r * x[i-1] * (1 - x[i-1])
    return x


# --- Autocorrelation ---

def test_autocorr_peak_at_zero():
    x = _logistic(128)
    r = autocorrelation(x, normalize=True)
    center = r["lag_0_index"]
    assert abs(r["R_normalized"][center] - 1.0) < 1e-9


def test_autocorr_lags_symmetric():
    x = _logistic(64)
    r = autocorrelation(x, max_lag=20)
    lags = r["lags"]
    assert lags[0] == -20
    assert lags[-1] == 20


def test_autocorr_merit_factor_positive():
    x = _logistic(256)
    r = autocorrelation(x)
    assert r["merit_factor"] > 0


def test_autocorr_psl_between_0_and_1():
    x = _logistic(256)
    r = autocorrelation(x)
    assert 0 <= r["psl"] <= 1.0


def test_autocorr_sinewave_has_periodic_acf():
    """Sine wave should have cosine-shaped ACF."""
    t = np.linspace(0, 8 * np.pi, 256)
    x = np.sin(t)
    r = autocorrelation(x, normalize=True, max_lag=64)
    center = r["lag_0_index"]
    # The first sidelobe (near lag ≈ ±period) should be significant
    R_norm = r["R_normalized"]
    assert max(abs(v) for v in R_norm) > 0.5


# --- Cross-correlation ---

def test_xcorr_same_signal_is_autocorr():
    x = _logistic(64)
    ac = autocorrelation(x, normalize=True, max_lag=20)
    xc = cross_correlation(x, x, normalize=True, max_lag=20)
    # Zero-lag cross-correlation of x with itself should be 1
    center = xc["lags"].index(0)
    assert abs(xc["R_xy_normalized"][center] - 1.0) < 1e-9


def test_xcorr_different_sequences_lower():
    x = _logistic(128)
    y = _logistic2(128)
    xc = cross_correlation(x, y, normalize=True)
    assert xc["max_xcorr_normalized"] < 1.0


def test_xcorr_json_safe():
    x = _logistic(64)
    y = _logistic2(64)
    result = cross_correlation(x, y)
    for v in result["R_xy_normalized"]:
        assert math.isfinite(v)


# --- Merit factor sweep ---

def test_merit_factor_sweep_returns_lists():
    params = [3.5, 3.7, 3.9]
    result = merit_factor_sweep("logistic", params, seq_length=64)
    assert len(result["merit_factors"]) == 3
    assert len(result["psls"]) == 3


def test_merit_factor_values_positive():
    params = [3.6, 3.8, 4.0]
    result = merit_factor_sweep("logistic", params, seq_length=64)
    assert all(f > 0 for f in result["merit_factors"])


# --- Ambiguity function ---

def test_ambiguity_function_shape():
    x = _logistic(64)
    result = ambiguity_function(x, max_delay=8, n_doppler=16)
    assert result["n_delays"] == 17  # -8..+8
    assert result["n_doppler"] == 16
    assert len(result["chi"]) == 17
    assert len(result["chi"][0]) == 16


def test_ambiguity_peak_at_zero():
    x = _logistic(64)
    result = ambiguity_function(x, max_delay=8, n_doppler=16)
    assert result["peak_delay"] == 0


# --- Full analysis ---

def test_full_analysis_structure():
    x = _logistic(128)
    y = _logistic2(128)
    result = full_correlation_analysis(x, y)
    assert "autocorr_a" in result
    assert "autocorr_b" in result
    assert "cross_corr" in result
    assert "summary" in result
    assert result["summary"]["merit_factor_a"] > 0
    assert result["summary"]["max_xcorr_normalized"] < 1.0


# --- Explainers ---

def test_explainers():
    e = get_correlation_explainers()
    assert "autocorrelation" in e
    assert "merit_factor" in e
    assert "ambiguity_function" in e
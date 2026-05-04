"""
Tests for core/waveform.py — signal construction from quantized chips.
"""

import numpy as np
import pytest

from core.waveform import (
    construct_waveform,
    compare_pulse_shapes,
    get_waveform_explainers,
)


def _logistic_chips(n=100, r=3.9):
    x = np.empty(n)
    x[0] = 0.31415
    for i in range(1, n): x[i] = r * x[i-1] * (1 - x[i-1])
    return x.tolist()


# ---------------------------------------------------------------------------
# Basic shape tests
# ---------------------------------------------------------------------------

def test_nrz_length():
    chips = _logistic_chips(50)
    result = construct_waveform(chips, "nrz", samples_per_chip=8)
    assert len(result["waveform"]) == 50 * 8
    assert result["n_chips"] == 50


def test_nrz_holds_value():
    """NRZ should repeat each chip value for spc samples."""
    chips = [0.3, 0.7, 0.1]
    result = construct_waveform(chips, "nrz", samples_per_chip=4)
    wav = result["waveform"]
    assert wav[:4] == [0.3, 0.3, 0.3, 0.3]
    assert wav[4:8] == [0.7, 0.7, 0.7, 0.7]


def test_raised_cosine_runs():
    chips = _logistic_chips(50)
    result = construct_waveform(chips, "raised_cosine", samples_per_chip=8, alpha=0.5)
    assert len(result["waveform"]) > 0
    assert result["pulse_shape"] == "raised_cosine"


def test_rrc_runs():
    chips = _logistic_chips(50)
    result = construct_waveform(chips, "rrc", samples_per_chip=8, alpha=0.35)
    assert len(result["waveform"]) > 0
    assert result["alpha"] == 0.35


def test_energy_positive():
    chips = _logistic_chips(100)
    for ps in ["nrz", "raised_cosine", "rrc"]:
        result = construct_waveform(chips, ps, samples_per_chip=8)
        assert result["energy"] > 0
        assert result["energy_per_chip"] > 0


def test_bandwidth_nrz_wider_than_rc():
    """NRZ has wider 3dB bandwidth than raised cosine at same chip rate."""
    chips = _logistic_chips(200)
    nrz = construct_waveform(chips, "nrz", samples_per_chip=16)
    rc = construct_waveform(chips, "raised_cosine", samples_per_chip=16, alpha=0.5)
    # NRZ 3dB bandwidth should be >= RC (RC rolls off smoother)
    assert nrz["bandwidth_3db"] >= rc["bandwidth_3db"] * 0.8  # allow tolerance


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------

def test_compare_returns_all_three():
    chips = _logistic_chips(100)
    result = compare_pulse_shapes(chips, samples_per_chip=8)
    assert "nrz" in result
    assert "raised_cosine" in result
    assert "rrc" in result
    for ps in result.values():
        assert len(ps["waveform"]) > 0
        assert len(ps["pulse"]) > 0


# ---------------------------------------------------------------------------
# Explainers
# ---------------------------------------------------------------------------

def test_explainers():
    e = get_waveform_explainers()
    assert "nrz_pulse" in e
    assert "raised_cosine" in e
    assert "bandwidth_tradeoff" in e
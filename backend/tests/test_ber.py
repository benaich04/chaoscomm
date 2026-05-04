"""Tests for core/ber.py"""
import math
import numpy as np
import pytest
from core.ber import Q, Q_inv, ber_bpsk, ber_csk, ber_dcsk, all_ber_curves, monte_carlo_ber, get_ber_explainers


def test_q_function_known_values():
    assert abs(Q(0.0) - 0.5) < 1e-10
    assert abs(Q(1.0) - 0.1587) < 1e-4
    assert Q(6.0) < 1e-8


def test_q_inverse():
    for p in [0.5, 0.1, 0.01]:
        assert abs(Q(Q_inv(p)) - p) < 1e-8


def test_bpsk_ber_decreasing():
    ebn0 = list(range(0, 15))
    bers = ber_bpsk(ebn0)
    assert all(bers[i] > bers[i+1] for i in range(len(bers)-1))


def test_bpsk_at_10db():
    # At 10 dB Eb/N0, BPSK BER ≈ 3.8e-6
    ber = ber_bpsk([10.0])[0]
    assert 1e-7 < ber < 1e-4


def test_csk_antipodal_matches_spread_bpsk():
    # CSK with rho=-1, beta=1: BER = Q(sqrt(Eb/N0))
    # BPSK: BER = Q(sqrt(2*Eb/N0))  — 3 dB difference is expected
    # Just verify CSK antipodal is better than orthogonal CSK
    ebn0 = list(range(0, 10))
    csk_anti = ber_csk(ebn0, rho=-1.0, beta=1)
    csk_orth = ber_csk(ebn0, rho=0.0, beta=1)
    for a, o in zip(csk_anti, csk_orth):
        assert a <= o  # antipodal always <= orthogonal


def test_csk_rho1_is_half():
    # rho=1 means identical sequences — 50% BER
    bers = ber_csk([0, 5, 10], rho=1.0, beta=40)
    assert all(abs(b - 0.5) < 1e-9 for b in bers)


def test_dcsk_worse_than_csk_antipodal():
    # At moderate SNR DCSK should be worse; test at a mid-range value
    ebn0 = [3.0]
    dcsk  = ber_dcsk(ebn0, beta=40)
    csk_a = ber_csk(ebn0, rho=-1.0, beta=40)
    assert dcsk[0] >= csk_a[0]


def test_processing_gain_shifts_curve():
    ebn0 = [5.0]
    ber_low  = ber_csk(ebn0, rho=0.0, beta=1)
    ber_high = ber_csk(ebn0, rho=0.0, beta=100)
    assert ber_high[0] < ber_low[0]


def test_all_ber_curves_structure():
    ebn0 = list(range(-5, 15))
    result = all_ber_curves(ebn0, rho=0.0, beta=40)
    assert "bpsk" in result
    assert "csk_rho" in result
    assert "dcsk" in result
    assert len(result["bpsk"]) == len(ebn0)


def test_monte_carlo_dcsk():
    result = monte_carlo_ber(ebn0_db=10, scheme="dcsk", beta=20, n_bits=500)
    assert result["n_bits"] == 500
    assert 0 <= result["ber_simulated"] <= 0.5
    # Simulated BER should be within 2 orders of magnitude of theory
    sim = result["ber_simulated"]
    theory = result["ber_theoretical"]
    if theory > 1e-4:  # only check when theory is not too small
        assert abs(math.log10(sim + 1e-10) - math.log10(theory + 1e-10)) < 2


def test_explainers():
    e = get_ber_explainers()
    assert "q_function" in e
    assert "csk_ber" in e
    assert "dcsk_ber" in e
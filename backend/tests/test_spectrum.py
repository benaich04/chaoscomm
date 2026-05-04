"""Tests for core/spectrum.py"""
import numpy as np
import pytest
from core.spectrum import compute_spectrum, compare_maps_spectrum, get_spectrum_explainers


def _logistic(n=512, r=3.9):
    x = np.empty(n); x[0] = 0.31415
    for i in range(1, n): x[i] = r * x[i-1] * (1 - x[i-1])
    return x


def test_spectrum_shape():
    x = _logistic()
    r = compute_spectrum(x)
    assert len(r["freq"]) > 0
    assert len(r["psd_db"]) == len(r["freq"])


def test_spectral_flatness_chaotic():
    x = _logistic()
    r = compute_spectrum(x)
    assert r["spectral_flatness"] > 0.3


def test_spectral_flatness_sine_low():
    t = np.linspace(0, 8 * np.pi, 512)
    x = np.sin(t)
    r = compute_spectrum(x)
    assert r["spectral_flatness"] < 0.5


def test_spectral_entropy_normalized_range():
    x = _logistic()
    r = compute_spectrum(x)
    assert 0 < r["spectral_entropy_normalized"] <= 1.0


def test_compare_maps_returns_all():
    configs = [
        {"name": "logistic r=3.9", "map_name": "logistic", "parameter": 3.9},
        {"name": "logistic r=4.0", "map_name": "logistic", "parameter": 4.0},
    ]
    r = compare_maps_spectrum(configs, seq_length=256)
    assert len(r["results"]) == 2
    assert "spectral_flatness" in r["results"][0]


def test_explainers():
    e = get_spectrum_explainers()
    assert "psd" in e and "lpi" in e
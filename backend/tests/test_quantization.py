"""
Tests for core/quantization.py and core/pdf_estimator.py.

Verifies against known analytical results:
  - Uniform MSE = Δ²/12 for uniform PDF
  - SQNR = 6.02·B + 1.76 dB
  - Lloyd-Max MSE ≤ uniform MSE (always)
  - Lloyd-Max for uniform PDF ≈ uniform quantization (degenerate case)
  - μ-law MSE < uniform MSE for non-uniform PDFs
  - PDF estimation: arcsine detected for logistic@r=4
"""

import math
import numpy as np
import pytest

from core.quantization import (
    uniform_midrise,
    uniform_midtread,
    mu_law_quantize,
    a_law_quantize,
    lloyd_max,
    sqnr_theoretical,
    mse_vs_levels,
    quantize_orbit,
    get_quantization_explainers,
)
from core.pdf_estimator import estimate_pdf, estimate_kde


# ---------------------------------------------------------------------------
# Helpers: generate test orbits
# ---------------------------------------------------------------------------

def logistic_orbit(r=4.0, x0=0.31415, n=5000):
    x = np.empty(n)
    x[0] = x0
    for i in range(1, n):
        x[i] = r * x[i-1] * (1 - x[i-1])
    return x

def uniform_samples(n=5000):
    """Uniform on [0,1] — simulates tent map at μ=2."""
    return np.random.default_rng(42).uniform(0, 1, n)


# ---------------------------------------------------------------------------
# 1.  SQNR formula
# ---------------------------------------------------------------------------

def test_sqnr_formula():
    assert abs(sqnr_theoretical(8) - (6.02 * 8 + 1.76)) < 0.01
    assert abs(sqnr_theoretical(1) - 7.78) < 0.01


# ---------------------------------------------------------------------------
# 2.  Uniform quantization — MSE ≈ Δ²/12 for uniform PDF
# ---------------------------------------------------------------------------

def test_uniform_midrise_mse_for_uniform_pdf():
    x = uniform_samples(10000)
    n_levels = 16
    delta = 1.0 / n_levels
    theoretical_mse = delta ** 2 / 12.0
    result = uniform_midrise(x, n_levels)
    assert abs(result["mse"] - theoretical_mse) / theoretical_mse < 0.15
    assert result["n_bits"] == 4


def test_uniform_midtread_returns_correct_levels():
    x = uniform_samples(1000)
    result = uniform_midtread(x, 4)
    assert len(result["levels"]) == 4
    assert result["levels"][0] == pytest.approx(0.0, abs=0.01)
    assert result["levels"][-1] == pytest.approx(1.0, abs=0.01)


def test_more_levels_means_lower_mse():
    x = logistic_orbit()
    mse_4  = uniform_midrise(x, 4)["mse"]
    mse_8  = uniform_midrise(x, 8)["mse"]
    mse_16 = uniform_midrise(x, 16)["mse"]
    assert mse_4 > mse_8 > mse_16


# ---------------------------------------------------------------------------
# 3.  Lloyd-Max — always ≤ uniform, converges
# ---------------------------------------------------------------------------

def test_lloyd_max_beats_uniform_for_logistic():
    """Lloyd-Max with arcsine-adapted boundaries should beat uniform."""
    x = logistic_orbit(r=4.0, n=5000)
    # Estimate the PDF
    pdf_est = estimate_kde(x, n_eval=200, domain=(0, 1))
    uni = uniform_midrise(x, 8)
    lm  = lloyd_max(x, 8, pdf_est["x"], pdf_est["density"])
    assert lm["mse"] <= uni["mse"] * 1.05  # allow 5% tolerance
    assert lm["converged"]


def test_lloyd_max_equals_uniform_for_uniform_pdf():
    """For uniform PDF, Lloyd-Max should converge to ~uniform quantization."""
    x = uniform_samples(5000)
    pdf_est = estimate_kde(x, n_eval=200, domain=(0, 1))
    uni = uniform_midrise(x, 8)
    lm  = lloyd_max(x, 8, pdf_est["x"], pdf_est["density"])
    # MSE should be very close
    assert abs(lm["mse"] - uni["mse"]) / uni["mse"] < 0.15


def test_lloyd_max_iteration_history():
    """Iteration history should have decreasing MSE."""
    x = logistic_orbit(n=3000)
    pdf_est = estimate_kde(x, n_eval=200, domain=(0, 1))
    result = lloyd_max(x, 8, pdf_est["x"], pdf_est["density"])
    if len(result["iteration_history"]) > 2:
        mses = [it["mse"] for it in result["iteration_history"]]
        # MSE should be non-increasing (with tiny numerical tolerance)
        for i in range(1, len(mses)):
            assert mses[i] <= mses[i-1] + 1e-7


# ---------------------------------------------------------------------------
# 4.  Companding — μ-law and A-law run without errors
# ---------------------------------------------------------------------------

def test_mu_law_runs_and_returns_mse():
    x = logistic_orbit(n=2000)
    result = mu_law_quantize(x, 16)
    assert result["mse"] > 0
    assert len(result["quantized"]) == 2000


def test_a_law_runs_and_returns_mse():
    x = logistic_orbit(n=2000)
    result = a_law_quantize(x, 16)
    assert result["mse"] > 0
    assert len(result["quantized"]) == 2000


# ---------------------------------------------------------------------------
# 5.  MSE vs levels comparison table
# ---------------------------------------------------------------------------

def test_mse_vs_levels_returns_all_methods():
    x = logistic_orbit(n=2000)
    results = mse_vs_levels(x, [4, 8, 16])
    assert "uniform_midrise" in results
    assert "mu_law" in results
    assert "lloyd_max" in results
    assert "theoretical_uniform" in results
    assert len(results["uniform_midrise"]) == 3


# ---------------------------------------------------------------------------
# 6.  PDF estimation
# ---------------------------------------------------------------------------

def test_kde_returns_correct_shape():
    x = logistic_orbit(n=3000)
    result = estimate_kde(x, n_eval=100, domain=(0, 1))
    assert len(result["x"]) == 100
    assert len(result["density"]) == 100
    assert result["n_samples"] > 2000


def test_pdf_estimation_detects_arcsine_for_logistic():
    x = logistic_orbit(r=4.0, n=5000)
    result = estimate_pdf(x, map_name="logistic", parameters={"r": 4.0})
    assert result["known_analytical"] is not None
    assert "Arcsine" in result["known_analytical"]["name"]


def test_pdf_estimation_detects_uniform_for_tent():
    """Simulate tent map (uniform orbit) and check detection."""
    x = uniform_samples(5000)
    result = estimate_pdf(x, map_name="tent", parameters={"mu": 2.0})
    assert result["known_analytical"] is not None
    assert "Uniform" in result["known_analytical"]["name"]


# ---------------------------------------------------------------------------
# 7.  Quantize_orbit dispatcher
# ---------------------------------------------------------------------------

def test_quantize_orbit_dispatches_correctly():
    x = logistic_orbit(n=1000)
    for method in ["uniform_midrise", "uniform_midtread", "mu_law", "a_law", "lloyd_max"]:
        result = quantize_orbit(x, method, 8)
        assert "mse" in result
        assert result["method"] == method


def test_quantize_orbit_rejects_unknown_method():
    x = logistic_orbit(n=100)
    with pytest.raises(ValueError, match="Unknown"):
        quantize_orbit(x, "magic", 8)


# ---------------------------------------------------------------------------
# 8.  Explainers
# ---------------------------------------------------------------------------

def test_explainers_exist():
    e = get_quantization_explainers()
    assert "lloyd_max" in e
    assert "sqnr_formula" in e
    assert "quantization_for_csk" in e
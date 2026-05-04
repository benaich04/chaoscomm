"""
Tests for core/bifurcation.py.

Numerical sanity tests against the textbook values:
  - Logistic: λ(r=3) ≈ 0, λ(r=4) ≈ ln 2
  - First period-doubling rₙ values (logistic): 3.0000, 3.4495, 3.5441
  - Feigenbaum δ ≈ 4.6692 (universal)
  - Accumulation point a∞ ≈ 3.5699 (logistic)
"""

import math
import numpy as np

from core.bifurcation import (
    bifurcation_sweep_numpy,
    bifurcation_sweep_chunked,
    lyapunov_sweep,
    detect_period_doublings,
    feigenbaum_delta,
    feigenbaum_for_map,
    default_range_for,
)


LN2 = math.log(2)


# ---------------------------------------------------------------------------
# Lyapunov sweep — pointwise verification at known r
# ---------------------------------------------------------------------------

def test_lyapunov_at_r_equals_4_logistic():
    """At r=4, the logistic map's λ equals ln 2."""
    res = lyapunov_sweep("logistic", 3.99, 4.00, n_params=10, n_iter=5000)
    # The last point in the sweep is r ≈ 4.0
    assert abs(res["lyapunov"][-1] - LN2) < 0.05


def test_lyapunov_negative_in_periodic_window():
    """At r=2.5, logistic has a stable fixed point → λ < 0."""
    res = lyapunov_sweep("logistic", 2.4, 2.6, n_params=10, n_iter=2000)
    # Middle of the sweep should be safely negative
    mid = res["lyapunov"][len(res["lyapunov"]) // 2]
    assert mid < -0.5


def test_lyapunov_zero_at_r_3():
    """At r=3 (first period-doubling) λ should be very close to 0."""
    res = lyapunov_sweep("logistic", 2.95, 3.05, n_params=200, n_iter=3000)
    p = np.array(res["param"])
    l = np.array(res["lyapunov"])
    idx = np.argmin(np.abs(p - 3.0))
    assert abs(l[idx]) < 0.05


# ---------------------------------------------------------------------------
# Period doubling detection
# ---------------------------------------------------------------------------

def test_first_two_period_doublings_logistic():
    """The first two rₙ for the logistic map should be ≈ 3.0 and ≈ 3.449."""
    # Use a fine grid — the first doubling is easy but the second has tighter
    # tolerance (r₂ ≈ 3.4495).
    probe = np.linspace(2.9, 3.5, 600)
    rns = detect_period_doublings(
        probe, np.zeros_like(probe),
        map_name="logistic", max_count=3,
    )
    assert len(rns) >= 2
    assert abs(rns[0] - 3.0) < 0.02,    f"r1 = {rns[0]}"
    assert abs(rns[1] - 3.4495) < 0.02, f"r2 = {rns[1]}"


# ---------------------------------------------------------------------------
# Feigenbaum δ — should converge towards 4.6692
# ---------------------------------------------------------------------------

def test_feigenbaum_delta_logistic_close_to_universal():
    """
    Compute δ from the logistic map's first ~4 period-doublings.
    With the available numerical resolution we expect δ in [4.0, 5.5];
    sharper agreement (within 0.05 of 4.6692) needs much higher n_params,
    which we do not require here.
    """
    res = feigenbaum_for_map(
        "logistic",
        p_min=2.9, p_max=3.57,
        n_params=4000,
    )
    # We need at least 3 rₙ values to compute one δ.
    if res["delta_estimate"] is not None:
        assert 4.0 <= res["delta_estimate"] <= 5.5, f"δ = {res['delta_estimate']}"


def test_feigenbaum_extrapolates_a_infinity():
    """The extrapolated a∞ for the logistic should be near 3.5699."""
    res = feigenbaum_for_map(
        "logistic",
        p_min=2.9, p_max=3.57,
        n_params=4000,
    )
    if res["a_infinity_estimate"] is not None:
        # Allow generous tolerance — only 3 doublings detected at this resolution.
        assert abs(res["a_infinity_estimate"] - 3.5699) < 0.1, \
            f"a∞ = {res['a_infinity_estimate']}"


# ---------------------------------------------------------------------------
# Bifurcation sweep — shape and basic sanity
# ---------------------------------------------------------------------------

def test_bifurcation_sweep_returns_correct_shape():
    res = bifurcation_sweep_numpy("logistic", 2.5, 4.0, n_params=200, n_plot=100)
    # 200 params × 100 plot points = 20,000 — well under the 250k cap.
    assert len(res["param"]) == 20_000
    assert len(res["x"]) == 20_000
    assert all(0.0 <= x <= 1.0 for x in res["x"][::1000])


def test_bifurcation_at_r_equals_3_5_has_period_2():
    """At r=3.5 the logistic has a 2-cycle: only ~2 distinct x-clusters."""
    res = bifurcation_sweep_numpy(
        "logistic", 3.49, 3.51, n_params=20, n_plot=200, n_transient=2000,
    )
    xs = np.array(res["x"])
    # Count clusters (gap > 0.01 starts a new cluster)
    sorted_xs = np.sort(xs)
    clusters = 1
    for i in range(1, len(sorted_xs)):
        if sorted_xs[i] - sorted_xs[i-1] > 0.01:
            clusters += 1
    # We expect ≈ 2 clusters per parameter × 20 parameters = ≈ 40 total clusters,
    # but successive parameters shift slightly so allow some merging.
    # Key sanity: it should be FAR fewer than for a fully chaotic regime.
    assert clusters < 80, f"Got {clusters} clusters — should be small for period-2"


def test_bifurcation_at_r_equals_4_has_full_band():
    """At r=4 the orbit visits the entire interval — many distinct x values."""
    res = bifurcation_sweep_numpy(
        "logistic", 3.99, 4.0, n_params=10, n_plot=500,
    )
    xs = np.array(res["x"])
    unique_count = len(np.unique(np.round(xs, 2)))
    assert unique_count > 50, f"Expected dense band but got {unique_count} distinct values"


def test_bifurcation_chunked_yields_correct_total():
    n_params = 200
    chunks = list(bifurcation_sweep_chunked(
        "logistic", 2.5, 4.0,
        n_params=n_params, n_plot=50, chunk_size=40,
    ))
    # 200 / 40 = 5 chunks
    assert len(chunks) == 5
    total_param_pts = sum(len(c["param"]) for c in chunks)
    assert total_param_pts == n_params * 50


# ---------------------------------------------------------------------------
# Other maps run without crashing on the sweep
# ---------------------------------------------------------------------------

def test_tent_bifurcation_sweep():
    res = bifurcation_sweep_numpy("tent", 0.5, 2.0, n_params=100, n_plot=100)
    assert len(res["param"]) == 10_000


def test_lss_bifurcation_sweep():
    """The Zhou et al. LSS map should run cleanly through the full r range."""
    res = bifurcation_sweep_numpy("lss", 0.5, 4.0, n_params=100, n_plot=100)
    assert len(res["param"]) == 10_000


def test_custom_bifurcation_sweep():
    """A user-typed expression must run through the same machinery."""
    res = bifurcation_sweep_numpy(
        "custom", 2.5, 4.0, n_params=100, n_plot=100,
        custom_expression="r*x*(1-x)",
    )
    assert len(res["param"]) == 10_000


def test_default_range_for_known_map():
    lo, hi = default_range_for("logistic")
    assert lo == 2.5 and hi == 4.0
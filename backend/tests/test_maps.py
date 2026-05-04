"""
Sanity tests for core/maps.py.

These are not exhaustive — they are *sanity* tests covering values whose
correct answer is known in closed form (logistic at r=4 has λ = ln 2,
tent at μ=2 has λ = ln 2 exactly, etc.) plus the full set of negative
tests for the custom-expression parser.

Run with:    pytest backend/tests/test_maps.py -v
"""

import math

import numpy as np
import pytest
import sympy as sp

from core.maps import (
    MAP_REGISTRY,
    compute_orbit,
    compute_cobweb,
    parse_custom_expression,
    get_registry_payload,
)


# ---------------------------------------------------------------------------
# 1.  Lyapunov sanity (closed-form values)
# ---------------------------------------------------------------------------

LN2 = math.log(2)


def test_logistic_lyapunov_at_r_equals_4():
    """Logistic at r=4 has λ = ln 2 exactly (Ulam–von Neumann conjugacy)."""
    res = compute_orbit("logistic", {"r": 4.0}, [0.31415], n_samples=10_000)
    assert abs(res["lyapunov"] - LN2) < 0.05


def test_tent_lyapunov_at_mu_equals_2():
    """Tent at μ=2: |f'| = 2 everywhere → λ = ln 2 exactly."""
    res = compute_orbit("tent", {"mu": 2.0}, [0.31415], n_samples=10_000)
    assert abs(res["lyapunov"] - LN2) < 0.01


def test_bernoulli_lyapunov_exact():
    """Bernoulli shift: f' = 2 → λ = ln 2 exactly."""
    res = compute_orbit("bernoulli", {}, [0.31415927], n_samples=10_000)
    assert abs(res["lyapunov"] - LN2) < 0.01


def test_chebyshev_lyapunov_at_n_2():
    """T_2(x) = 2x²-1 is conjugate to the logistic at r=4 → λ = ln 2."""
    res = compute_orbit("chebyshev", {"n": 2}, [0.4], n_samples=10_000)
    assert abs(res["lyapunov"] - LN2) < 0.05


def test_chebyshev_lyapunov_at_n_3():
    """For Chebyshev T_n, λ = ln(n) exactly."""
    res = compute_orbit("chebyshev", {"n": 3}, [0.4], n_samples=10_000)
    assert abs(res["lyapunov"] - math.log(3)) < 0.05


def test_henon_lyapunov_standard():
    """Classical Hénon (a=1.4, b=0.3) has λ_max ≈ 0.42."""
    res = compute_orbit("henon", {"a": 1.4, "b": 0.3}, [0.0, 0.0], n_samples=5_000)
    assert 0.35 < res["lyapunov"] < 0.50, f"Got λ = {res['lyapunov']}"


# ---------------------------------------------------------------------------
# 2.  Fixed points (closed form)
# ---------------------------------------------------------------------------

def test_logistic_fixed_points_at_r_3():
    """Fixed points of f(x)=3x(1-x) are 0 and 2/3."""
    res = compute_orbit("logistic", {"r": 3.0}, [0.5], n_samples=200)
    fps = sorted(fp["x"] for fp in res["fixed_points"])
    np.testing.assert_allclose(fps, [0.0, 2.0 / 3.0], atol=1e-9)


def test_logistic_fixed_point_stability_at_r_2():
    """At r=2, the nontrivial fixed point x*=1/2 has |f'(x*)| = 0 → very stable."""
    res = compute_orbit("logistic", {"r": 2.0}, [0.31], n_samples=200)
    # Find the non-zero fixed point
    nz = [fp for fp in res["fixed_points"] if abs(fp["x"]) > 1e-9]
    assert len(nz) == 1
    assert nz[0]["stability"] == "stable"
    assert abs(nz[0]["x"] - 0.5) < 1e-12


def test_logistic_fixed_point_unstable_at_r_3_5():
    """At r=3.5, the non-zero fixed point is unstable (period-2 has taken over)."""
    res = compute_orbit("logistic", {"r": 3.5}, [0.31], n_samples=200)
    nz = [fp for fp in res["fixed_points"] if abs(fp["x"]) > 1e-9]
    assert len(nz) == 1
    assert nz[0]["stability"] == "unstable"


# ---------------------------------------------------------------------------
# 3.  Custom-expression parser — correctness
# ---------------------------------------------------------------------------

def test_custom_logistic_matches_builtin():
    """Typing 'r*x*(1-x)' should reproduce the built-in logistic exactly."""
    custom = compute_orbit(
        "custom", {"r": 4.0}, [0.31415], n_samples=200,
        custom_expression="r*x*(1 - x)",
    )
    builtin = compute_orbit(
        "logistic", {"r": 4.0}, [0.31415], n_samples=200,
    )
    np.testing.assert_allclose(custom["orbit"], builtin["orbit"], atol=1e-12)


def test_custom_sine_runs_cleanly():
    """A sine-based custom map should produce a sensible orbit."""
    res = compute_orbit(
        "custom", {"r": 0.99}, [0.31], n_samples=500,
        custom_expression="r*sin(pi*x)",
    )
    assert len(res["orbit"]) > 0
    assert math.isfinite(res["lyapunov"])


# ---------------------------------------------------------------------------
# 4.  Custom-expression parser — security (must REJECT malicious input)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("evil", [
    "__import__('os').system('rm -rf /')",
    "x.__class__.__base__",
    "open('/etc/passwd').read()",
    "eval('1+1')",
    "exec('print(1)')",
    "lambda y: y",
    "globals()",
])
def test_custom_blocks_forbidden_tokens(evil):
    with pytest.raises(ValueError):
        parse_custom_expression(evil)


def test_custom_blocks_unknown_symbols():
    """An expression that references a symbol other than x or r must fail."""
    with pytest.raises(ValueError, match="unknown symbol"):
        parse_custom_expression("y*x")


def test_custom_blocks_oversized_input():
    big = "x" + "+0" * 200
    with pytest.raises(ValueError, match="exceeds"):
        parse_custom_expression(big)


def test_custom_blocks_empty_input():
    with pytest.raises(ValueError, match="empty"):
        parse_custom_expression("")


# ---------------------------------------------------------------------------
# 5.  Orbit shape, length, parameter validation
# ---------------------------------------------------------------------------

def test_orbit_returns_correct_length():
    res = compute_orbit("logistic", {"r": 3.9}, [0.31], n_samples=1000)
    # Note: response is downsampled to MAX_RETURN_POINTS, so for n<=10000 length matches.
    assert len(res["orbit"]) == 1000
    assert res["orbit_full_length"] == 1000


def test_orbit_downsample_for_huge_n():
    res = compute_orbit("logistic", {"r": 3.9}, [0.31], n_samples=50_000)
    assert len(res["orbit"]) <= 10_000           # downsampled for transport
    assert res["orbit_full_length"] == 50_000     # but the math used all 50k


def test_invalid_parameter_out_of_range():
    with pytest.raises(ValueError, match="outside valid range"):
        compute_orbit("logistic", {"r": 10.0}, [0.31], n_samples=200)


def test_invalid_map_name():
    with pytest.raises(ValueError, match="Unknown map"):
        compute_orbit("not_a_map", {}, [0.5], n_samples=200)


def test_invalid_n_samples_too_small():
    with pytest.raises(ValueError):
        compute_orbit("logistic", {"r": 3.9}, [0.31], n_samples=10)


# ---------------------------------------------------------------------------
# 6.  Registry endpoint shape
# ---------------------------------------------------------------------------

def test_registry_payload_includes_all_maps():
    payload = get_registry_payload()
    assert "logistic" in payload["maps"]
    assert "lss" in payload["maps"]
    assert "tlc" in payload["maps"]
    assert "henon" in payload["maps"]
    assert payload["custom"]["dimension"] == 1
    assert "lyapunov" in payload["concepts"]
    assert "chaos_and_csk" in payload["concepts"]


def test_registry_payload_is_json_serializable():
    """A subtle bug-magnet — make sure no SymPy objects leak into the payload."""
    import json
    payload = get_registry_payload()
    # If anything is non-serializable this raises TypeError
    json.dumps(payload)


# ---------------------------------------------------------------------------
# 7.  Cobweb data (smoke test only)
# ---------------------------------------------------------------------------

def test_cobweb_logistic_returns_data():
    cw = compute_cobweb("logistic", {"r": 3.9}, x0=0.31, n_steps=20)
    assert len(cw["f_curve_x"]) == 400
    # Each iteration adds 2 points; plus the starting point.
    assert len(cw["cobweb_points"]) >= 21


def test_cobweb_rejects_2d_map():
    with pytest.raises(ValueError, match="1-D"):
        compute_cobweb("henon", {"a": 1.4, "b": 0.3}, x0=0.0, n_steps=10)
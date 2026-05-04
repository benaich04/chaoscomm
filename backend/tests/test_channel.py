import numpy as np
import pytest

from core.channel import (
    ideal_channel,
    awgn_channel,
    flat_fading_channel,
    rayleigh_fading_channel,
    rician_fading_channel,
    multipath_channel,
    jammer_channel,
    apply_channel,
    compare_channels,
    get_channel_explainers,
)


def test_ideal_channel_returns_same_waveform():
    x = np.array([1.0, -2.0, 3.0, -4.0])
    out = ideal_channel(x)

    assert out["channel_type"] == "ideal"
    assert np.allclose(out["received"], x)
    assert np.allclose(out["impairment"], np.zeros_like(x))
    assert out["metrics"]["impairment_power"] == 0.0


def test_awgn_channel_is_deterministic_with_seed():
    x = np.ones(100)
    a = awgn_channel(x, snr_db=10.0, seed=123)
    b = awgn_channel(x, snr_db=10.0, seed=123)

    assert np.allclose(a["received"], b["received"])
    assert a["channel_type"] == "awgn"
    assert a["metrics"]["noise_power"] > 0.0


def test_awgn_noise_power_close_to_requested_snr():
    x = np.ones(10000)
    out = awgn_channel(x, snr_db=10.0, seed=1)

    measured_snr = out["metrics"]["snr_db_measured"]

    # Random finite sample, so allow tolerance.
    assert abs(measured_snr - 10.0) < 0.5


def test_flat_fading_gain_without_noise():
    x = np.array([1.0, 2.0, 3.0])
    out = flat_fading_channel(x, gain=0.5, snr_db=None)

    assert out["channel_type"] == "flat_fading"
    assert np.allclose(out["received"], 0.5 * x)
    assert np.allclose(out["fading"], np.full_like(x, 0.5))


def test_rayleigh_fading_has_positive_gains():
    x = np.ones(100)
    out = rayleigh_fading_channel(x, snr_db=None, seed=5)

    h = np.array(out["fading"])

    assert out["channel_type"] == "rayleigh"
    assert np.all(h >= 0)
    assert len(h) == len(x)


def test_rayleigh_block_fading_uses_constant_gain():
    x = np.ones(50)
    out = rayleigh_fading_channel(x, snr_db=None, seed=5, block_fading=True)

    h = np.array(out["fading"])

    assert np.allclose(h, h[0])


def test_rician_fading_has_positive_gains():
    x = np.ones(100)
    out = rician_fading_channel(x, k_factor=5.0, snr_db=None, seed=7)

    h = np.array(out["fading"])

    assert out["channel_type"] == "rician"
    assert np.all(h >= 0)
    assert len(h) == len(x)


def test_multipath_channel_simple_delay():
    x = np.array([1.0, 2.0, 3.0, 4.0])

    # h[0] = 1, h[1] = 0.5
    out = multipath_channel(
        x,
        delays=[0, 1],
        gains=[1.0, 0.5],
        snr_db=None,
    )

    expected = np.array([
        1.0,
        2.0 + 0.5 * 1.0,
        3.0 + 0.5 * 2.0,
        4.0 + 0.5 * 3.0,
    ])

    assert out["channel_type"] == "multipath"
    assert np.allclose(out["received"], expected)
    assert np.allclose(out["impulse_response"], [1.0, 0.5])


def test_multipath_rejects_bad_lengths():
    x = np.ones(10)

    with pytest.raises(ValueError):
        multipath_channel(x, delays=[0, 1], gains=[1.0])


def test_jammer_channel_tone_has_requested_power():
    x = np.ones(1000)
    out = jammer_channel(
        x,
        jammer_type="tone",
        jsr_db=0.0,
        snr_db=None,
        fs=1.0,
        freq=0.05,
        seed=10,
    )

    assert out["channel_type"] == "jammer"
    assert "jammer" in out
    assert abs(out["metrics"]["jsr_db_measured"] - 0.0) < 0.2


def test_jammer_channel_supports_all_types():
    x = np.ones(500)

    for jt in ["tone", "broadband", "pulsed", "chirp"]:
        out = jammer_channel(
            x,
            jammer_type=jt,
            jsr_db=-3.0,
            snr_db=None,
            seed=10,
        )
        assert out["channel_type"] == "jammer"
        assert out["metrics"]["jammer_type"] == jt
        assert len(out["received"]) == len(x)


def test_apply_channel_dispatcher():
    x = np.ones(100)

    out = apply_channel(
        x,
        channel_type="awgn",
        params={"snr_db": 20.0, "seed": 1},
    )

    assert out["channel_type"] == "awgn"
    assert len(out["received"]) == len(x)


def test_apply_channel_rejects_unknown_channel():
    x = np.ones(10)

    with pytest.raises(ValueError):
        apply_channel(x, channel_type="not_a_channel")


def test_compare_channels_returns_multiple_results():
    x = np.ones(100)

    out = compare_channels(
        x,
        channel_specs=[
            {"channel_type": "ideal", "params": {}},
            {"channel_type": "awgn", "params": {"snr_db": 10.0, "seed": 1}},
        ],
    )

    assert "results" in out
    assert len(out["results"]) == 2
    assert out["results"][0]["channel_type"] == "ideal"
    assert out["results"][1]["channel_type"] == "awgn"


def test_channel_explainers_exist():
    explainers = get_channel_explainers()

    assert "awgn" in explainers
    assert "multipath" in explainers
    assert "jamming" in explainers
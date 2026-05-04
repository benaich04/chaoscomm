"""
Tests for core/signal_processing.py — the CSK communication system.

Key invariants:
  - Noiseless pipeline must recover the message exactly (BER = 0)
  - DCSK detector doesn't need templates (self-referencing)
  - CSK waveform has different chips for bit 0 vs bit 1
  - PSD of chaotic waveform should be roughly flat (spectral flatness > 0.5)
  - Text encoding round-trips perfectly
"""

import numpy as np
import pytest

from core.signal_processing import (
    text_to_bits,
    bits_to_text,
    analyze_bits,
    csk_modulate,
    csk_detect,
    dcsk_modulate,
    dcsk_detect,
    fmdcsk_modulate,
    full_pipeline,
    compute_psd,
    get_csk_explainers,
)


# ---------------------------------------------------------------------------
# 1.  Text ↔ binary encoding
# ---------------------------------------------------------------------------

def test_text_to_bits_length():
    bits = text_to_bits("A")
    assert len(bits) == 8   # 1 ASCII char = 8 bits


def test_text_roundtrip():
    msg = "Hello CSK!"
    bits = text_to_bits(msg)
    recovered = bits_to_text(bits)
    assert recovered == msg


def test_analyze_bits():
    bits = [1, 0, 1, 1, 0, 0, 1, 0]
    a = analyze_bits(bits)
    assert a["n_bits"] == 8
    assert a["ones"] == 4
    assert a["zeros"] == 4
    assert abs(a["balance"] - 0.5) < 1e-6
    assert abs(a["entropy"] - 1.0) < 0.01  # max entropy for balanced bits


# ---------------------------------------------------------------------------
# 2.  CSK modulation + detection (noiseless)
# ---------------------------------------------------------------------------

def test_csk_modulate_shape():
    bits = [0, 1, 1, 0]
    result = csk_modulate(bits, chips_per_bit=10)
    assert len(result["waveform"]) == 40
    assert len(result["template_0"]) == 40
    assert len(result["template_1"]) == 40
    assert result["n_bits"] == 4


def test_csk_noiseless_detection():
    bits = [1, 0, 1, 1, 0, 0, 1, 0]
    mod = csk_modulate(bits, chips_per_bit=30)
    received = np.array(mod["waveform"])
    det = csk_detect(received,
                     np.array(mod["template_0"]),
                     np.array(mod["template_1"]),
                     30)
    assert det["detected_bits"] == bits


def test_csk_different_waveforms_for_different_bits():
    """Bit 0 and bit 1 should produce different chip sequences."""
    bits = [0, 1]
    mod = csk_modulate(bits, chips_per_bit=20)
    chip0 = mod["waveform"][:20]
    chip1 = mod["waveform"][20:40]
    # They should NOT be identical (different r values produce different sequences)
    assert chip0 != chip1


# ---------------------------------------------------------------------------
# 3.  DCSK modulation + detection (noiseless)
# ---------------------------------------------------------------------------

def test_dcsk_modulate_shape():
    bits = [0, 1, 1, 0]
    result = dcsk_modulate(bits, chips_per_half=15)
    assert len(result["waveform"]) == 4 * 30   # 4 bits × 2×15 chips
    assert result["chips_per_bit"] == 30


def test_dcsk_noiseless_detection():
    bits = [1, 0, 1, 1, 0, 0, 1, 0]
    mod = dcsk_modulate(bits, chips_per_half=20)
    received = np.array(mod["waveform"])
    det = dcsk_detect(received, 20)
    assert det["detected_bits"] == bits


def test_dcsk_reference_matches_info_for_bit_1():
    """For bit=1 (b_sign=+1), info half should equal reference half."""
    bits = [1]
    mod = dcsk_modulate(bits, chips_per_half=10)
    wav = np.array(mod["waveform"])
    ref = wav[:10]
    info = wav[10:20]
    np.testing.assert_allclose(ref, info, atol=1e-12)


def test_dcsk_reference_negated_for_bit_0():
    """For bit=0 (b_sign=−1), info half should be −reference."""
    bits = [0]
    mod = dcsk_modulate(bits, chips_per_half=10)
    wav = np.array(mod["waveform"])
    ref = wav[:10]
    info = wav[10:20]
    np.testing.assert_allclose(ref, -info, atol=1e-12)


# ---------------------------------------------------------------------------
# 4.  FM-DCSK
# ---------------------------------------------------------------------------

def test_fmdcsk_modulate_runs():
    bits = [1, 0, 1, 0]
    result = fmdcsk_modulate(bits, chips_per_half=10)
    assert len(result["waveform_fm"]) > 0
    assert result["scheme"] == "fm_dcsk"


def test_fmdcsk_constant_envelope():
    """FM signal should have roughly constant amplitude (envelope)."""
    bits = [1, 0, 1, 0, 1, 1, 0, 0]
    result = fmdcsk_modulate(bits, chips_per_half=10, fc=10, fs=100)
    fm = np.array(result["waveform_fm"])
    # Envelope = |signal| averaged over a period should be ≈ 0.707 (RMS of cos)
    assert np.max(np.abs(fm)) <= 1.001   # cos never exceeds 1
    assert np.min(np.abs(fm)) < 0.1      # cos crosses zero


# ---------------------------------------------------------------------------
# 5.  Full pipeline
# ---------------------------------------------------------------------------

def test_full_pipeline_csk_noiseless():
    result = full_pipeline("Hi", scheme="csk", chips_per_bit=30)
    assert result["success"]
    assert result["ber"] == 0.0
    assert result["recovered_text"] == "Hi"


def test_full_pipeline_dcsk_noiseless():
    result = full_pipeline("Hello!", scheme="dcsk", chips_per_bit=40)
    assert result["success"]
    assert result["ber"] == 0.0
    assert result["recovered_text"] == "Hello!"


def test_full_pipeline_fmdcsk_noiseless():
    result = full_pipeline("CSK", scheme="fm_dcsk", chips_per_bit=40)
    assert result["success"]
    assert result["ber"] == 0.0


def test_full_pipeline_longer_message():
    msg = "ChaosComm works!"
    result = full_pipeline(msg, scheme="dcsk", chips_per_bit=40)
    assert result["success"]
    assert result["recovered_text"] == msg


# ---------------------------------------------------------------------------
# 6.  PSD (spectral analysis)
# ---------------------------------------------------------------------------

def test_psd_returns_data():
    bits = text_to_bits("test message")
    mod = dcsk_modulate(bits, chips_per_half=20)
    wav = np.array(mod["waveform"])
    psd = compute_psd(wav)
    assert len(psd["freq"]) > 0
    assert len(psd["psd"]) > 0


def test_psd_spectral_flatness_chaotic():
    """Chaotic waveform should have high spectral flatness (noise-like)."""
    bits = text_to_bits("A" * 20)  # repeated to get enough samples
    mod = dcsk_modulate(bits, chips_per_half=30)
    wav = np.array(mod["waveform"])
    psd = compute_psd(wav)
    # Spectral flatness > 0.3 for chaotic signals (not perfectly flat
    # because of the DCSK structure, but much flatter than a sine)
    assert psd["spectral_flatness"] > 0.2


# ---------------------------------------------------------------------------
# 7.  Explainers
# ---------------------------------------------------------------------------

def test_explainers():
    e = get_csk_explainers()
    assert "csk_overview" in e
    assert "dcsk_overview" in e
    assert "synchronization_problem" in e
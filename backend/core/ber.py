"""
core/ber.py — Bit Error Rate Analysis via the Q-Function.

The Q-function is the tail probability of the standard normal:

    Q(x) = (1/√(2π)) ∫_x^∞ exp(-t²/2) dt = (1/2) erfc(x/√2)

It appears in every BER formula because the matched filter output in
AWGN is Gaussian — detection is a threshold test on a Gaussian variable.

---

THEORETICAL BER FORMULAS:

1. BPSK (Binary Phase Shift Keying) — baseline reference
   P_e = Q(√(2 Eb/N0))
   This is the best possible BER for antipodal signaling.
   ρ = -1 (signals are exact negatives of each other)

2. CSK (Chaotic Shift Keying) with correlation coefficient ρ
   For two chaotic sequences s0, s1 with normalized cross-correlation ρ:
   P_e = Q(√( (1-ρ)/2 · Eb/N0 · β ))
   where β = chips per bit (processing gain)
   
   When ρ = -1 (antipodal): P_e = Q(√(Eb/N0 · β)) — matches BPSK+spread
   When ρ =  0 (orthogonal): P_e = Q(√(Eb/N0 · β / 2))
   When ρ =  1 (same seq):   P_e = 0.5 (coin flip — can't distinguish bits)
   
   Your professor's formula: P_e = Q(√((1-ρ)/2 · SNR))
   where SNR = Eb/N0 · β

3. DCSK (Differential CSK) — self-referencing, no sync needed
   P_e = Q(√( β · Eb/N0 / (2 + 4·β·Eb/N0 · σ²_β) ))
   
   Simplified (large β limit):
   P_e ≈ Q(√( β / (2·σ²_s) · Eb/N0 ))
   
   Key: DCSK is ~3 dB worse than coherent CSK at same Eb/N0
   because half the energy goes to the reference segment.

4. FM-DCSK — same BER as DCSK for narrowband channel

---

DERIVATION SKETCH (for the learner cards):
   At the correlator output, the decision variable is:
   z = ∫ r(t)·s(t) dt  where r(t) = s(t) + n(t)
   
   z = ∫ s²(t) dt + ∫ n(t)·s(t) dt = Es + η
   
   η ~ N(0, N0/2 · Es)   (noise after correlation)
   
   SNR_out = Es² / Var(η) = 2Es/N0 = 2·β·Ec/N0
   
   P_e = Q(√(SNR_out / 2)) = Q(√(β·Eb/N0))  for antipodal CSK
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.special import erfc, erfcinv



# ===========================================================================
# THE Q-FUNCTION
# ===========================================================================

def Q(x: float | np.ndarray) -> float | np.ndarray:
    """Q(x) = 0.5 · erfc(x / √2)  — tail probability of standard normal."""
    return 0.5 * erfc(np.asarray(x, dtype=np.float64) / math.sqrt(2.0))


def Q_inv(p: float) -> float:
    """Inverse Q-function: Q_inv(p) = √2 · erfc_inv(2p)."""
    p = float(np.clip(p, 1e-12, 1.0 - 1e-12))
    return float(math.sqrt(2.0) * erfcinv(2.0 * p))


# ===========================================================================
# EXPLAINERS
# ===========================================================================

BER_EXPLAINERS = {
    "q_function": (
        "The Q-function Q(x) is the probability that a standard normal random "
        "variable exceeds x: Q(x) = P(Z > x) = (1/√2π)∫_x^∞ e^{-t²/2} dt. "
        "It equals (1/2)·erfc(x/√2) where erfc is the complementary error "
        "function.  It appears in every BER formula because the matched "
        "filter output in AWGN is Gaussian — detection is asking 'did the "
        "Gaussian noise push the output across the threshold?'"
    ),
    "bpsk_ber": (
        "BPSK sends bit 0 as +√Es and bit 1 as -√Es (or vice versa).  "
        "The correlation coefficient ρ = -1 (signals are antipodal).  "
        "BER = Q(√(2Eb/N0)).  This is the Shannon limit for antipodal "
        "binary signaling — no other uncoded scheme can beat it.  At "
        "Eb/N0 = 10 dB (factor of 10), BER ≈ 4×10⁻⁶."
    ),
    "csk_ber": (
        "For CSK with two chaotic sequences having cross-correlation ρ, "
        "BER = Q(√((1-ρ)/2 · SNR)) where SNR = β·Eb/N0.  "
        "The (1-ρ)/2 factor is the 'separability' of the two sequences.  "
        "When ρ = -1 (antipodal CSK): BER = Q(√(SNR)) — same as spread BPSK.  "
        "When ρ = 0 (orthogonal): BER = Q(√(SNR/2)) — 3 dB worse.  "
        "Chaotic sequences typically have |ρ| ≈ 0.1–0.3, giving "
        "BER ≈ Q(√(0.35–0.45 · SNR))."
    ),
    "dcsk_ber": (
        "DCSK uses half the bit period for a reference (wasted energy) and "
        "half for data.  BER = Q(√(β·Eb/N0 / 2)) approximately — a 3 dB "
        "penalty vs coherent CSK.  The trade-off: DCSK needs NO "
        "synchronization between transmitter and receiver, because the "
        "reference travels with the data.  In practice, for β = 100 chips "
        "per bit, DCSK achieves BER = 10⁻³ at Eb/N0 ≈ 8 dB vs ≈ 5 dB for BPSK."
    ),
    "processing_gain_ber": (
        "Spreading the signal over β chips gives processing gain "
        "Gp = 10·log10(β) dB.  This shifts the BER curve LEFT by Gp dB — "
        "you can tolerate more noise (lower Eb/N0) while maintaining the "
        "same BER.  A β = 100 chip spread gives 20 dB of processing gain: "
        "your transmitter can be 100× weaker than the noise floor and still "
        "be detected by the matched-filter receiver.  This is the anti-jam "
        "advantage of spread-spectrum CSK."
    ),
    "monte_carlo": (
        "Monte Carlo BER simulation verifies the theoretical formulas.  "
        "For each Eb/N0 point: generate random bits, modulate with CSK/DCSK, "
        "add AWGN noise at the specified level, run the matched-filter "
        "detector, count bit errors.  Repeat until enough errors accumulate "
        "(typically 100+ errors per point for statistical significance).  "
        "The simulated BER should match the theoretical Q-function curves "
        "within ±1 dB — a useful sanity check of the entire system."
    ),
}


# ===========================================================================
# THEORETICAL BER CURVES
# ===========================================================================

def ber_bpsk(ebn0_db_values: list[float]) -> list[float]:
    """
    BPSK BER = Q(√(2·Eb/N0))   [ρ = -1, antipodal]
    """
    results = []
    for ebn0_db in ebn0_db_values:
        ebn0 = 10 ** (ebn0_db / 10.0)
        ber = float(Q(math.sqrt(2.0 * ebn0)))
        results.append(max(ber, 1e-12))
    return results


def ber_csk(
    ebn0_db_values: list[float],
    rho: float = 0.0,
    beta: int = 1,
) -> list[float]:
    """
    CSK BER = Q(√( (1-ρ)/2 · β · Eb/N0 ))

    Parameters
    ----------
    rho  : cross-correlation between bit-0 and bit-1 templates, ρ ∈ [-1, 1]
    beta : chips per bit (processing gain factor)

    Special cases:
      ρ = -1 → antipodal CSK = spread BPSK, BER = Q(√(β·Eb/N0))
      ρ =  0 → orthogonal CSK, BER = Q(√(β·Eb/N0 / 2))
      ρ = +1 → identical sequences, BER = 0.5 (random guess)
    """
    coeff = (1.0 - rho) / 2.0
    results = []
    for ebn0_db in ebn0_db_values:
        ebn0 = 10 ** (ebn0_db / 10.0)
        snr_arg = coeff * beta * ebn0
        if snr_arg <= 0:
            results.append(0.5)
        else:
            ber = float(Q(math.sqrt(snr_arg)))
            results.append(max(ber, 1e-12))
    return results


def ber_dcsk(
    ebn0_db_values: list[float],
    beta: int = 40,
) -> list[float]:
    """
    DCSK BER ≈ Q(√( β · Eb/N0 / 2 ))

    The factor of 2 in the denominator is the DCSK penalty:
    half the bit energy is spent on the reference segment.
    """
    results = []
    for ebn0_db in ebn0_db_values:
        ebn0 = 10 ** (ebn0_db / 10.0)
        snr_arg = (beta / 2.0) * ebn0
        ber = float(Q(math.sqrt(snr_arg)))
        results.append(max(ber, 1e-12))
    return results


def ber_fmdcsk(
    ebn0_db_values: list[float],
    beta: int = 40,
) -> list[float]:
    """FM-DCSK BER ≈ DCSK BER for narrowband channel."""
    return ber_dcsk(ebn0_db_values, beta)


def all_ber_curves(
    ebn0_db_values: list[float],
    rho: float = 0.0,
    beta: int = 40,
) -> dict[str, Any]:
    """
    Compute BER for all schemes at all Eb/N0 values.
    Returns a dict of curve arrays ready for the frontend.
    """
    return {
        "ebn0_db": ebn0_db_values,
        "bpsk":    ber_bpsk(ebn0_db_values),
        "csk_antipodal": ber_csk(ebn0_db_values, rho=-1.0, beta=beta),
        "csk_orthogonal": ber_csk(ebn0_db_values, rho=0.0, beta=beta),
        "csk_rho":  ber_csk(ebn0_db_values, rho=rho, beta=beta),
        "dcsk":    ber_dcsk(ebn0_db_values, beta=beta),
        "rho": rho,
        "beta": beta,
        "formulas": {
            "bpsk":    "Q(√(2·Eb/N0))",
            "csk":     f"Q(√((1-ρ)/2 · β · Eb/N0)),  ρ={rho:.2f}, β={beta}",
            "dcsk":    f"Q(√(β·Eb/N0 / 2)),  β={beta}",
        },
    }


# ===========================================================================
# MONTE CARLO SIMULATION
# ===========================================================================

def monte_carlo_ber(
    ebn0_db: float,
    scheme: str = "dcsk",
    beta: int = 40,
    rho: float = 0.0,
    n_bits: int = 2000,
    rng_seed: int = 42,
) -> dict[str, Any]:
    """
    Monte Carlo BER simulation for one Eb/N0 point.
    """
    rng = np.random.default_rng(rng_seed)
    bits = rng.integers(0, 2, size=n_bits)

    # === Visualization storage ===
    z_values = []
    detected_bits = []
    true_bits = []

    # === Chaotic sequence generator ===
    def logistic_seq(n, x0=0.31415, r=3.9):
        x = np.empty(n)
        x[0] = x0
        for i in range(1, n):
            x[i] = r * x[i-1] * (1 - x[i-1])
        return x

    ebn0 = 10 ** (ebn0_db / 10.0)
    errors = 0

    # ============================================================
    # DCSK
    # ============================================================
    if scheme == "dcsk":
        half = beta // 2
        chips_per_bit = 2 * half

        seq = logistic_seq(n_bits * half + 200)[200:]

        noise_var = half / (2.0 * ebn0)
        noise_std = math.sqrt(noise_var)

        for i, bit in enumerate(bits):
            ref = seq[i * half:(i + 1) * half]
            b_sign = 1.0 if bit == 1 else -1.0
            info = b_sign * ref

            waveform = np.concatenate([ref, info])
            received = waveform + rng.normal(0, noise_std, chips_per_bit)

            r_ref = received[:half]
            r_info = received[half:]

            z = float(np.dot(r_ref, r_info))
            detected = 1 if z > 0 else 0

            if detected != bit:
                errors += 1

            # Store for visualization
            if i < 200:
                z_values.append(z)
                detected_bits.append(int(detected))
                true_bits.append(int(bit))

    # ============================================================
    # CSK
    # ============================================================
    elif scheme == "csk":
        s0 = logistic_seq(n_bits * beta + 200, r=3.6)[200:]
        s1 = logistic_seq(n_bits * beta + 200, r=3.9)[200:]

        noise_var = beta / (2.0 * ebn0)
        noise_std = math.sqrt(noise_var)

        for i, bit in enumerate(bits):
            tmpl0 = s0[i * beta:(i + 1) * beta]
            tmpl1 = s1[i * beta:(i + 1) * beta]

            template = tmpl1 if bit == 1 else tmpl0
            received = template + rng.normal(0, noise_std, beta)

            c0 = float(np.dot(received, tmpl0))
            c1 = float(np.dot(received, tmpl1))

            z = c1 - c0   # decision variable
            detected = 1 if z > 0 else 0

            if detected != bit:
                errors += 1

            # Store for visualization
            if i < 200:
                z_values.append(z)
                detected_bits.append(int(detected))
                true_bits.append(int(bit))

    # ============================================================
    # RESULTS
    # ============================================================
    ber_sim = errors / n_bits

    if scheme == "dcsk":
        ber_theory = float(Q(math.sqrt((beta / 2.0) * ebn0)))
    else:
        ber_theory = float(Q(math.sqrt((1.0 - rho) / 2.0 * beta * ebn0)))

    return {
        "ebn0_db": float(ebn0_db),
        "ber_simulated": float(max(ber_sim, 1.0 / (n_bits * 10))),
        "ber_theoretical": float(max(ber_theory, 1e-12)),
        "n_bits": int(n_bits),
        "n_errors": int(errors),
        "scheme": str(scheme),
        "beta": int(beta),

        "z_values": [float(z) for z in z_values],
        "detected_bits": [int(b) for b in detected_bits],
        "true_bits": [int(b) for b in true_bits],
    }


def monte_carlo_sweep(
    ebn0_db_values: list[float],
    scheme: str = "dcsk",
    beta: int = 40,
    rho: float = 0.0,
    n_bits: int = 1000,
) -> dict[str, Any]:
    """Run Monte Carlo BER at each Eb/N0 in the sweep."""
    sim_bers = []
    theory_bers = []
    for i, ebn0_db in enumerate(ebn0_db_values):
        result = monte_carlo_ber(ebn0_db, scheme, beta, rho, n_bits, rng_seed=i)
        sim_bers.append(result["ber_simulated"])
        theory_bers.append(result["ber_theoretical"])
    return {
        "ebn0_db": [float(x) for x in ebn0_db_values],
        "ber_simulated": [float(x) for x in sim_bers],
        "ber_theoretical": [float(x) for x in theory_bers],
        "scheme": str(scheme),
        "beta": int(beta),
    }


def get_ber_explainers() -> dict[str, str]:
    return BER_EXPLAINERS
// Pure simulation engine for the mission system.
// Deterministic: same inputs → same outputs (except where noise is wanted).

import { PLATFORM_DATA, ENEMY_DATA } from "./AircraftAssets.jsx";

// ─── Seedable PRNG ────────────────────────────────────────────────────────────

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller Gaussian noise from a uniform PRNG
function gauss(rng) {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ─── Q-function ───────────────────────────────────────────────────────────────

export function Qfn(x) {
  if (!isFinite(x)) return x > 0 ? 0 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf_complement = poly * Math.exp(-x * x);
  return x >= 0 ? 0.5 * erf_complement : 1 - 0.5 * erf_complement;
}

// ─── Chaotic sequence generation ──────────────────────────────────────────────

export function chaoticSeq(map, param, x0, n) {
  const out = new Float64Array(n);
  let x = x0;
  for (let i = 0; i < n; i++) {
    out[i] = x;
    if (map === "logistic")        x = param * x * (1 - x);
    else if (map === "tent")       x = x < 0.5 ? param * x : param * (1 - x);
    else if (map === "bernoulli")  x = (2 * x) % 1;
    else if (map === "chebyshev")  x = Math.cos(param * Math.acos(Math.max(-1, Math.min(1, x))));
    else                            x = 3.9 * x * (1 - x);
    if (!isFinite(x)) x = 0.5;
  }
  return out;
}

// ─── Payload conversion ───────────────────────────────────────────────────────

export function textToBits(text) {
  const bits = [];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    for (let i = 7; i >= 0; i--) bits.push((c >> i) & 1);
  }
  return bits;
}

export function bitsToText(bits) {
  let out = "";
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let c = 0;
    for (let j = 0; j < 8; j++) c = (c << 1) | (bits[i + j] > 0.5 ? 1 : 0);
    if (c >= 32 && c < 127) out += String.fromCharCode(c);
    else out += "▓";
  }
  return out;
}

// 32×32 grayscale image → bits (4 bits/pixel)
export function imageToBits(pixels32x32) {
  const bits = [];
  for (const v of pixels32x32) {
    const q = Math.max(0, Math.min(15, Math.round(v / 16)));
    for (let i = 3; i >= 0; i--) bits.push((q >> i) & 1);
  }
  return bits;
}

export function bitsToImage(bits, total = 1024) {
  const out = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    let q = 0;
    for (let j = 0; j < 4; j++) q = (q << 1) | (bits[i * 4 + j] > 0.5 ? 1 : 0);
    out[i] = q * 16 + 8;
  }
  return out;
}

// Audio waveform (1024 samples) → 4-bit quantized bits
export function audioToBits(samples) {
  const bits = [];
  for (const v of samples) {
    const q = Math.max(0, Math.min(15, Math.round(((v + 1) / 2) * 15)));
    for (let i = 3; i >= 0; i--) bits.push((q >> i) & 1);
  }
  return bits;
}

export function bitsToAudio(bits, n = 1024) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let q = 0;
    for (let j = 0; j < 4; j++) q = (q << 1) | (bits[i * 4 + j] > 0.5 ? 1 : 0);
    out[i] = (q / 15) * 2 - 1;
  }
  return out;
}

// Built-in payloads
export function builtInImage(seed = 42) {
  const rng = mulberry32(seed);
  const out = new Uint8Array(32 * 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - 16, dy = y - 16, d = Math.sqrt(dx * dx + dy * dy);
      const inside = d < 12 ? 1 : 0;
      const ring = Math.abs(d - 8) < 1 ? 1 : 0;
      out[y * 32 + x] = (inside ? 200 : 30) + ring * 50 + Math.round(rng() * 8);
    }
  }
  return out;
}

export function builtInAudio(n = 1024) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = 0.5 * Math.sin(2 * Math.PI * i / 32) +
             0.3 * Math.sin(2 * Math.PI * i / 16) *
             Math.exp(-((i - n / 2) ** 2) / (n * n / 4));
  }
  return out;
}

// ─── Modulation / TX waveform ─────────────────────────────────────────────────

export function modulate(bits, scheme, chips, map, mapParam) {
  const seq = chaoticSeq(map, mapParam, 0.31415, bits.length * chips + 200);
  // Skip transient
  const usable = seq.slice(200);
  // Normalize
  let mean = 0; for (const v of usable) mean += v; mean /= usable.length;
  let std = 0; for (const v of usable) std += (v - mean) ** 2;
  std = Math.sqrt(std / usable.length) || 1;
  const normalized = usable.map(v => (v - mean) / std);

  const out = new Float64Array(bits.length * chips);
  if (scheme === "DCSK" || scheme === "FM-DCSK") {
    const half = Math.max(2, Math.floor(chips / 2));
    for (let b = 0; b < bits.length; b++) {
      const sign = bits[b] === 1 ? 1 : -1;
      for (let i = 0; i < half; i++) {
        const refV = normalized[b * half + i] || 0;
        out[b * chips + i] = refV;
        out[b * chips + half + i] = sign * refV;
      }
    }
  } else {
    // CSK: bit 0 → seq from r0, bit 1 → seq from r1
    const seq1 = chaoticSeq(map, mapParam, 0.6789, bits.length * chips + 200).slice(200);
    let m1 = 0; for (const v of seq1) m1 += v; m1 /= seq1.length;
    let s1 = 0; for (const v of seq1) s1 += (v - m1) ** 2; s1 = Math.sqrt(s1 / seq1.length) || 1;
    const norm1 = seq1.map(v => (v - m1) / s1);
    for (let b = 0; b < bits.length; b++) {
      const src = bits[b] === 1 ? norm1 : normalized;
      for (let i = 0; i < chips; i++) {
        out[b * chips + i] = src[b * chips + i] || 0;
      }
    }
  }
  return { signal: out, refSeq: normalized };
}

// ─── Channel ──────────────────────────────────────────────────────────────────

export function applyChannel(tx, channelType, snrDb, doppler, multipath, jammer, seed = 1) {
  const rng = mulberry32(seed);
  const out = new Float64Array(tx.length);
  const sigPow = tx.reduce((s, v) => s + v * v, 0) / tx.length;
  const noisePow = sigPow / Math.pow(10, snrDb / 10);
  const noiseStd = Math.sqrt(Math.max(noisePow, 1e-12));

  for (let i = 0; i < tx.length; i++) {
    let v = tx[i];
    // Doppler — slow phase rotation
    if (doppler !== 0) v *= Math.cos(2 * Math.PI * doppler * i);
    // Multipath echo
    if (channelType === "Multipath" || channelType === "Combined") {
      const ms = multipath || 0.3;
      if (i >= 5) v += ms * tx[i - 5] * 0.6;
      if (i >= 12) v += ms * tx[i - 12] * 0.3;
    }
    // Rayleigh fading
    if (channelType === "Rayleigh" || channelType === "Combined") {
      const fade = Math.sqrt(0.5) * Math.sqrt(gauss(rng) ** 2 + gauss(rng) ** 2);
      v *= Math.max(0.2, fade);
    }
    // AWGN
    v += noiseStd * gauss(rng);
    // Jammer (chirp interference)
    if (channelType === "Jammer" || channelType === "Combined") {
      const j = jammer || 0.3;
      v += j * Math.cos(2 * Math.PI * 0.07 * i + 0.3 * Math.sin(0.01 * i));
    }
    out[i] = v;
  }
  return out;
}

// ─── Receivers ────────────────────────────────────────────────────────────────

export function detectAlly(rx, scheme, chips, refSeq, n_bits, receiver = "Matched Filter") {
  const recovered = new Array(n_bits).fill(0);
  if (scheme === "DCSK" || scheme === "FM-DCSK") {
    const half = Math.max(2, Math.floor(chips / 2));
    for (let b = 0; b < n_bits; b++) {
      let z = 0;
      for (let i = 0; i < half; i++) {
        z += rx[b * chips + i] * rx[b * chips + half + i];
      }
      recovered[b] = z > 0 ? 1 : 0;
    }
  } else {
    // CSK requires both templates
    for (let b = 0; b < n_bits; b++) {
      let c0 = 0, c1 = 0;
      for (let i = 0; i < chips; i++) {
        const r = rx[b * chips + i];
        c0 += r * (refSeq[b * chips + i] || 0);
        // For demo, c1 uses opposite phase
        c1 += r * -(refSeq[b * chips + i] || 0);
      }
      recovered[b] = c1 > c0 ? 1 : 0;
    }
  }
  return recovered;
}

export function detectEnemy(rx, scheme, chips, n_bits, mode, seed = 99) {
  const recovered = new Array(n_bits).fill(0);
  const rng = mulberry32(seed);

  if (mode === "Wrong Key MF") {
    // Wrong chaotic key
    const wrong = chaoticSeq("logistic", 3.7, 0.555, rx.length + 100).slice(100);
    let m = 0; for (const v of wrong) m += v; m /= wrong.length;
    let s = 0; for (const v of wrong) s += (v - m) ** 2; s = Math.sqrt(s / wrong.length) || 1;
    const wn = wrong.map(v => (v - m) / s);
    for (let b = 0; b < n_bits; b++) {
      let z = 0;
      for (let i = 0; i < chips; i++) z += rx[b * chips + i] * wn[b * chips + i];
      // Add randomness to simulate imperfect detection
      recovered[b] = (z + 0.1 * gauss(rng)) > 0 ? 1 : 0;
    }
  } else if (mode === "Energy Detector") {
    // Threshold on energy — mostly random
    for (let b = 0; b < n_bits; b++) {
      let e = 0;
      for (let i = 0; i < chips; i++) e += rx[b * chips + i] ** 2;
      recovered[b] = (e > chips * 0.3 + gauss(rng)) ? (rng() > 0.5 ? 1 : 0) : (rng() > 0.5 ? 1 : 0);
    }
  } else if (mode === "Spectrum Detector") {
    // FFT-based — extract some structure but mostly fail
    for (let b = 0; b < n_bits; b++) recovered[b] = rng() > 0.5 ? 1 : 0;
  } else if (mode === "Blind Correlator") {
    // Auto-correlate received with itself
    for (let b = 0; b < n_bits; b++) {
      let z = 0;
      for (let i = 0; i < Math.floor(chips / 2); i++) {
        z += rx[b * chips + i] * rx[b * chips + Math.floor(chips / 2) + i];
      }
      recovered[b] = (z + 0.5 * gauss(rng)) > 0 ? 1 : 0;
    }
  } else {
    // Multi-attempt: try many strategies, pick best — still bad against good chaos
    for (let b = 0; b < n_bits; b++) recovered[b] = rng() > 0.5 ? 1 : 0;
  }
  return recovered;
}

// ─── BER + scoring ────────────────────────────────────────────────────────────

export function computeBER(originalBits, recoveredBits) {
  const n = Math.min(originalBits.length, recoveredBits.length);
  if (n === 0) return 0.5;
  let errs = 0;
  for (let i = 0; i < n; i++) if (originalBits[i] !== recoveredBits[i]) errs++;
  return errs / n;
}

// Predicted theoretical BER for ally given configuration
export function predictAllyBER(snrDb, chips, scheme, channelType, jammerStrength, multipath, allyReceiver, platform) {
  const ebn0 = Math.pow(10, snrDb / 10);
  const factor = scheme === "DCSK" ? chips / 2 : chips;
  let ber = Qfn(Math.sqrt(factor * ebn0));

  if (channelType === "Rayleigh" || channelType === "Combined") ber = Math.max(ber, ber * 5);
  if (channelType === "Multipath" || channelType === "Combined") ber += multipath * 0.05;
  if (channelType === "Jammer" || channelType === "Combined") ber += jammerStrength * 0.1;

  if (allyReceiver === "Correlator") ber *= 1.2;
  if (allyReceiver === "FFT Matched Filter") ber *= 0.95;

  // Platform Doppler effect
  const plat = PLATFORM_DATA[platform] || {};
  ber += (plat.dopplerBase || 0) * 0.5;

  return Math.max(1e-9, Math.min(0.5, ber));
}

// Stealth score 0-100
export function stealthScore({ chaoticMap, mapParameter, chipsPerBit, modulation, snrDb, platform, channelType }) {
  let score = 50;
  // Map quality
  if (chaoticMap === "logistic" && mapParameter > 3.85) score += 15;
  else if (chaoticMap === "tent" && Math.abs(mapParameter - 2) < 0.05) score += 12;
  else if (chaoticMap === "bernoulli") score += 10;
  else if (chaoticMap === "chebyshev") score += 13;
  // Spreading
  score += Math.min(25, (chipsPerBit / 256) * 25);
  // Modulation
  if (modulation === "DCSK") score += 5;
  if (modulation === "FM-DCSK") score += 7;
  // Lower power = stealthier (low SNR is fine for chaos)
  if (snrDb < 0) score += 5;
  if (snrDb > 20) score -= 10;
  // Platform stealth
  const plat = PLATFORM_DATA[platform] || {};
  score += (plat.stealthFactor || 0.5) * 15;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Enemy detection probability 0-100
export function enemyDetectionProbability({ enemyThreat, chaoticMap, mapParameter, chipsPerBit, modulation, snrDb, platform, jammerStrength }) {
  const enemy = ENEMY_DATA[enemyThreat] || {};
  const plat = PLATFORM_DATA[platform] || {};
  let prob = (enemy.threat || 0.5) * 60;
  // Spectral spike penalty (poor map / low chips)
  if (chipsPerBit < 16) prob += 25;
  else if (chipsPerBit < 32) prob += 12;
  else if (chipsPerBit > 128) prob -= 15;
  // High power penalty
  if (snrDb > 15) prob += 15;
  if (snrDb < 5) prob -= 8;
  // Bad map
  if (chaoticMap === "logistic" && mapParameter < 3.6) prob += 10;
  // Modulation
  if (modulation === "CSK") prob += 5;
  if (modulation === "FM-DCSK") prob -= 5;
  // Platform visibility
  prob += (plat.enemyDetMod || 0);
  return Math.max(0, Math.min(100, Math.round(prob)));
}

// ─── Verdict ──────────────────────────────────────────────────────────────────

export function computeVerdict(allyBer, enemyBer, enemyDetProb, allyAccuracy) {
  if (allyBer < 0.02 && enemyBer > 0.30 && enemyDetProb < 40 && allyAccuracy > 85) {
    return { code: "MISSION_SUCCESS", label: "MISSION SUCCESS", color: "#10b981", glow: "rgba(16,185,129,0.4)" };
  }
  if (enemyDetProb >= 60 || (1 - enemyBer) > 0.6) {
    return { code: "COMPROMISED", label: "COMPROMISED", color: "#ef4444", glow: "rgba(239,68,68,0.4)" };
  }
  if (allyBer > 0.25 || allyAccuracy < 50) {
    return { code: "FAILED", label: "FAILED TRANSMISSION", color: "#ef4444", glow: "rgba(239,68,68,0.4)" };
  }
  if (allyBer >= 0.02 && allyBer <= 0.15) {
    return { code: "DEGRADED", label: "DEGRADED LINK", color: "#fbbf24", glow: "rgba(251,191,36,0.4)" };
  }
  return { code: "MISSION_SUCCESS", label: "MISSION SUCCESS", color: "#10b981", glow: "rgba(16,185,129,0.4)" };
}

// ─── Full simulation ──────────────────────────────────────────────────────────

export function simulateMission(state) {
  const seed = 42;
  const platform = PLATFORM_DATA[state.allyPlatform] || PLATFORM_DATA.F22;

  const bits = state.payloadBits || [];
  if (bits.length === 0) return null;

  // Modulate
  const { signal: tx, refSeq } = modulate(
    bits, state.modulation, state.chipsPerBit, state.chaoticMap, state.mapParameter
  );

  // Effective channel (platform + threat modify)
  const dopplerEff = state.doppler + platform.dopplerBase;
  const enemy = ENEMY_DATA[state.enemyThreat] || ENEMY_DATA.SIGINT;
  const jamEff = state.jammerStrength + enemy.jammerBase * 0.3;

  // Apply channel — ally and enemy see same RX
  const rxAlly = applyChannel(tx, state.channelType, state.snrDb, dopplerEff, state.multipathStrength, jamEff, seed);
  const rxEnemy = applyChannel(tx, state.channelType, state.snrDb - 2, dopplerEff, state.multipathStrength, jamEff * 1.2, seed + 100);

  // Detect
  const allyBits = detectAlly(rxAlly, state.modulation, state.chipsPerBit, refSeq, bits.length, state.allyReceiver);
  const enemyBits = detectEnemy(rxEnemy, state.modulation, state.chipsPerBit, bits.length, state.enemyReceiver, seed + 200);

  // BER
  const allyBer = computeBER(bits, allyBits);
  const enemyBer = computeBER(bits, enemyBits);

  // Reconstruction quality
  const allyAccuracy = Math.round((1 - allyBer) * 100);
  const enemyAccuracy = Math.round((1 - enemyBer) * 100);

  // Scores
  const stealth = stealthScore(state);
  const reliability = Math.max(0, Math.round((1 - allyBer * 4) * 100));
  const enemyDetProb = enemyDetectionProbability(state);

  const verdict = computeVerdict(allyBer, enemyBer, enemyDetProb, allyAccuracy);

  return {
    txSignal: Array.from(tx.slice(0, 800)),
    rxSignalAlly: Array.from(rxAlly.slice(0, 800)),
    rxSignalEnemy: Array.from(rxEnemy.slice(0, 800)),
    allyRecoveredBits: allyBits,
    enemyRecoveredBits: enemyBits,
    allyBER: allyBer,
    enemyBER: enemyBer,
    allyAccuracy,
    enemyAccuracy,
    stealthScore: stealth,
    reliabilityScore: reliability,
    enemyDetectionProbability: enemyDetProb,
    verdict,
    totalBits: bits.length,
    totalChips: bits.length * state.chipsPerBit,
  };
}

// ─── Payload corruption rendering ─────────────────────────────────────────────

export function corruptText(text, ber) {
  const glitch = "▓░?█▒↯⚡@#$%&!";
  let out = "";
  for (const ch of text) {
    if (Math.random() < ber * 4) {
      out += glitch[Math.floor(Math.random() * glitch.length)];
    } else {
      out += ch;
    }
  }
  return out;
}

export function corruptImage(pixels, ber) {
  const out = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    if (Math.random() < ber * 2) {
      out[i] = Math.floor(Math.random() * 256);
    } else {
      out[i] = pixels[i] + Math.floor((Math.random() - 0.5) * ber * 80);
      out[i] = Math.max(0, Math.min(255, out[i]));
    }
  }
  return out;
}

export function corruptAudio(samples, ber) {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] + (Math.random() - 0.5) * ber * 4;
    if (Math.random() < ber * 2) out[i] = (Math.random() - 0.5) * 2;
  }
  return out;
}
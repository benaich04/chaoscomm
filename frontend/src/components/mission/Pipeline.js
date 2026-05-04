// Pipeline transforms — every step is a pure function over the signal.
// The signal flows: text → samples → quantized → bits → carrier → modulated → shaped → channel → received → detected → recovered

// ─── BUILT-IN PAYLOADS ─────────────────────────────────────────────────────

export function builtInImage(seed = 42) {
  const out = new Uint8Array(32 * 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - 16, dy = y - 16, d = Math.sqrt(dx * dx + dy * dy);
      out[y * 32 + x] = (d < 12 ? 200 : 30) + (Math.abs(d - 8) < 1 ? 50 : 0);
    }
  }
  return out;
}

export function builtInAudio(n = 256) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = 0.5 * Math.sin(2 * Math.PI * i / 32)
           + 0.3 * Math.sin(2 * Math.PI * i / 16) * Math.exp(-((i - n / 2) ** 2) / (n * n / 4));
  }
  return out;
}

// ─── STAGE 1: payload → samples ────────────────────────────────────────────

export function payloadToSamples(payload) {
  if (payload.type === "text") {
    const samples = [];
    for (const ch of payload.text) samples.push(ch.charCodeAt(0) / 255);
    return samples;
  }
  if (payload.type === "image") return Array.from(payload.data).map(v => v / 255);
  if (payload.type === "audio") return Array.from(payload.data).map(v => (v + 1) / 2);
  return [];
}

// ─── STAGE 2: quantize ──────────────────────────────────────────────────────

export function quantize(samples, { bits = 4, method = "uniform" }) {
  const L = Math.max(2, Math.pow(2, bits));
  const q = [];
  if (method === "uniform") {
    for (const v of samples) {
      const idx = Math.min(L - 1, Math.max(0, Math.round(v * (L - 1))));
      q.push(idx / (L - 1));
    }
  } else if (method === "midrise") {
    const step = 1 / L;
    for (const v of samples) {
      const idx = Math.min(L - 1, Math.max(0, Math.floor(v / step)));
      q.push((idx + 0.5) * step);
    }
  } else if (method === "mu_law") {
    const mu = 255;
    for (const v of samples) {
      const x = 2 * v - 1;
      const compressed = Math.sign(x) * Math.log(1 + mu * Math.abs(x)) / Math.log(1 + mu);
      const idx = Math.min(L - 1, Math.max(0, Math.round(((compressed + 1) / 2) * (L - 1))));
      q.push(idx / (L - 1));
    }
  } else if (method === "lloyd_max") {
    const sorted = [...samples].sort((a, b) => a - b);
    const breakpoints = [];
    for (let i = 1; i < L; i++) breakpoints.push(sorted[Math.floor(i / L * sorted.length)] || (i / L));
    const centroids = [];
    for (let i = 0; i < L; i++) {
      const lo = i === 0 ? 0 : (breakpoints[i - 1] || 0);
      const hi = i === L - 1 ? 1 : (breakpoints[i] || 1);
      centroids.push((lo + hi) / 2);
    }
    for (const v of samples) {
      let idx = 0;
      while (idx < L - 1 && v > breakpoints[idx]) idx++;
      q.push(centroids[idx]);
    }
  }
  return q;
}

// ─── STAGE 2b: samples → bits ──────────────────────────────────────────────
// CRITICAL FIX: For text payload, encode each character as its full 8-bit ASCII
// (not as a quantized sample's bit-depth bits — that loses information).

export function payloadToBits(payload, { bitsPerSample = 8 } = {}) {
  if (payload.type === "text") {
    const bits = [];
    for (const ch of payload.text) {
      const c = ch.charCodeAt(0);
      for (let i = 7; i >= 0; i--) bits.push((c >> i) & 1);
    }
    return bits;
  }
  // image/audio: quantize first
  const samples = payloadToSamples(payload);
  const q = quantize(samples, { bits: bitsPerSample, method: "uniform" });
  return samplesToBits(q, bitsPerSample);
}

export function samplesToBits(quantizedSamples, bitsPerSample) {
  const bits = [];
  const L = Math.pow(2, bitsPerSample);
  for (const v of quantizedSamples) {
    const idx = Math.min(L - 1, Math.max(0, Math.round(v * (L - 1))));
    for (let i = bitsPerSample - 1; i >= 0; i--) bits.push((idx >> i) & 1);
  }
  return bits;
}

// ─── STAGE 3: chaotic carriers ──────────────────────────────────────────────

export const CHAOTIC_FUNCS = {
  logistic:  { name: "Logistic",   formula: "x_{n+1} = r·x_n(1−x_n)",         param: "r", range: [3.5, 4.0],   default: 3.9 },
  tent:      { name: "Tent",       formula: "x_{n+1} = μ·min(x_n, 1−x_n)",    param: "μ", range: [1.5, 2.0],   default: 2.0 },
  cubic:     { name: "Cubic",      formula: "x_{n+1} = a·x_n − b·x_n³",       param: "a", range: [2.5, 3.0],   default: 2.95 },
  sine:      { name: "Sine",       formula: "x_{n+1} = a·sin(π·x_n)",         param: "a", range: [0.85, 1.0],  default: 0.99 },
  log_map:   { name: "Logarithmic",formula: "x_{n+1} = sign(x_n)·log(1+r|x_n|)−x_n", param: "r", range: [4, 8], default: 6 },
  bernoulli: { name: "Bernoulli",  formula: "x_{n+1} = 2·x_n mod 1",          param: "—", range: [0, 1],       default: 0.5 },
  chebyshev: { name: "Chebyshev",  formula: "x_{n+1} = cos(k·acos(x_n))",     param: "k", range: [2, 6],       default: 4 },
};

export function chaoticSeq(name, param, x0, n) {
  const out = new Float64Array(n);
  let x = x0;
  for (let i = 0; i < n; i++) {
    out[i] = x;
    if (name === "logistic")        x = param * x * (1 - x);
    else if (name === "tent")       x = x < 0.5 ? param * x : param * (1 - x);
    else if (name === "cubic")      x = param * x - (param - 0.05) * x * x * x;
    else if (name === "sine")       x = param * Math.sin(Math.PI * x);
    else if (name === "log_map")    x = Math.sign(x) * Math.log(1 + param * Math.abs(x)) - x;
    else if (name === "bernoulli")  x = (2 * x) % 1;
    else if (name === "chebyshev")  x = Math.cos(param * Math.acos(Math.max(-1, Math.min(1, x))));
    else                            x = 3.9 * x * (1 - x);
    if (!isFinite(x)) x = 0.31415;
  }
  // zero-mean unit-variance
  let m = 0; for (const v of out) m += v; m /= n;
  let s = 0; for (const v of out) s += (v - m) ** 2; s = Math.sqrt(s / n) || 1;
  return out.map(v => (v - m) / s);
}

// ─── STAGE 4: modulate ─────────────────────────────────────────────────────

export function modulate(bits, scheme, beta, carrier) {
  const out = new Float64Array(bits.length * beta);
  if (scheme === "DCSK" || scheme === "FM-DCSK") {
    const half = Math.max(2, Math.floor(beta / 2));
    for (let n = 0; n < bits.length; n++) {
      const sign = bits[n] === 1 ? 1 : -1;
      for (let i = 0; i < half; i++) {
        const refV = carrier[n * half + i] || 0;
        out[n * beta + i] = refV;
        out[n * beta + half + i] = sign * refV;
      }
    }
    if (scheme === "FM-DCSK") {
      let phi = 0;
      for (let i = 0; i < out.length; i++) {
        phi += out[i] * 0.3;
        out[i] = Math.cos(2 * Math.PI * 0.1 * i + phi);
      }
    }
  } else { // CSK — antipodal
    for (let n = 0; n < bits.length; n++) {
      const sign = bits[n] === 1 ? 1 : -1;
      for (let i = 0; i < beta; i++) {
        out[n * beta + i] = sign * (carrier[n * beta + i] || 0);
      }
    }
  }
  return Array.from(out);
}

// ─── STAGE 5: pulse shaping ─────────────────────────────────────────────────

export function pulseShape(signal, { type = "nrz", alpha = 0.35, sps = 1 }) {
  if (type === "nrz" || sps <= 1) return signal;
  const span = 4;
  const N = span * sps;
  const taps = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const t = (i - N / 2) / sps;
    if (Math.abs(t) < 1e-6) { taps[i] = 1; continue; }
    if (Math.abs(2 * alpha * t) === 1) { taps[i] = (Math.PI / 4) * Math.sin(Math.PI * t) / (Math.PI * t); continue; }
    taps[i] = (Math.sin(Math.PI * t) / (Math.PI * t)) *
              (Math.cos(Math.PI * alpha * t) / (1 - (2 * alpha * t) ** 2));
  }
  const up = new Float64Array(signal.length * sps);
  for (let i = 0; i < signal.length; i++) up[i * sps] = signal[i];
  const out = new Float64Array(up.length);
  for (let i = 0; i < up.length; i++) {
    let acc = 0;
    for (let j = 0; j <= N; j++) if (i - j >= 0) acc += up[i - j] * taps[j];
    out[i] = acc;
  }
  return Array.from(out);
}

// ─── STAGE 6: channel ──────────────────────────────────────────────────────

function gauss(rng) {
  return Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
}
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

export function applyChannel(signal, { snrDb = 10, type = "AWGN", multipath = 0, jammer = 0, doppler = 0, seed = 1 }) {
  const rng = mulberry32(seed);
  const out = new Float64Array(signal.length);
  let sigPow = 0;
  for (const v of signal) sigPow += v * v;
  sigPow = sigPow / signal.length || 1;
  const noisePow = sigPow / Math.pow(10, snrDb / 10);
  const noiseStd = Math.sqrt(noisePow);

  for (let i = 0; i < signal.length; i++) {
    let v = signal[i];
    if (doppler !== 0) v *= Math.cos(2 * Math.PI * doppler * i);
    if ((type === "Multipath" || type === "Combined") && i >= 5) v += multipath * 0.6 * signal[i - 5];
    if (type === "Rayleigh" || type === "Combined") {
      const fade = Math.sqrt(0.5) * Math.sqrt(gauss(rng) ** 2 + gauss(rng) ** 2);
      v *= Math.max(0.2, fade);
    }
    v += noiseStd * gauss(rng);
    if ((type === "Jammer" || type === "Combined") && jammer > 0) {
      v += jammer * Math.cos(2 * Math.PI * 0.07 * i + 0.3 * Math.sin(0.01 * i));
    }
    out[i] = v;
  }
  return Array.from(out);
}

// ─── STAGE 6b: matched filter for raised cosine ─────────────────────────────
// If the TX was upsampled, the RX is at sps·chip_rate. The matched filter
// must be applied first, then downsampled to chip rate.

export function matchedFilterDownsample(rxUpsampled, { sps = 1, alpha = 0.35 }) {
  if (sps <= 1) return rxUpsampled;
  const span = 4;
  const N = span * sps;
  const taps = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const t = (i - N / 2) / sps;
    if (Math.abs(t) < 1e-6) { taps[i] = 1; continue; }
    if (Math.abs(2 * alpha * t) === 1) { taps[i] = (Math.PI / 4) * Math.sin(Math.PI * t) / (Math.PI * t); continue; }
    taps[i] = (Math.sin(Math.PI * t) / (Math.PI * t)) *
              (Math.cos(Math.PI * alpha * t) / (1 - (2 * alpha * t) ** 2));
  }
  const filtered = new Float64Array(rxUpsampled.length);
  for (let i = 0; i < rxUpsampled.length; i++) {
    let acc = 0;
    for (let j = 0; j <= N; j++) if (i - j >= 0) acc += rxUpsampled[i - j] * taps[j];
    filtered[i] = acc;
  }
  // Downsample: pick samples at the matched-filter peaks (at i*sps + N/2 for the next chip)
  const out = [];
  const offset = Math.floor(N / 2);
  for (let i = 0; i + offset < filtered.length; i += sps) out.push(filtered[i + offset]);
  return out;
}

// ─── STAGE 7: detect ──────────────────────────────────────────────────────

export function detect(rxChipRate, scheme, beta, carrier, nBits) {
  const out = [];
  if (scheme === "DCSK" || scheme === "FM-DCSK") {
    const half = Math.max(2, Math.floor(beta / 2));
    for (let n = 0; n < nBits; n++) {
      let z = 0;
      for (let i = 0; i < half; i++) {
        z += (rxChipRate[n * beta + i] || 0) * (rxChipRate[n * beta + half + i] || 0);
      }
      out.push(z > 0 ? 1 : 0);
    }
  } else { // CSK antipodal
    for (let n = 0; n < nBits; n++) {
      let z = 0;
      for (let i = 0; i < beta; i++) {
        z += (rxChipRate[n * beta + i] || 0) * (carrier[n * beta + i] || 0);
      }
      out.push(z > 0 ? 1 : 0);
    }
  }
  return out;
}

export function detectCorrelations(rxChipRate, scheme, beta, carrier, nBits) {
  // Returns {z, decision} per bit for visualization
  const arr = [];
  if (scheme === "DCSK" || scheme === "FM-DCSK") {
    const half = Math.max(2, Math.floor(beta / 2));
    for (let n = 0; n < nBits; n++) {
      let z = 0;
      for (let i = 0; i < half; i++) {
        z += (rxChipRate[n * beta + i] || 0) * (rxChipRate[n * beta + half + i] || 0);
      }
      arr.push({ z, decision: z > 0 ? 1 : 0 });
    }
  } else {
    for (let n = 0; n < nBits; n++) {
      let z = 0;
      for (let i = 0; i < beta; i++) {
        z += (rxChipRate[n * beta + i] || 0) * (carrier[n * beta + i] || 0);
      }
      arr.push({ z, decision: z > 0 ? 1 : 0 });
    }
  }
  return arr;
}

export function detectEnemy(rxChipRate, scheme, beta, nBits, mode = "wrong_key") {
  const rng = mulberry32(99);
  const out = [];

  if (mode === "wrong_key") {
    if (scheme === "DCSK" || scheme === "FM-DCSK") {
      // Realistic DCSK enemy: doesn't know β. They guess wrong (try β/2 or 2β).
      // Wrong β means the "reference half" they correlate doesn't align with
      // the actual reference, AND their bit boundaries drift through real bits.
      const betaGuess = Math.max(8, Math.floor(beta / 2));  // off by 2x
      const half = Math.floor(betaGuess / 2);
      const driftPerBit = beta - betaGuess;  // accumulating misalignment
      for (let n = 0; n < nBits; n++) {
        const startIdx = n * betaGuess;
        if (startIdx + betaGuess > rxChipRate.length) {
          out.push(rng() > 0.5 ? 1 : 0);
          continue;
        }
        let z = 0;
        for (let i = 0; i < half; i++) {
          z += (rxChipRate[startIdx + i] || 0) * (rxChipRate[startIdx + half + i] || 0);
        }
        out.push((z + 0.3 * gauss(rng)) > 0 ? 1 : 0);
      }
    } else {
      // CSK: enemy uses wrong x0 and wrong r → correlation noise
      const wrong = chaoticSeq("logistic", 3.7, 0.555, rxChipRate.length + 50);
      for (let n = 0; n < nBits; n++) {
        let z = 0;
        for (let i = 0; i < beta; i++) z += (rxChipRate[n * beta + i] || 0) * (wrong[n * beta + i] || 0);
        out.push((z + 0.3 * gauss(rng)) > 0 ? 1 : 0);
      }
    }
  } else if (mode === "energy") {
    // Energy detector: just thresholds power. Can't tell bit value because
    // energy is the same for bit=0 and bit=1 in chaotic schemes.
    const energies = [];
    for (let n = 0; n < nBits; n++) {
      let e = 0;
      const lim = Math.min(beta, rxChipRate.length - n * beta);
      for (let i = 0; i < lim; i++) e += (rxChipRate[n * beta + i] || 0) ** 2;
      energies.push(e);
    }
    // Threshold = median; output basically random because energy carries no info
    const sorted = [...energies].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (let n = 0; n < nBits; n++) out.push(energies[n] > median ? 1 : 0);
    // shuffle vs truth a bit since this is genuinely uninformative
    for (let i = 0; i < out.length; i++) {
      if (rng() < 0.5) out[i] = 1 - out[i];
    }
  } else if (mode === "spectrum") {
    // Spectrum analyser: can detect that signal exists, but spread spectrum
    // hides bit content. Pure guess.
    for (let n = 0; n < nBits; n++) out.push(rng() > 0.5 ? 1 : 0);
  } else {
    for (let n = 0; n < nBits; n++) out.push(rng() > 0.5 ? 1 : 0);
  }
  return out;
}

// ─── STAGE 8: bits → text ──────────────────────────────────────────────────

export function bitsToText(bits) {
  let out = "";
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let c = 0;
    for (let j = 0; j < 8; j++) c = (c << 1) | (bits[i + j] > 0.5 ? 1 : 0);
    out += (c >= 32 && c < 127) ? String.fromCharCode(c) : "▓";
  }
  return out;
}

export function ber(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0.5;
  let e = 0;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) e++;
  return e / n;
}

// ─── PSD via DFT ───────────────────────────────────────────────────────────

export function psd(signal, N = 256) {
  const data = signal.slice(0, N);
  const n = data.length;
  const out = [];
  for (let k = 0; k < n / 2; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      re += data[i] * Math.cos(2 * Math.PI * k * i / n);
      im -= data[i] * Math.sin(2 * Math.PI * k * i / n);
    }
    out.push(10 * Math.log10(Math.max(1e-10, (re * re + im * im) / n)));
  }
  return out;
}

export function autocorr(signal, maxLag = 32) {
  const n = signal.length;
  const out = [];
  let denom = 0;
  for (const v of signal) denom += v * v;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const j = i + lag;
      if (j >= 0 && j < n) acc += signal[i] * signal[j];
    }
    out.push(acc / denom);
  }
  return out;
}

// Spectral flatness 0-1 (Wiener entropy) for stealth scoring
export function spectralFlatness(signal) {
  const p = psd(signal, 256).map(v => Math.pow(10, v / 10));
  const n = p.length;
  let geom = 0, arith = 0;
  for (const v of p) {
    geom += Math.log(Math.max(v, 1e-12));
    arith += v;
  }
  geom = Math.exp(geom / n);
  arith = arith / n;
  return Math.max(0, Math.min(1, geom / arith));
}

// Lyapunov exponent estimate (rough, for display)
export function lyapunov(name, param, x0 = 0.31415, n = 1000) {
  let x = x0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let dxdx = 1;
    if (name === "logistic")       { dxdx = param * (1 - 2 * x); x = param * x * (1 - x); }
    else if (name === "tent")      { dxdx = x < 0.5 ? param : -param; x = x < 0.5 ? param * x : param * (1 - x); }
    else if (name === "cubic")     { dxdx = param - 3 * (param - 0.05) * x * x; x = param * x - (param - 0.05) * x * x * x; }
    else if (name === "sine")      { dxdx = param * Math.PI * Math.cos(Math.PI * x); x = param * Math.sin(Math.PI * x); }
    else if (name === "log_map")   { dxdx = (param / (1 + param * Math.abs(x))) - 1; x = Math.sign(x) * Math.log(1 + param * Math.abs(x)) - x; }
    else if (name === "bernoulli") { dxdx = 2; x = (2 * x) % 1; }
    else if (name === "chebyshev") { const a = Math.acos(Math.max(-1, Math.min(1, x))); dxdx = param * Math.sin(param * a) / Math.sin(a); x = Math.cos(param * a); }
    if (!isFinite(x)) x = 0.31415;
    sum += Math.log(Math.max(1e-12, Math.abs(dxdx)));
  }
  return sum / n;
}
import { useState, useMemo, useRef, useEffect } from "react";
import StageStrip from "../components/mission/StageStrip.jsx";
import {
  PSDPanel, AutocorrPanel, BERPanel, EyeDiagram, Constellation,
  ScoreRing, BitMatrix, HUDStat,
} from "../components/mission/MissionVisuals.jsx";
import {
  CHAOTIC_FUNCS, payloadToSamples, quantize, payloadToBits,
  chaoticSeq, modulate, pulseShape, applyChannel, matchedFilterDownsample,
  detect, detectCorrelations, detectEnemy, bitsToText, ber,
  psd, autocorr, spectralFlatness, lyapunov,
  builtInImage, builtInAudio,
} from "../components/mission/Pipeline.js";

const STEPS = [
  { n: 0, code: "BRIEF",    title: "Mission Briefing",    icon: "◈" },
  { n: 1, code: "PAYLOAD",  title: "Payload Capture",     icon: "◷" },
  { n: 2, code: "QUANTIZE", title: "Digitize",            icon: "▦" },
  { n: 3, code: "CARRIER",  title: "Chaotic Carrier",     icon: "∿" },
  { n: 4, code: "MODULATE", title: "Modulate s(t)",       icon: "⊕" },
  { n: 5, code: "PULSE",    title: "Pulse Shape",         icon: "◐" },
  { n: 6, code: "CHANNEL",  title: "Hostile Channel",     icon: "⚡" },
  { n: 7, code: "DETECT",   title: "Receiver z[n]",       icon: "⊗" },
  { n: 8, code: "RECOVER",  title: "Decode Comparison",   icon: "▸" },
  { n: 9, code: "DEBRIEF",  title: "Final Verdict",       icon: "★" },
];

const DEFAULT_STATE = {
  step: 0,
  payloadType: "text",
  text: "FIRE NOW",
  qBits: 8,        // 8 bits/sample for clean ASCII roundtrip
  qMethod: "uniform",
  carrierFunc: "logistic",
  carrierParam: 3.9,
  scheme: "DCSK",
  beta: 64,
  pulseType: "nrz",
  pulseAlpha: 0.35,
  pulseSps: 1,
  snrDb: 10,
  channelType: "AWGN",
  multipath: 0,
  jammer: 0,
  doppler: 0,
  enemyMode: "wrong_key",
};

// ─── PIPELINE ─────────────────────────────────────────────────────────────

function computePipeline(s) {
  const r = {};
  const payload = s.payloadType === "text"
    ? { type: "text", text: s.text }
    : s.payloadType === "image"
    ? { type: "image", data: builtInImage() }
    : { type: "audio", data: builtInAudio(64) };

  r.samples = payloadToSamples(payload);
  r.quantized = quantize(r.samples, { bits: s.qBits, method: s.qMethod });
  // For text use full 8-bit ASCII; image/audio use chosen depth
  r.bits = payloadToBits(payload, { bitsPerSample: s.qBits });

  const totalChips = r.bits.length * s.beta + 100;
  r.carrier = Array.from(chaoticSeq(s.carrierFunc, s.carrierParam, 0.31415, totalChips));
  r.signal = modulate(r.bits, s.scheme, s.beta, r.carrier);
  r.shaped = pulseShape(r.signal, { type: s.pulseType, alpha: s.pulseAlpha, sps: s.pulseSps });

  r.received = applyChannel(r.shaped, {
    snrDb: s.snrDb, type: s.channelType,
    multipath: s.multipath, jammer: s.jammer, doppler: s.doppler, seed: 1,
  });

  // Bring back to chip rate via matched filter + downsample
  r.receivedChip = s.pulseSps > 1
    ? matchedFilterDownsample(r.received, { sps: s.pulseSps, alpha: s.pulseAlpha })
    : r.received;

  r.detected = detect(r.receivedChip, s.scheme, s.beta, r.carrier, r.bits.length);
  r.correlations = detectCorrelations(r.receivedChip, s.scheme, s.beta, r.carrier, r.bits.length);
  r.detectedEnemy = detectEnemy(r.receivedChip, s.scheme, s.beta, r.bits.length, s.enemyMode);

  r.allyText = bitsToText(r.detected);
  r.enemyText = bitsToText(r.detectedEnemy);
  r.allyBer = ber(r.bits, r.detected);
  r.enemyBer = ber(r.bits, r.detectedEnemy);

  // analytics
  r.psdSignal = psd(r.signal, 256);
  r.psdReceived = psd(r.received, 256);
  r.flatness = spectralFlatness(r.signal);
  r.acCarrier = autocorr(r.carrier.slice(0, 256), 32);
  r.lyapunov = lyapunov(s.carrierFunc, s.carrierParam);

  return r;
}

// ─── REUSABLE SHELLS ──────────────────────────────────────────────────────

function HUDPanel({ children, title, accent = "#22d3ee", subtitle, className = "" }) {
  return (
    <div className={`relative rounded-lg border bg-black/30 ${className}`}
      style={{ borderColor: accent + "30", boxShadow: `inset 0 0 30px ${accent}06` }}>
      <div className="absolute top-0 left-0 w-3 h-3 border-l border-t" style={{ borderColor: accent }} />
      <div className="absolute top-0 right-0 w-3 h-3 border-r border-t" style={{ borderColor: accent }} />
      <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b" style={{ borderColor: accent }} />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b" style={{ borderColor: accent }} />
      {(title || subtitle) && (
        <div className="px-4 pt-3 pb-2 border-b border-white/5 flex items-baseline justify-between">
          {title && <span className="text-[10px] tracking-[0.3em] font-bold" style={{ color: accent }}>{title}</span>}
          {subtitle && <span className="text-[9px] text-white/30 font-mono">{subtitle}</span>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

function Slider({ label, value, onChange, min, max, step, color = "#22d3ee", format }) {
  return (
    <div>
      <div className="flex justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-widest text-white/50">{label}</span>
        <span className="font-mono text-sm font-bold" style={{ color }}>
          {format ? format(value) : value}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        className="w-full" style={{ accentColor: color }} />
    </div>
  );
}

function Pills({ options, value, onChange, color = "#22d3ee" }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map(opt => {
        const id = typeof opt === "object" ? opt.id : opt;
        const lbl = typeof opt === "object" ? opt.label : opt;
        return (
          <button key={id} onClick={() => onChange(id)}
            className="px-3 py-1.5 rounded-md text-xs font-bold tracking-wider transition-all"
            style={{
              background: value === id ? color + "20" : "#ffffff08",
              color: value === id ? color : "#ffffff60",
              border: `1px solid ${value === id ? color + "60" : "#ffffff15"}`,
            }}>
            {lbl}
          </button>
        );
      })}
    </div>
  );
}

function NextButton({ onClick, label, color = "#22d3ee" }) {
  return (
    <button onClick={onClick}
      className="w-full py-3 rounded-md font-black text-sm tracking-[0.3em] uppercase transition-all"
      style={{
        border: `2px solid ${color}80`, color,
        background: `linear-gradient(135deg, ${color}15, ${color}08)`,
        boxShadow: `0 0 20px ${color}30`,
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = `0 0 40px ${color}50`}
      onMouseLeave={e => e.currentTarget.style.boxShadow = `0 0 20px ${color}30`}>
      {label} →
    </button>
  );
}

// ─── SIDEBAR — mission control ───────────────────────────────────────────

function Sidebar({ s, p, completed, onJump }) {
  const flatPct = (p.flatness * 100).toFixed(0);
  const lambda = p.lyapunov?.toFixed(3) || "—";
  const isChaotic = p.lyapunov > 0;

  return (
    <div className="sticky top-4 space-y-3">
      {/* ID Card */}
      <div className="rounded-lg border-2 border-cyan-400/30 bg-gradient-to-br from-cyan-400/10 to-transparent p-4">
        <div className="text-[9px] tracking-[0.3em] text-cyan-400/70 mb-1 font-bold">CALLSIGN</div>
        <div className="font-mono font-black text-2xl text-cyan-400 tracking-widest">PHANTOM-1</div>
        <div className="text-[9px] tracking-[0.2em] text-white/40 mt-1">ECE-UY-3404 · CLASSIFIED</div>
      </div>

      {/* Live status */}
      <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] tracking-[0.25em] text-white/40 font-bold">LINK STATUS</span>
          <span className={`flex items-center gap-1 text-[10px] font-bold ${
            isChaotic ? "text-emerald-400" : "text-amber-400"
          }`}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: isChaotic ? "#10b981" : "#fbbf24" }} />
            {isChaotic ? "ARMED" : "STANDBY"}
          </span>
        </div>
        <div className="space-y-2 pt-1">
          <Mini label="message" value={`"${s.text || "—"}"`} color="#22d3ee" mono />
          <Mini label="bits" value={p.bits.length} color="#22d3ee" />
          <Mini label="carrier" value={`${s.carrierFunc} (${s.carrierParam.toFixed(2)})`} color="#a78bfa" />
          <Mini label="lyapunov λ" value={lambda} color={isChaotic ? "#10b981" : "#ef4444"} />
          <Mini label="modulation" value={`${s.scheme}`} color="#10b981" />
          <Mini label="β chips/bit" value={`${s.beta} (+${(10*Math.log10(s.beta)).toFixed(1)} dB)`} color="#10b981" />
          <Mini label="channel" value={`${s.channelType} @ ${s.snrDb}dB`} color="#fbbf24" />
          <Mini label="flatness" value={`${flatPct}%`} color="#a78bfa" />
        </div>
      </div>

      {/* Step jump pad */}
      <div className="rounded-lg border border-white/10 bg-black/40 p-3">
        <div className="text-[9px] tracking-[0.25em] text-white/40 font-bold mb-2">STAGE INDEX</div>
        <div className="grid grid-cols-2 gap-1">
          {STEPS.map((st, i) => {
            const done = completed.has(st.n);
            const active = s.step === st.n;
            const c = done ? "#10b981" : active ? "#22d3ee" : "#ffffff20";
            return (
              <button key={st.n}
                onClick={() => (done || active) && onJump(st.n)}
                disabled={!done && !active && st.n !== 0}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-left transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: active ? c + "20" : done ? c + "08" : "transparent",
                  border: `1px solid ${active ? c + "60" : "transparent"}`,
                }}>
                <span className="font-mono text-[9px] font-bold" style={{ color: c }}>
                  {String(i).padStart(2, "0")}
                </span>
                <span className="text-[9px] tracking-wider truncate"
                  style={{ color: active ? c : done ? "#10b981" : "#ffffff40" }}>
                  {st.code}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, color = "#fff", mono }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[9px] uppercase tracking-widest text-white/40 font-bold">{label}</span>
      <span className={`text-[10px] font-bold ${mono ? "font-mono" : ""}`}
        style={{ color }}>{value}</span>
    </div>
  );
}

// ─── STEP COMPONENTS ──────────────────────────────────────────────────────

function Step0({ next }) {
  const [typed, setTyped] = useState("");
  const full = `> ╔══════════════════════════════════════════╗
> ║  CLASSIFIED — OPERATION PHANTOM SIGNAL  ║
> ╚══════════════════════════════════════════╝
>
> [BASE STATION] You hold a covert message.
> [ENEMY SIGINT] Wideband sensors active.
> [ALLY] Awaiting your transmission.
>
> Your mission:
>   Design a chaotic spread-spectrum link.
>   The ally will recover the message.
>   The enemy will see only noise.
>
> 9 stages, each transforming s(t):
>   01· PAYLOAD       message → samples
>   02· QUANTIZE      method · bit depth
>   03· CARRIER       which chaotic function
>   04· MODULATE      CSK / DCSK / FM-DCSK
>   05· PULSE SHAPE   bandwidth control
>   06· CHANNEL       AWGN · fading · jam
>   07· DETECT        matched filter z[n]
>   08· RECOVER       ally vs enemy
>   09· DEBRIEF       final verdict
>
> Begin when ready.`;

  useEffect(() => {
    let i = 0;
    const iv = setInterval(() => {
      i++; setTyped(full.slice(0, i));
      if (i >= full.length) clearInterval(iv);
    }, 8);
    return () => clearInterval(iv);
  }, []);

  return (
    <HUDPanel accent="#10b981" title="◈ MISSION ORDERS" subtitle="EYES ONLY · DESTROY AFTER READING">
      <pre className="text-xs leading-relaxed text-emerald-400/90 whitespace-pre-wrap font-mono min-h-96">
        {typed}<span className="animate-pulse">▌</span>
      </pre>
      {typed.length >= full.length && (
        <button onClick={next}
          className="mt-4 w-full py-5 rounded-md font-black text-base tracking-[0.5em] uppercase
            border-2 border-cyan-400 text-cyan-400
            bg-gradient-to-r from-cyan-400/15 via-emerald-400/10 to-purple-400/15
            hover:shadow-[0_0_60px_rgba(34,211,238,0.5)] transition-all">
          ▶▶ BEGIN MISSION
        </button>
      )}
    </HUDPanel>
  );
}

function Step1({ s, set, p, next }) {
  return (
    <div className="space-y-4">
      <HUDPanel accent="#22d3ee" title="◈ STAGE 01 · PAYLOAD CAPTURE" subtitle="message → numerical samples">
        <div className="grid grid-cols-3 gap-2 mb-4">
          {["text", "image", "audio"].map(opt => (
            <button key={opt} onClick={() => set({ payloadType: opt })}
              className="rounded-md border-2 px-4 py-3 transition-all text-sm font-black tracking-[0.2em] uppercase"
              style={{
                borderColor: s.payloadType === opt ? "#22d3ee" : "#ffffff15",
                background: s.payloadType === opt ? "#22d3ee15" : "transparent",
                color: s.payloadType === opt ? "#22d3ee" : "#ffffff70",
              }}>
              {opt}
            </button>
          ))}
        </div>

        {s.payloadType === "text" && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-2">Message (max 12 chars)</div>
            <input value={s.text} onChange={e => set({ text: e.target.value.slice(0, 12).toUpperCase() })}
              className="w-full bg-black/40 font-mono font-black text-3xl outline-none border-2 border-cyan-400/30 rounded px-4 py-3 text-cyan-400 tracking-[0.15em] focus:border-cyan-400 focus:shadow-[0_0_20px_rgba(34,211,238,0.3)]"
              placeholder="MESSAGE" />
          </div>
        )}
      </HUDPanel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HUDStat big label="characters" value={s.text.length} color="#22d3ee" />
        <HUDStat big label="bits @ 8 b/char" value={p.bits.length} color="#22d3ee" />
      </div>

      <StageStrip
        signal={p.samples} color="#22d3ee" dotted
        label="01 · NORMALIZED SAMPLES"
        formula={`x[n] = ord(c) / 255  ·  ${p.samples.length} samples`}
        height={140}
      />

      {/* Bit grid */}
      <HUDPanel accent="#22d3ee" title="◈ BIT REPRESENTATION" subtitle={`${p.bits.length} bits, MSB → LSB per char`}>
        <BitMatrix original={p.bits} recovered={p.bits} color="#22d3ee" maxBits={Math.min(96, p.bits.length)} />
      </HUDPanel>

      <NextButton onClick={next} label="proceed → quantization" />
    </div>
  );
}

function Step2({ s, set, p, next }) {
  const sqnr = (6.02 * s.qBits + 1.76).toFixed(1);
  return (
    <div className="space-y-4">
      <HUDPanel accent="#fbbf24" title="◈ STAGE 02 · QUANTIZATION" subtitle="continuous → discrete">
        <div className="space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-2">Method</div>
            <Pills color="#fbbf24" value={s.qMethod} onChange={v => set({ qMethod: v })}
              options={[
                { id: "uniform",   label: "Uniform" },
                { id: "midrise",   label: "Midrise" },
                { id: "mu_law",    label: "μ-Law" },
                { id: "lloyd_max", label: "Lloyd-Max" },
              ]} />
          </div>
          <Slider label="Bit depth" color="#fbbf24"
            min={1} max={8} step={1} value={s.qBits}
            onChange={v => set({ qBits: v })}
            format={v => `${v} bits → ${Math.pow(2, v)} levels`} />
        </div>
      </HUDPanel>

      <div className="grid grid-cols-3 gap-3">
        <HUDStat label="quantization levels N" value={Math.pow(2, s.qBits)} color="#fbbf24" big />
        <HUDStat label="SQNR theoretical" value={`${sqnr} dB`} sub={`6.02·${s.qBits}+1.76`} color="#fbbf24" big />
        <HUDStat label="total bits" value={p.bits.length} sub={`${p.samples.length} samples × 8b`} color="#fbbf24" big />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <StageStrip signal={p.samples} color="#22d3ee" dotted
          label="BEFORE — analog samples" formula="x[n] ∈ [0,1] continuous" height={120} />
        <StageStrip signal={p.quantized} color="#fbbf24" dotted
          label={`AFTER — Q(x[n]) · ${s.qMethod}`} formula={`L = 2^${s.qBits} = ${Math.pow(2, s.qBits)}`} height={120} />
      </div>

      <NextButton onClick={next} label="proceed → chaotic carrier" color="#fbbf24" />
    </div>
  );
}

function Step3({ s, set, p, next }) {
  const fn = CHAOTIC_FUNCS[s.carrierFunc];
  const isChaotic = p.lyapunov > 0;
  return (
    <div className="space-y-4">
      <HUDPanel accent="#a78bfa" title="◈ STAGE 03 · CHAOTIC CARRIER" subtitle="generate the noise-like sequence">
        <div className="text-[10px] uppercase tracking-widest text-white/50 mb-2">Function family</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          {Object.entries(CHAOTIC_FUNCS).map(([id, f]) => (
            <button key={id} onClick={() => set({ carrierFunc: id, carrierParam: f.default })}
              className="rounded-md border-2 p-2 text-left transition-all"
              style={{
                borderColor: s.carrierFunc === id ? "#a78bfa" : "#ffffff15",
                background: s.carrierFunc === id ? "#a78bfa15" : "transparent",
              }}>
              <div className="text-xs font-bold" style={{ color: s.carrierFunc === id ? "#a78bfa" : "#ffffff80" }}>{f.name}</div>
              <div className="text-[8px] text-white/40 font-mono mt-0.5 truncate">{f.formula}</div>
            </button>
          ))}
        </div>
        {fn.range[0] !== fn.range[1] && (
          <Slider label={`parameter ${fn.param}`} color="#a78bfa"
            min={fn.range[0]} max={fn.range[1]} step={0.001} value={s.carrierParam}
            onChange={v => set({ carrierParam: v })} format={v => v.toFixed(3)} />
        )}
      </HUDPanel>

      <div className="grid grid-cols-3 gap-3">
        <HUDStat label="Lyapunov λ" value={p.lyapunov.toFixed(3)}
          sub={isChaotic ? "✓ chaotic regime" : "✗ periodic"}
          color={isChaotic ? "#10b981" : "#ef4444"} big />
        <HUDStat label="spectral flatness" value={`${(p.flatness * 100).toFixed(0)}%`} sub="0% peaked · 100% flat" color="#a78bfa" big />
        <HUDStat label="active equation" value={fn.formula} color="#a78bfa" />
      </div>

      <StageStrip signal={p.carrier.slice(0, 600)} color="#a78bfa"
        label="03 · CARRIER c(t)"
        formula={fn.formula}
        badge={`${fn.name} ${fn.param}=${s.carrierParam.toFixed(3)}`}
        height={140} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <PSDPanel psd={p.psdSignal} color="#a78bfa" label="POWER SPECTRAL DENSITY"
          flatness={p.flatness} height={120} />
        <AutocorrPanel ac={p.acCarrier} color="#fbbf24" height={120} />
      </div>

      <NextButton onClick={next} label="proceed → modulation" color="#a78bfa" />
    </div>
  );
}

function Step4({ s, set, p, next }) {
  const pgDb = (10 * Math.log10(s.beta)).toFixed(1);
  return (
    <div className="space-y-4">
      <HUDPanel accent="#10b981" title="◈ STAGE 04 · MODULATION" subtitle="bits + carrier → s(t)">
        <div className="grid grid-cols-3 gap-2 mb-4">
          {["CSK", "DCSK", "FM-DCSK"].map(sc => (
            <button key={sc} onClick={() => set({ scheme: sc })}
              className="rounded-md border-2 p-3 transition-all"
              style={{
                borderColor: s.scheme === sc ? "#10b981" : "#ffffff15",
                background: s.scheme === sc ? "#10b98115" : "transparent",
              }}>
              <div className="font-black text-sm tracking-wider"
                style={{ color: s.scheme === sc ? "#10b981" : "#ffffff70" }}>{sc}</div>
              <div className="text-[9px] text-white/40 mt-0.5">
                {sc === "CSK" && "antipodal · needs sync"}
                {sc === "DCSK" && "differential · self-ref"}
                {sc === "FM-DCSK" && "constant envelope"}
              </div>
            </button>
          ))}
        </div>
        <Slider label="Chips per bit β" color="#10b981"
          min={8} max={128} step={4} value={s.beta}
          onChange={v => set({ beta: v })}
          format={v => `${v}  →  +${(10 * Math.log10(v)).toFixed(1)} dB processing gain`} />
      </HUDPanel>

      <HUDPanel accent="#10b981" title="◈ TRANSMITTED SIGNAL" subtitle="the actual function form">
        {s.scheme === "DCSK" && (
          <div className="font-mono text-base text-emerald-300 mb-3 leading-relaxed">
            s(t) = Σₙ [c_n(t) + b_n · c_n(t − T_c/2)] · φ(t − nT_b)
          </div>
        )}
        {s.scheme === "CSK" && (
          <div className="font-mono text-base text-emerald-300 mb-3 leading-relaxed">
            s(t) = Σₙ b_n · c_n(t) · φ(t − nT_b)   ,   b_n ∈ {`{-1, +1}`}
          </div>
        )}
        {s.scheme === "FM-DCSK" && (
          <div className="font-mono text-base text-emerald-300 mb-3 leading-relaxed">
            s(t) = cos(2π f_c·t + 2π·∫ x(τ)dτ)  ,  x = DCSK baseband
          </div>
        )}
        <div className="grid grid-cols-4 gap-3">
          <HUDStat label="scheme" value={s.scheme} color="#10b981" />
          <HUDStat label="β" value={s.beta} sub="chips/bit" color="#10b981" />
          <HUDStat label="proc. gain" value={`+${pgDb} dB`} sub="anti-jam capacity" color="#10b981" />
          <HUDStat label="total samples" value={p.signal.length} sub={`${p.bits.length} bits × ${s.beta}`} color="#10b981" />
        </div>
      </HUDPanel>

      <StageStrip signal={p.signal.slice(0, 800)} color="#10b981"
        label="04 · s(t) MODULATED"
        formula={`${s.scheme}, β=${s.beta}`}
        height={170} />

      <NextButton onClick={next} label="proceed → pulse shaping" color="#10b981" />
    </div>
  );
}

function Step5({ s, set, p, next }) {
  return (
    <div className="space-y-4">
      <HUDPanel accent="#22d3ee" title="◈ STAGE 05 · PULSE SHAPING" subtitle="bandlimit s(t)">
        <div className="space-y-4">
          <Pills color="#22d3ee" value={s.pulseType} onChange={v => set({ pulseType: v })}
            options={[{ id: "nrz", label: "NRZ rectangular" }, { id: "rc", label: "Raised cosine" }]} />
          {s.pulseType !== "nrz" && (
            <>
              <Slider label="Roll-off α" color="#22d3ee"
                min={0.1} max={1} step={0.05} value={s.pulseAlpha}
                onChange={v => set({ pulseAlpha: v })} format={v => v.toFixed(2)} />
              <Slider label="Samples per chip" color="#22d3ee"
                min={1} max={4} step={1} value={s.pulseSps}
                onChange={v => set({ pulseSps: v })} />
            </>
          )}
        </div>
      </HUDPanel>

      <StageStrip signal={p.shaped.slice(0, 800)} color="#22d3ee"
        label="05 · SHAPED s(t)"
        formula={s.pulseType === "nrz" ? "rectangular" : `RC α=${s.pulseAlpha}, sps=${s.pulseSps}`}
        height={150} />

      <EyeDiagram signal={p.signal} beta={s.beta} color="#10b981" height={140} />

      <NextButton onClick={next} label="proceed → channel" color="#22d3ee" />
    </div>
  );
}

function Step6({ s, set, p, next }) {
  return (
    <div className="space-y-4">
      <HUDPanel accent="#ef4444" title="◈ STAGE 06 · HOSTILE CHANNEL" subtitle="r(t) = s(t) + n(t) + interference">
        <div className="space-y-4">
          <Pills color="#ef4444" value={s.channelType} onChange={v => set({ channelType: v })}
            options={["AWGN", "Rayleigh", "Multipath", "Jammer", "Combined"]} />
          <Slider label="SNR" color="#22d3ee"
            min={-15} max={30} step={1} value={s.snrDb}
            onChange={v => set({ snrDb: v })} format={v => `${v} dB`} />
          {(s.channelType === "Multipath" || s.channelType === "Combined") && (
            <Slider label="Multipath strength" color="#fbbf24"
              min={0} max={1} step={0.05} value={s.multipath}
              onChange={v => set({ multipath: v })} format={v => v.toFixed(2)} />
          )}
          {(s.channelType === "Jammer" || s.channelType === "Combined") && (
            <Slider label="Jammer strength" color="#ef4444"
              min={0} max={1} step={0.05} value={s.jammer}
              onChange={v => set({ jammer: v })} format={v => v.toFixed(2)} />
          )}
          <Slider label="Doppler shift" color="#a78bfa"
            min={-0.05} max={0.05} step={0.005} value={s.doppler}
            onChange={v => set({ doppler: v })} format={v => v.toFixed(3)} />
        </div>
      </HUDPanel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <StageStrip signal={p.signal.slice(0, 500)} color="#10b981"
          label="BEFORE — clean s(t)" height={130} />
        <StageStrip signal={p.received.slice(0, 500)} color="#94a3b8"
          label={`AFTER — r(t) · ${s.channelType} @ ${s.snrDb}dB`}
          formula="distorted by channel" height={130} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <PSDPanel psd={p.psdSignal} color="#10b981" label="TX PSD" height={110} />
        <PSDPanel psd={p.psdReceived} color="#94a3b8" label="RX PSD" height={110} />
      </div>

      <NextButton onClick={next} label="proceed → matched receiver" color="#ef4444" />
    </div>
  );
}

function Step7({ s, set, p, next }) {
  const correctCount = p.bits.reduce((a, b, i) => a + (b === p.detected[i] ? 1 : 0), 0);
  const allyOk = p.allyBer < 0.05;
  return (
    <div className="space-y-4">
      <HUDPanel accent="#22d3ee" title="◈ STAGE 07 · MATCHED RECEIVER" subtitle="correlator decisions">
        <div className="rounded bg-cyan-500/10 border border-cyan-500/30 p-3">
          <div className="text-[10px] tracking-widest text-cyan-400 mb-2 font-bold">▸ DECISION RULE</div>
          <div className="font-mono text-sm text-cyan-300">
            {(s.scheme === "DCSK" || s.scheme === "FM-DCSK")
              ? "z[n] = Σᵢ r[nβ + i] · r[nβ + β/2 + i]   →   bit = sign(z[n])"
              : "z[n] = Σᵢ r[nβ + i] · c[nβ + i]   →   bit = sign(z[n])"}
          </div>
        </div>
      </HUDPanel>

      <Constellation correlations={p.correlations} color="#22d3ee" height={180} />

      <BERPanel snrDb={s.snrDb} beta={s.beta} scheme={s.scheme}
        allyBer={p.allyBer} enemyBer={p.enemyBer} height={170} />

      <div className="grid grid-cols-3 gap-3">
        <HUDStat label="bits correct" value={`${correctCount}/${p.bits.length}`}
          sub={`${(correctCount / p.bits.length * 100).toFixed(1)}%`}
          color={allyOk ? "#10b981" : "#fbbf24"} big />
        <HUDStat label="ally BER" value={p.allyBer.toExponential(2)}
          sub={allyOk ? "✓ mission grade" : "△ marginal"}
          color={allyOk ? "#10b981" : "#fbbf24"} big />
        <HUDStat label="enemy BER" value={p.enemyBer.toExponential(2)}
          sub="enemy guesses" color="#ef4444" big />
      </div>

      {/* per-bit decisions, first 32 */}
      <HUDPanel accent="#22d3ee" title="◈ PER-BIT DECISIONS" subtitle="green=correct red=error">
        <BitMatrix original={p.bits} recovered={p.detected} color="#10b981" maxBits={Math.min(64, p.bits.length)} />
      </HUDPanel>

      <NextButton onClick={next} label="proceed → recovery" color="#22d3ee" />
    </div>
  );
}

function Step8({ s, p, next }) {
  return (
    <div className="space-y-4">
      <HUDPanel accent="#22d3ee" title="◈ STAGE 08 · RECOVERY">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-md border border-cyan-400/30 bg-cyan-400/5 p-5 text-center">
            <div className="text-[9px] tracking-widest text-cyan-400/70 mb-2 font-bold">ORIGINAL</div>
            <div className="font-mono text-3xl text-cyan-400 font-black tracking-[0.15em] break-all py-2">{s.text || "—"}</div>
            <div className="text-[10px] text-white/40 font-mono mt-2">transmitted</div>
          </div>
          <div className="rounded-md border-2 border-emerald-400/50 bg-emerald-400/10 p-5 text-center"
            style={{ boxShadow: "0 0 30px rgba(16,185,129,0.2)" }}>
            <div className="text-[9px] tracking-widest text-emerald-400 mb-2 font-bold">◈ ALLY DECODED</div>
            <div className="font-mono text-3xl text-emerald-400 font-black tracking-[0.15em] break-all py-2">{p.allyText || "—"}</div>
            <div className="text-[10px] text-emerald-300/70 mt-2 font-mono">BER {p.allyBer.toExponential(2)}</div>
          </div>
          <div className="rounded-md border-2 border-red-400/50 bg-red-400/10 p-5 text-center">
            <div className="text-[9px] tracking-widest text-red-400 mb-2 font-bold">⊕ ENEMY INTERCEPT</div>
            <div className="font-mono text-3xl text-red-400 font-black tracking-[0.15em] break-all py-2">{p.enemyText || "—"}</div>
            <div className="text-[10px] text-red-300/70 mt-2 font-mono">BER {p.enemyBer.toExponential(2)}</div>
          </div>
        </div>
      </HUDPanel>

      {/* Side-by-side bit matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <HUDPanel accent="#10b981" title="◈ ALLY BIT MATCH" subtitle="every bit">
          <BitMatrix original={p.bits} recovered={p.detected} color="#10b981" maxBits={Math.min(96, p.bits.length)} />
        </HUDPanel>
        <HUDPanel accent="#ef4444" title="◈ ENEMY BIT MATCH" subtitle="every bit">
          <BitMatrix original={p.bits} recovered={p.detectedEnemy} color="#ef4444" maxBits={Math.min(96, p.bits.length)} />
        </HUDPanel>
      </div>

      <NextButton onClick={next} label="proceed → debrief" />
    </div>
  );
}

function Step9({ s, p, reset, set }) {
  const success = p.allyBer < 0.05 && p.enemyBer > 0.3;
  const verdict = success ? "MISSION SUCCESS" : p.allyBer < 0.2 ? "DEGRADED LINK" : "FAILED";
  const color = success ? "#10b981" : p.allyBer < 0.2 ? "#fbbf24" : "#ef4444";
  const reliability = Math.round((1 - Math.min(1, p.allyBer * 10)) * 100);
  const stealthScore = Math.round(p.flatness * 60 + Math.min(s.beta / 128, 1) * 40);
  const recovery = Math.round((1 - p.allyBer) * 100);
  const enemyDenial = Math.round(Math.min(1, p.enemyBer / 0.5) * 100);

  return (
    <div className="space-y-4">
      {/* Verdict banner */}
      <div className="rounded-lg border-2 p-10 text-center relative overflow-hidden"
        style={{ borderColor: color, background: color + "08", boxShadow: `0 0 80px ${color}50` }}>
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: `repeating-linear-gradient(45deg, ${color} 0, transparent 1px, transparent 8px)` }} />
        <div className="relative">
          <div className="text-[11px] tracking-[0.5em] text-white/40 mb-3 font-bold">★ FINAL VERDICT ★</div>
          <div className="text-5xl font-black tracking-widest" style={{ color, textShadow: `0 0 30px ${color}80` }}>
            {verdict}
          </div>
        </div>
      </div>

      {/* Score rings */}
      <HUDPanel accent="#22d3ee" title="◈ MISSION SCORES" subtitle="performance metrics">
        <div className="flex justify-around items-center flex-wrap gap-4">
          <ScoreRing score={reliability}   label="Reliability"  color="#22d3ee" size={120} />
          <ScoreRing score={stealthScore}  label="Stealth"      color="#a78bfa" size={120} />
          <ScoreRing score={recovery}      label="Recovery"     color="#10b981" size={120} />
          <ScoreRing score={enemyDenial}   label="Enemy Denial" color="#fbbf24" size={120} />
        </div>
      </HUDPanel>

      <BERPanel snrDb={s.snrDb} beta={s.beta} scheme={s.scheme}
        allyBer={p.allyBer} enemyBer={p.enemyBer} height={180} />

      <HUDPanel accent="#22d3ee" title="◈ MISSION DOSSIER" subtitle="CLASSIFIED · COPY ONLY">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5">
          {[
            ["MESSAGE",     `"${s.text}"`],
            ["PAYLOAD",     `${s.text.length} chars`],
            ["BITS",        p.bits.length],
            ["QUANTIZE",    `${s.qBits}b ${s.qMethod}`],
            ["CARRIER",     `${s.carrierFunc} (${s.carrierParam.toFixed(3)})`],
            ["LYAPUNOV λ",  p.lyapunov.toFixed(3)],
            ["MODULATION",  s.scheme],
            ["β CHIPS/BIT", `${s.beta} (+${(10*Math.log10(s.beta)).toFixed(1)} dB)`],
            ["PULSE",       s.pulseType.toUpperCase()],
            ["CHANNEL",     `${s.channelType} @ ${s.snrDb}dB`],
            ["FLATNESS",    `${(p.flatness * 100).toFixed(0)}%`],
            ["TOTAL CHIPS", p.signal.length],
            ["ALLY BER",    p.allyBer.toExponential(2)],
            ["ENEMY BER",   p.enemyBer.toExponential(2)],
            ["RECOVERED",   `"${p.allyText}"`],
            ["VERDICT",     verdict],
          ].map(([k, v]) => (
            <div key={k} className="bg-black/40 px-3 py-2.5">
              <div className="text-[8px] uppercase tracking-widest text-white/40 font-bold">{k}</div>
              <div className="font-mono text-[11px] text-white font-bold mt-0.5 truncate">{v}</div>
            </div>
          ))}
        </div>
      </HUDPanel>

      <div className="grid grid-cols-3 gap-3">
        <button onClick={reset}
          className="py-3 rounded-md text-xs font-black tracking-[0.3em] uppercase border-2 border-cyan-400/50 text-cyan-400 bg-cyan-400/10 hover:bg-cyan-400/20 transition-all">
          ↻ Replay
        </button>
        <button onClick={() => set({ step: 1 })}
          className="py-3 rounded-md text-xs font-black tracking-[0.3em] uppercase border border-white/20 text-white/70 hover:bg-white/5 transition-all">
          ◀ Modify
        </button>
        <button onClick={() => navigator.clipboard?.writeText(JSON.stringify({ s, ber: p.allyBer, recovered: p.allyText }, null, 2))}
          className="py-3 rounded-md text-xs font-black tracking-[0.3em] uppercase border border-white/20 text-white/70 hover:bg-white/5 transition-all">
          ⎘ Copy JSON
        </button>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────

export default function MissionPage() {
  const [s, setS] = useState({ ...DEFAULT_STATE });
  const [completed, setCompleted] = useState(new Set());
  const stepRef = useRef(null);

  const set = (patch) => setS(prev => ({ ...prev, ...patch }));
  const reset = () => { setS({ ...DEFAULT_STATE }); setCompleted(new Set()); };

  const next = () => {
    setCompleted(c => new Set([...c, s.step]));
    setS(prev => ({ ...prev, step: Math.min(prev.step + 1, 9) }));
    setTimeout(() => stepRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const onJump = (n) => { setS(prev => ({ ...prev, step: n })); };

  const p = useMemo(() => computePipeline(s), [s]);

  const STEP_RENDER = {
    0: <Step0 next={next} />,
    1: <Step1 s={s} set={set} p={p} next={next} />,
    2: <Step2 s={s} set={set} p={p} next={next} />,
    3: <Step3 s={s} set={set} p={p} next={next} />,
    4: <Step4 s={s} set={set} p={p} next={next} />,
    5: <Step5 s={s} set={set} p={p} next={next} />,
    6: <Step6 s={s} set={set} p={p} next={next} />,
    7: <Step7 s={s} set={set} p={p} next={next} />,
    8: <Step8 s={s} p={p} next={next} />,
    9: <Step9 s={s} set={set} p={p} reset={reset} />,
  };

  const stepMeta = STEPS[s.step];

  return (
    <div className="min-h-screen text-white"
      style={{ background: "radial-gradient(ellipse at top, #0a1828 0%, #050a14 50%, #02060e 100%)" }}>

      {/* Scanlines */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-0"
        style={{ backgroundImage: "repeating-linear-gradient(0deg,#22d3ee 0,transparent 1px,transparent 4px)" }} />

      {/* Top status bar */}
      <div className="sticky top-0 z-30 border-b border-cyan-400/20 backdrop-blur-md"
        style={{ background: "rgba(2,4,9,0.85)" }}>
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-2xl font-black tracking-[0.15em]"
              style={{ background: "linear-gradient(90deg,#22d3ee,#10b981,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              ◈ PHANTOM SIGNAL
            </div>
            <span className="text-[9px] tracking-[0.3em] text-white/30 font-mono">CHAOSCOMM · ECE-UY-3404</span>
          </div>
          <div className="flex items-center gap-6 text-[10px] font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-cyan-400 font-bold tracking-wider">LIVE</span>
            </div>
            <div className="text-white/40">
              <span className="tracking-widest">STAGE</span>{" "}
              <span className="text-cyan-400 font-bold">{String(s.step).padStart(2, "0")}/09</span>{" "}
              <span className="text-white/60">· {stepMeta?.code}</span>
            </div>
            <div className="text-white/40">
              <span className="tracking-widest">BER</span>{" "}
              <span style={{ color: p.allyBer < 0.05 ? "#10b981" : p.allyBer < 0.2 ? "#fbbf24" : "#ef4444" }}
                className="font-bold">
                {p.allyBer.toExponential(1)}
              </span>
            </div>
          </div>
        </div>
        {/* Stage progress strip */}
        <div className="max-w-[1600px] mx-auto px-6 pb-2">
          <div className="flex gap-1">
            {STEPS.map((st, i) => {
              const done = completed.has(st.n);
              const active = s.step === st.n;
              const c = done ? "#10b981" : active ? "#22d3ee" : "#ffffff15";
              return (
                <div key={st.n} className="flex-1 flex flex-col items-center" title={st.title}>
                  <div className="h-0.5 w-full rounded-full" style={{ background: c }} />
                  <div className="text-[8px] tracking-[0.2em] mt-1 font-bold whitespace-nowrap"
                    style={{ color: active ? c : done ? "#10b98180" : "#ffffff30" }}>
                    {String(i).padStart(2, "0")}·{st.code}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main layout: sidebar + content */}
      <div className="relative z-10 max-w-[1600px] mx-auto px-4 py-5">
        <div className={s.step === 0 ? "" : "grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-5"}>
          {s.step !== 0 && (
            <aside>
              <Sidebar s={s} p={p} completed={completed} onJump={onJump} />
            </aside>
          )}
          <main ref={stepRef}>
            {/* Step header */}
            {s.step !== 0 && (
              <div className="mb-4 flex items-center gap-3 pb-3 border-b border-white/10">
                <div className="text-3xl font-black" style={{ color: "#22d3ee" }}>{stepMeta?.icon}</div>
                <div>
                  <div className="text-[9px] tracking-[0.3em] text-white/40 font-bold">STAGE {String(s.step).padStart(2, "0")}/09</div>
                  <div className="text-xl font-black text-white tracking-wider">{stepMeta?.title}</div>
                </div>
              </div>
            )}
            {STEP_RENDER[s.step]}
            {/* Footer nav */}
            {s.step > 0 && s.step < 9 && (
              <div className="mt-6 flex justify-between items-center text-[10px] font-mono pt-4 border-t border-white/5">
                <button onClick={() => setS(prev => ({ ...prev, step: Math.max(0, prev.step - 1) }))}
                  className="px-4 py-2 rounded text-white/40 hover:text-white/80 hover:bg-white/5 tracking-widest transition-all">
                  ◀ PREVIOUS
                </button>
                <span className="text-white/20">stage {s.step} / 9</span>
                <span className="opacity-0">spacer</span>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
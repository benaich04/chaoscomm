import { useEffect, useRef, useMemo, useState } from "react";
import {
  textToBits, imageToBits, audioToBits,
  chaoticSeq, modulate, applyChannel,
} from "./SimulationEngine.js";

/**
 * SignalLab — persistent live preview of s(t) at every pipeline stage.
 *
 * Stages visible (collapse if not yet configured):
 *   1. PAYLOAD   — original text/image/audio
 *   2. BITS      — binary stream b_n
 *   3. SYMBOLS   — bipolar symbols b_n ∈ {+1, -1}
 *   4. CARRIER   — chaotic sequence x_n(t)
 *   5. SIGNAL    — s(t) = Σ b_n · x_n(t - nTc)
 *   6. CHANNEL   — r(t) = s(t) + n(t)
 *   7. CORRELATE — z[n] at receiver
 *
 * The big green title says "s(t) = ..." with the actual function form.
 */

// ─── BIG SIGNAL DISPLAY ──────────────────────────────────────────────────────

function StageStrip({ label, code, signal, color, height = 70, dotted = false, formula }) {
  const ref = useRef(null);
  const hasData = signal && signal.length > 0;

  useEffect(() => {
    const cnv = ref.current;
    if (!cnv) return;
    const W = cnv.parentElement.clientWidth, H = height;
    const dpr = window.devicePixelRatio || 1;
    cnv.width = W * dpr; cnv.height = H * dpr;
    cnv.style.width = W + "px"; cnv.style.height = H + "px";
    const ctx = cnv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#020409"; ctx.fillRect(0, 0, W, H);

    if (!hasData) {
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("— awaiting input —", W / 2, H / 2);
      return;
    }

    const n = Math.min(signal.length, 600);
    const data = signal.slice(0, n);
    let mn = Math.min(...data), mx = Math.max(...data);
    if (mn === mx) { mn -= 0.5; mx += 0.5; }
    const range = mx - mn;
    const pad = 8;
    const toX = i => pad + (i / (n - 1)) * (W - pad * 2);
    const toY = v => H - pad - ((v - mn) / range) * (H - pad * 2);

    // Center line
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 0.5;
    if (mn < 0 && mx > 0) {
      ctx.beginPath(); ctx.moveTo(0, toY(0)); ctx.lineTo(W, toY(0)); ctx.stroke();
    }

    // Tc grid lines if data is short enough to show chip boundaries
    if (n < 200) {
      const Tc = Math.max(1, Math.floor(n / 16));
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      for (let i = 0; i < n; i += Tc) {
        ctx.beginPath(); ctx.moveTo(toX(i), 0); ctx.lineTo(toX(i), H); ctx.stroke();
      }
    }

    // Fill area
    if (!dotted) {
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(0));
      for (let i = 0; i < n; i++) ctx.lineTo(toX(i), toY(data[i]));
      ctx.lineTo(toX(n - 1), toY(0));
      ctx.closePath();
      ctx.fillStyle = color + "12"; ctx.fill();
    }

    // Stroke (smooth or stem depending on data)
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = color; ctx.shadowBlur = 4;

    if (dotted) {
      // Stem plot (for bits/symbols)
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.moveTo(toX(i), toY(0));
        ctx.lineTo(toX(i), toY(data[i]));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(toX(i), toY(data[i]), 2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = toX(i), y = toY(data[i]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }, [signal, color, height, dotted, hasData]);

  return (
    <div className="rounded-md border border-white/10 bg-black/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5"
        style={{ background: `linear-gradient(90deg, ${color}10, transparent)` }}>
        <div className="flex items-center gap-2">
          <span className="font-black text-[10px] tracking-[0.25em]" style={{ color }}>{code}</span>
          <span className="text-[10px] text-white/50">{label}</span>
        </div>
        {formula && (
          <span className="font-mono text-[10px]" style={{ color: color + "AA" }}>{formula}</span>
        )}
      </div>
      <canvas ref={ref} style={{ display: "block", width: "100%", height }} />
    </div>
  );
}

// ─── BITS BAR ────────────────────────────────────────────────────────────────

function BitsBar({ bits, max = 64, color = "#22d3ee" }) {
  const shown = (bits || []).slice(0, max);
  return (
    <div className="rounded-md border border-white/10 bg-black/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5"
        style={{ background: `linear-gradient(90deg, ${color}10, transparent)` }}>
        <div className="flex items-center gap-2">
          <span className="font-black text-[10px] tracking-[0.25em]" style={{ color }}>02 · BITS</span>
          <span className="text-[10px] text-white/50">b_n ∈ {`{0, 1}`}</span>
        </div>
        <span className="text-[10px] text-white/40 font-mono">{bits?.length || 0} bits</span>
      </div>
      <div className="p-2.5 flex flex-wrap gap-px">
        {shown.length === 0 ? (
          <span className="text-[10px] text-white/30 font-mono py-2 px-2">— awaiting input —</span>
        ) : (
          shown.map((b, i) => (
            <div key={i} className="font-mono text-[10px] font-bold w-4 h-5 flex items-center justify-center rounded-sm"
              style={{
                background: b === 1 ? color + "30" : "#ffffff08",
                color: b === 1 ? color : "#ffffff40",
                border: `1px solid ${b === 1 ? color + "50" : "#ffffff15"}`,
              }}>
              {b}
            </div>
          ))
        )}
        {bits && bits.length > max && (
          <span className="text-[10px] text-white/30 font-mono ml-1 self-center">+{bits.length - max}</span>
        )}
      </div>
    </div>
  );
}

// ─── EQUATION DISPLAY ────────────────────────────────────────────────────────

function SignalEquation({ state }) {
  const { modulation, chipsPerBit, chaoticMap, mapParameter, payloadBits } = state;
  const N = payloadBits?.length || 0;
  const beta = chipsPerBit || 64;

  let formula = "s(t) = ";
  let breakdown = [];

  if (modulation === "DCSK") {
    formula = "s(t) = ";
    breakdown = [
      { sym: "Σ_n", desc: `n = 0..${N - 1}` },
      { sym: "[ x_n(t)", desc: "reference half" },
      { sym: "+ b_n · x_n(t − T_c/2)", desc: "info half" },
      { sym: "] · φ(t − nT_b)", desc: "bit envelope" },
    ];
  } else if (modulation === "FM-DCSK") {
    formula = "s(t) = A·cos(2π fc·t + 2π Δf · ∫ x(τ)dτ)";
    breakdown = [
      { sym: "x(t) = DCSK baseband", desc: "" },
      { sym: "Δf = 2·β · σ_x", desc: "freq deviation" },
    ];
  } else {
    formula = "s(t) = ";
    breakdown = [
      { sym: "Σ_n", desc: `n = 0..${N - 1}` },
      { sym: "x_{r0}(t)", desc: "if b_n=0" },
      { sym: "x_{r1}(t)", desc: "if b_n=1" },
      { sym: "· φ(t − nT_b)", desc: "" },
    ];
  }

  return (
    <div className="rounded-md border border-emerald-400/30 bg-emerald-400/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-black text-[10px] tracking-[0.3em] text-emerald-400">▸ TRANSMITTED SIGNAL</span>
        <span className="text-[10px] text-white/40 font-mono">{N} bits · β={beta} · N_total={N * beta} samples</span>
      </div>
      <div className="font-mono text-base text-emerald-300 mb-3 break-all leading-relaxed">
        {formula}
        {modulation !== "FM-DCSK" && (
          <span className="text-emerald-400">
            {breakdown.map((b, i) => (
              <span key={i} className="mr-2 inline-block">{b.sym}</span>
            ))}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono">
        <Param label="modulation" value={modulation} />
        <Param label="chaotic map" value={`${chaoticMap}(${mapParameter?.toFixed(3) || "—"})`} />
        <Param label="β (chips/bit)" value={beta} />
        <Param label="processing gain" value={`+${(10 * Math.log10(beta)).toFixed(1)} dB`} />
      </div>
      {breakdown.length > 0 && (
        <div className="mt-3 pt-3 border-t border-emerald-400/15 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
          {breakdown.map((b, i) => (
            <div key={i} className="flex justify-between">
              <span className="font-mono text-emerald-300">{b.sym}</span>
              <span className="text-white/40 font-mono">{b.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Param({ label, value }) {
  return (
    <div className="flex flex-col">
      <span className="text-white/40 text-[9px] uppercase tracking-widest">{label}</span>
      <span className="text-emerald-300 font-bold">{value}</span>
    </div>
  );
}

// ─── MAIN SIGNAL LAB ─────────────────────────────────────────────────────────

export default function SignalLab({ state, expanded = true }) {
  const [open, setOpen] = useState(expanded);

  // Compute the live signals from the current state
  const data = useMemo(() => {
    const result = {
      bits: state.payloadBits || [],
      symbols: null, carrier: null, signal: null, rxAlly: null, correlation: null,
    };
    if (!state.payloadBits || state.payloadBits.length === 0) return result;

    // Trim bits for preview (use first 6 for visualization)
    const previewBits = state.payloadBits.slice(0, 6);

    // Bipolar symbols: 0 → -1, 1 → +1
    result.symbols = previewBits.map(b => b === 1 ? 1 : -1);

    // Chaotic carrier preview
    if (state.chaoticMap && state.mapParameter) {
      const beta = state.chipsPerBit || 64;
      const totalLen = previewBits.length * beta + 100;
      try {
        const seq = chaoticSeq(state.chaoticMap, state.mapParameter, 0.31415, totalLen);
        result.carrier = Array.from(seq.slice(50, 50 + 6 * beta));

        // Modulated signal s(t)
        if (state.modulation && state.payloadBits.length > 0) {
          const mod = modulate(previewBits, state.modulation, beta, state.chaoticMap, state.mapParameter);
          result.signal = Array.from(mod.signal);

          // Channel: apply only if SNR is set
          if (state.snrDb !== undefined) {
            const rx = applyChannel(
              mod.signal, state.channelType || "AWGN",
              state.snrDb, state.doppler || 0,
              state.multipathStrength || 0, state.jammerStrength || 0, 1,
            );
            result.rxAlly = Array.from(rx);

            // Correlation values (one per bit)
            if (state.modulation === "DCSK" || state.modulation === "FM-DCSK") {
              const half = Math.max(2, Math.floor(beta / 2));
              const correlations = [];
              for (let b = 0; b < previewBits.length; b++) {
                let z = 0;
                for (let i = 0; i < half; i++) {
                  z += rx[b * beta + i] * rx[b * beta + half + i];
                }
                correlations.push(z);
              }
              result.correlation = correlations;
            }
          }
        }
      } catch (e) { /* swallow */ }
    }
    return result;
  }, [state]);

  // Get the highest stage reached
  const stage = (() => {
    if (data.correlation) return 7;
    if (data.rxAlly) return 6;
    if (data.signal) return 5;
    if (data.carrier) return 4;
    if (data.symbols) return 3;
    if (data.bits.length > 0) return 2;
    return 1;
  })();

  return (
    <div className="rounded-lg border-2 border-emerald-400/25 bg-black/40 overflow-hidden"
      style={{ boxShadow: "0 0 30px rgba(16,185,129,0.08) inset" }}>

      {/* Header */}
      <button onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between border-b border-emerald-400/15 bg-emerald-400/5 hover:bg-emerald-400/10 transition-all">
        <div className="flex items-center gap-3">
          <span className="text-[10px] tracking-[0.3em] font-black text-emerald-400">◈ SIGNAL LABORATORY</span>
          <span className="text-[10px] font-mono text-white/40">stage {stage}/7</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5, 6, 7].map(s => (
              <div key={s} className="w-1.5 h-1.5 rounded-full"
                style={{ background: s <= stage ? "#10b981" : "#ffffff15" }} />
            ))}
          </div>
        </div>
        <span className="text-emerald-400 text-xs">{open ? "▾ HIDE" : "▸ EXPAND"}</span>
      </button>

      {open && (
        <div className="p-4 space-y-3">
          {/* Stage 1: bits */}
          <BitsBar bits={data.bits} max={64} color="#22d3ee" />

          {/* Stage 2: bipolar symbols */}
          {data.symbols && (
            <StageStrip
              label="bipolar symbols"
              code="03 · SYMBOLS"
              signal={data.symbols}
              color="#fbbf24"
              dotted
              height={60}
              formula="b_n ∈ {−1, +1}"
            />
          )}

          {/* Stage 3: chaotic carrier */}
          {data.carrier && (
            <StageStrip
              label="chaotic carrier x_n(t)"
              code="04 · CARRIER"
              signal={data.carrier.slice(0, 400)}
              color="#a78bfa"
              height={70}
              formula={`${state.chaoticMap}, λ > 0`}
            />
          )}

          {/* Stage 4: SIGNAL — the headline */}
          {data.signal && <SignalEquation state={state} />}

          {data.signal && (
            <StageStrip
              label="modulated baseband"
              code="05 · s(t)"
              signal={data.signal.slice(0, 600)}
              color="#10b981"
              height={90}
              formula={`${state.modulation}, T_c = 1/${state.chipsPerBit}`}
            />
          )}

          {/* Stage 5: channel output */}
          {data.rxAlly && (
            <StageStrip
              label={`r(t) = s(t) + n(t) · ${state.channelType}`}
              code="06 · CHANNEL"
              signal={data.rxAlly.slice(0, 600)}
              color="#94a3b8"
              height={70}
              formula={`SNR ${state.snrDb} dB`}
            />
          )}

          {/* Stage 6: correlation outputs */}
          {data.correlation && (
            <div className="rounded-md border border-cyan-400/25 bg-cyan-400/5 p-3">
              <div className="flex justify-between mb-2">
                <span className="font-black text-[10px] tracking-[0.25em] text-cyan-400">07 · CORRELATOR z[n]</span>
                <span className="text-[10px] text-white/40 font-mono">decision: sign(z[n])</span>
              </div>
              <div className="grid grid-cols-6 gap-2">
                {data.correlation.map((z, i) => {
                  const decision = z > 0 ? 1 : 0;
                  const sent = state.payloadBits[i];
                  const correct = decision === sent;
                  return (
                    <div key={i} className="rounded p-2 text-center"
                      style={{
                        background: correct ? "#10b98115" : "#ef444415",
                        border: `1px solid ${correct ? "#10b98140" : "#ef444440"}`,
                      }}>
                      <div className="text-[8px] uppercase tracking-widest text-white/40">bit {i}</div>
                      <div className="font-mono text-[10px] font-bold mt-0.5"
                        style={{ color: z > 0 ? "#10b981" : "#fbbf24" }}>
                        z = {z.toFixed(2)}
                      </div>
                      <div className="text-[9px] mt-0.5">
                        <span className="text-white/40">sent {sent}</span>
                        <span className="mx-1 text-white/20">·</span>
                        <span style={{ color: correct ? "#10b981" : "#ef4444" }}>got {decision} {correct ? "✓" : "✗"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!data.signal && (
            <div className="rounded-md border border-dashed border-white/15 p-6 text-center">
              <div className="text-2xl text-white/20 mb-2">∿</div>
              <div className="text-xs text-white/40 font-mono">
                Configure modulation + map to see s(t)
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
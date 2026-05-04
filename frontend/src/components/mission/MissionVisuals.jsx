import { useEffect, useRef } from "react";

// ─── PSD Panel ─────────────────────────────────────────────────────────────

export function PSDPanel({ psd, color = "#a78bfa", height = 120, label = "PSD", flatness }) {
  const ref = useRef(null);
  useEffect(() => {
    const cnv = ref.current;
    if (!cnv || !psd?.length) return;
    const W = cnv.parentElement.clientWidth, H = height;
    const dpr = window.devicePixelRatio || 1;
    cnv.width = W * dpr; cnv.height = H * dpr;
    cnv.style.width = W + "px"; cnv.style.height = H + "px";
    const ctx = cnv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#020409"; ctx.fillRect(0, 0, W, H);

    const mn = Math.min(...psd), mx = Math.max(...psd), range = (mx - mn) || 1;
    const padX = 12, padY = 14;
    const toX = i => padX + (i / (psd.length - 1)) * (W - padX * 2);
    const toY = v => H - padY - ((v - mn) / range) * (H - padY * 2);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 0.5;
    for (let g = 0; g < 5; g++) {
      const y = padY + (g / 4) * (H - padY * 2);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Filled
    ctx.beginPath(); ctx.moveTo(toX(0), H);
    psd.forEach((v, i) => ctx.lineTo(toX(i), toY(v)));
    ctx.lineTo(toX(psd.length - 1), H); ctx.closePath();
    ctx.fillStyle = color + "20"; ctx.fill();
    // Line
    ctx.strokeStyle = color; ctx.lineWidth = 1.2;
    ctx.shadowColor = color; ctx.shadowBlur = 4;
    ctx.beginPath();
    psd.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
    ctx.stroke();
    ctx.shadowBlur = 0;

    // dB labels
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${mx.toFixed(0)} dB`, padX - 3, padY + 6);
    ctx.fillText(`${mn.toFixed(0)} dB`, padX - 3, H - padY);
  }, [psd, color, height]);

  return (
    <div className="rounded-md border bg-black/40 overflow-hidden"
      style={{ borderColor: color + "30", boxShadow: `inset 0 0 30px ${color}06` }}>
      <div className="px-3 py-1.5 border-b flex justify-between items-center"
        style={{ borderColor: color + "20", background: `linear-gradient(90deg, ${color}12, transparent)` }}>
        <span className="text-[10px] tracking-[0.3em] font-black" style={{ color }}>{label}</span>
        {flatness !== undefined && (
          <span className="text-[10px] font-mono" style={{ color: color + "BB" }}>
            flatness {(flatness * 100).toFixed(0)}%
          </span>
        )}
      </div>
      <canvas ref={ref} style={{ display: "block", width: "100%", height }} />
    </div>
  );
}

// ─── Autocorrelation Panel ─────────────────────────────────────────────────

export function AutocorrPanel({ ac, color = "#fbbf24", height = 100 }) {
  const ref = useRef(null);
  useEffect(() => {
    const cnv = ref.current;
    if (!cnv || !ac?.length) return;
    const W = cnv.parentElement.clientWidth, H = height;
    const dpr = window.devicePixelRatio || 1;
    cnv.width = W * dpr; cnv.height = H * dpr;
    cnv.style.width = W + "px"; cnv.style.height = H + "px";
    const ctx = cnv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#020409"; ctx.fillRect(0, 0, W, H);

    const mn = Math.min(...ac), mx = Math.max(...ac);
    const range = Math.max(Math.abs(mn), Math.abs(mx));
    const padX = 12, padY = 12;
    const toX = i => padX + (i / (ac.length - 1)) * (W - padX * 2);
    const toY = v => H / 2 - (v / range) * (H / 2 - padY);

    // Center line
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    // Center column
    const center = Math.floor(ac.length / 2);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath(); ctx.moveTo(toX(center), 0); ctx.lineTo(toX(center), H); ctx.stroke();

    // Stems
    for (let i = 0; i < ac.length; i++) {
      const isCenter = i === center;
      ctx.strokeStyle = isCenter ? color : color + "60";
      ctx.lineWidth = isCenter ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(toX(i), H / 2); ctx.lineTo(toX(i), toY(ac[i])); ctx.stroke();
      ctx.fillStyle = isCenter ? color : color + "AA";
      ctx.shadowColor = color; ctx.shadowBlur = isCenter ? 6 : 0;
      ctx.beginPath(); ctx.arc(toX(i), toY(ac[i]), isCenter ? 3 : 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }, [ac, color, height]);

  return (
    <div className="rounded-md border bg-black/40 overflow-hidden"
      style={{ borderColor: color + "30" }}>
      <div className="px-3 py-1.5 border-b text-[10px] tracking-[0.3em] font-black"
        style={{ borderColor: color + "20", background: `linear-gradient(90deg, ${color}12, transparent)`, color }}>
        AUTOCORRELATION R[k]
      </div>
      <canvas ref={ref} style={{ display: "block", width: "100%", height }} />
    </div>
  );
}

// ─── BER Chart Panel ───────────────────────────────────────────────────────

import { Qfn } from "./QFunc.js";

export function BERPanel({ snrDb, beta, scheme, allyBer, enemyBer, height = 140 }) {
  const ref = useRef(null);
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

    const padX = 30, padY = 18;
    const pw = W - padX * 2, ph = H - padY * 2;
    const ebn0Range = [-5, 20];
    const logRange = [-8, 0];
    const toX = v => padX + ((v - ebn0Range[0]) / (ebn0Range[1] - ebn0Range[0])) * pw;
    const toY = v => {
      const lv = Math.log10(Math.max(v, 1e-9));
      return padY + ((logRange[1] - lv) / (logRange[1] - logRange[0])) * ph;
    };

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 0.5;
    for (let g = -8; g <= 0; g++) {
      const y = toY(Math.pow(10, g));
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(W - padX, y); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText(`10${"⁻⁸⁻⁷⁻⁶⁻⁵⁻⁴⁻³⁻²⁻¹⁰".slice((g + 8) * 2, (g + 8) * 2 + 2)}`, padX - 3, y + 3);
    }
    for (let e = -5; e <= 20; e += 5) {
      const x = toX(e);
      ctx.beginPath(); ctx.moveTo(x, padY); ctx.lineTo(x, H - padY); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.textAlign = "center";
      ctx.fillText(`${e}`, x, H - 4);
    }

    // BPSK reference
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let e = -5; e <= 20; e += 0.5) {
      const ebn0 = Math.pow(10, e / 10);
      const ber = Math.max(1e-9, Qfn(Math.sqrt(2 * ebn0)));
      e === -5 ? ctx.moveTo(toX(e), toY(ber)) : ctx.lineTo(toX(e), toY(ber));
    }
    ctx.stroke();

    // Scheme curve
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#22d3ee"; ctx.shadowBlur = 4;
    ctx.beginPath();
    for (let e = -5; e <= 20; e += 0.5) {
      const ebn0 = Math.pow(10, e / 10);
      let arg;
      if (scheme === "DCSK" || scheme === "FM-DCSK") arg = (beta / 2) * ebn0;
      else arg = beta * ebn0;
      const ber = Math.max(1e-9, Qfn(Math.sqrt(arg)));
      e === -5 ? ctx.moveTo(toX(e), toY(ber)) : ctx.lineTo(toX(e), toY(ber));
    }
    ctx.stroke(); ctx.shadowBlur = 0;

    // Op point
    ctx.strokeStyle = "#fbbf24";
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(toX(snrDb), padY); ctx.lineTo(toX(snrDb), H - padY); ctx.stroke();
    ctx.setLineDash([]);

    // Ally op marker
    if (allyBer !== undefined) {
      ctx.fillStyle = "#fbbf24";
      ctx.shadowColor = "#fbbf24"; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(toX(snrDb), toY(allyBer), 4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Legend
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#10b981"; ctx.fillText("— BPSK", padX + 6, padY + 12);
    ctx.fillStyle = "#22d3ee"; ctx.fillText(`— ${scheme}`, padX + 6, padY + 24);
    ctx.fillStyle = "#fbbf24"; ctx.fillText("● operating point", padX + 6, padY + 36);
  }, [snrDb, beta, scheme, allyBer, enemyBer, height]);

  return (
    <div className="rounded-md border bg-black/40 overflow-hidden"
      style={{ borderColor: "#22d3ee30" }}>
      <div className="px-3 py-1.5 border-b text-[10px] tracking-[0.3em] font-black text-cyan-400"
        style={{ borderColor: "#22d3ee20", background: "linear-gradient(90deg, #22d3ee12, transparent)" }}>
        BER vs Eb/N₀ — P_e = Q(√(β/2 · Eb/N₀))
      </div>
      <canvas ref={ref} style={{ display: "block", width: "100%", height }} />
    </div>
  );
}

// ─── Eye Diagram ───────────────────────────────────────────────────────────

export function EyeDiagram({ signal, beta, color = "#10b981", height = 120 }) {
  const ref = useRef(null);
  useEffect(() => {
    const cnv = ref.current;
    if (!cnv || !signal?.length) return;
    const W = cnv.parentElement.clientWidth, H = height;
    const dpr = window.devicePixelRatio || 1;
    cnv.width = W * dpr; cnv.height = H * dpr;
    cnv.style.width = W + "px"; cnv.style.height = H + "px";
    const ctx = cnv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#020409"; ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

    const mn = Math.min(...signal), mx = Math.max(...signal);
    const range = Math.max(Math.abs(mn), Math.abs(mx)) || 1;
    const padY = 10;
    const toY = v => H / 2 - (v / range) * (H / 2 - padY);
    const toX = i => (i / (2 * beta)) * W;

    // Overlay traces — every bit period overlapped
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.25;
    const nBits = Math.floor(signal.length / beta);
    for (let n = 0; n < Math.min(nBits, 80); n++) {
      ctx.beginPath();
      for (let i = 0; i < 2 * beta && (n * beta + i) < signal.length; i++) {
        const v = signal[n * beta + i];
        i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Decision boundary at center
    ctx.strokeStyle = "#fbbf24";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);
  }, [signal, beta, color, height]);

  return (
    <div className="rounded-md border bg-black/40 overflow-hidden"
      style={{ borderColor: color + "30" }}>
      <div className="px-3 py-1.5 border-b text-[10px] tracking-[0.3em] font-black"
        style={{ borderColor: color + "20", background: `linear-gradient(90deg, ${color}12, transparent)`, color }}>
        EYE DIAGRAM
      </div>
      <canvas ref={ref} style={{ display: "block", width: "100%", height }} />
    </div>
  );
}

// ─── Constellation ─────────────────────────────────────────────────────────

export function Constellation({ correlations, color = "#22d3ee", height = 180 }) {
  const ref = useRef(null);
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

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    // Decision boundary
    ctx.strokeStyle = "#fbbf24";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);

    if (!correlations?.length) return;
    const zVals = correlations.map(c => c.z);
    const maxZ = Math.max(...zVals.map(Math.abs)) || 1;
    correlations.forEach((c, i) => {
      const x = W / 2 + (c.z / maxZ) * (W / 2 - 20);
      const y = H / 2 + ((Math.random() - 0.5) * 0.3) * H * 0.6;
      ctx.fillStyle = c.decision === 1 ? "#10b981" : "#ef4444";
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    });

    // Labels
    ctx.fillStyle = "rgba(239,68,68,0.7)"; ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "left"; ctx.fillText("bit = 0", 8, 14);
    ctx.fillStyle = "rgba(16,185,129,0.7)";
    ctx.textAlign = "right"; ctx.fillText("bit = 1", W - 8, 14);
  }, [correlations, color, height]);

  return (
    <div className="rounded-md border bg-black/40 overflow-hidden" style={{ borderColor: color + "30" }}>
      <div className="px-3 py-1.5 border-b text-[10px] tracking-[0.3em] font-black"
        style={{ borderColor: color + "20", background: `linear-gradient(90deg, ${color}12, transparent)`, color }}>
        CORRELATOR OUTPUT z[n]
      </div>
      <canvas ref={ref} style={{ display: "block", width: "100%", height }} />
    </div>
  );
}

// ─── Score Ring ────────────────────────────────────────────────────────────

export function ScoreRing({ score, label, color = "#22d3ee", size = 110 }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id={`grad-${label}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </linearGradient>
        </defs>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={`url(#grad-${label})`} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: "stroke-dashoffset 1.2s" }} />
        <text x={size/2} y={size/2 + 5} textAnchor="middle"
          fontFamily="'JetBrains Mono', monospace" fontWeight="900" fontSize="22" fill={color}>
          {score}
        </text>
        <text x={size/2} y={size/2 + 22} textAnchor="middle"
          fontFamily="'JetBrains Mono', monospace" fontSize="8" fill="rgba(255,255,255,0.4)">
          /100
        </text>
      </svg>
      <div className="text-[9px] uppercase tracking-widest text-white/50 mt-1 text-center">{label}</div>
    </div>
  );
}

// ─── Bit Matrix ────────────────────────────────────────────────────────────

export function BitMatrix({ original, recovered, color = "#22d3ee", maxBits = 64 }) {
  const o = (original || []).slice(0, maxBits);
  const r = (recovered || []).slice(0, maxBits);
  return (
    <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${Math.min(maxBits, 32)}, minmax(0, 1fr))` }}>
      {o.map((b, i) => {
        const got = r[i];
        const correct = got === b;
        return (
          <div key={i} className="aspect-square rounded-sm border flex items-center justify-center text-[7px] font-mono font-bold"
            style={{
              background: !correct ? "#ef444430" : b === 1 ? color + "30" : "#ffffff05",
              color: !correct ? "#ef4444" : b === 1 ? color : "#ffffff40",
              borderColor: !correct ? "#ef444460" : b === 1 ? color + "50" : "#ffffff15",
            }}>
            {b}
          </div>
        );
      })}
    </div>
  );
}

// ─── HUD Stat ──────────────────────────────────────────────────────────────

export function HUDStat({ label, value, sub, color = "#22d3ee", trend, big }) {
  return (
    <div className="rounded-md border bg-black/40 px-3 py-2 relative overflow-hidden"
      style={{ borderColor: color + "30" }}>
      <div className="absolute top-0 left-0 w-1 h-full" style={{ background: `linear-gradient(180deg, ${color}, transparent)` }} />
      <div className="text-[9px] uppercase tracking-widest text-white/40 font-bold pl-1">{label}</div>
      <div className={`pl-1 font-mono font-black ${big ? "text-2xl" : "text-base"}`} style={{ color }}>{value}</div>
      {sub && <div className="text-[9px] text-white/40 pl-1 font-mono mt-0.5">{sub}</div>}
      {trend !== undefined && (
        <div className="absolute bottom-1 right-2 text-[9px] font-mono"
          style={{ color: trend > 0 ? "#10b981" : "#ef4444" }}>
          {trend > 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}
        </div>
      )}
    </div>
  );
}
import { useEffect, useRef } from "react";

export default function StageStrip({
  signal, color = "#22d3ee",
  label, formula, badge,
  height = 150, dotted = false,
  empty = "no signal yet",
}) {
  const ref = useRef(null);
  const has = signal && signal.length > 0;

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

    if (!has) {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.font = "11px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(empty, W / 2, H / 2);
      return;
    }

    const n = Math.min(signal.length, 1200);
    const data = signal.slice(0, n);
    let mn = Math.min(...data), mx = Math.max(...data);
    if (mn === mx) { mn -= 0.5; mx += 0.5; }
    const range = mx - mn;
    const padX = 12, padY = 14;
    const toX = i => padX + (i / (n - 1)) * (W - padX * 2);
    const toY = v => H - padY - ((v - mn) / range) * (H - padY * 2);

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    if (mn < 0 && mx > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.beginPath(); ctx.moveTo(0, toY(0)); ctx.lineTo(W, toY(0)); ctx.stroke();
    }

    if (dotted) {
      for (let i = 0; i < n; i++) {
        ctx.strokeStyle = color + "70";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(toX(i), toY(0)); ctx.lineTo(toX(i), toY(data[i])); ctx.stroke();
        ctx.fillStyle = color;
        ctx.shadowColor = color; ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.arc(toX(i), toY(data[i]), 3, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(toX(0), H);
      for (let i = 0; i < n; i++) ctx.lineTo(toX(i), toY(data[i]));
      ctx.lineTo(toX(n - 1), H); ctx.closePath();
      ctx.fillStyle = color + "1A"; ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = color; ctx.shadowBlur = 6;
      ctx.beginPath();
      for (let i = 0; i < n; i++) i === 0 ? ctx.moveTo(toX(i), toY(data[i])) : ctx.lineTo(toX(i), toY(data[i]));
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // y-axis labels
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText(mx.toFixed(2), padX - 3, padY + 6);
    ctx.fillText(mn.toFixed(2), padX - 3, H - padY);
  }, [signal, color, height, dotted, empty, has]);

  return (
    <div className="rounded-md border bg-black/40 overflow-hidden"
      style={{ borderColor: color + "30", boxShadow: `inset 0 0 30px ${color}08` }}>
      <div className="px-4 py-2 flex items-center justify-between border-b"
        style={{ borderColor: color + "20", background: `linear-gradient(90deg, ${color}15, transparent)` }}>
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-black tracking-[0.3em]" style={{ color }}>{label}</div>
          {badge && <span className="text-[9px] px-2 py-0.5 rounded-full font-mono"
            style={{ background: color + "20", color, border: `1px solid ${color}40` }}>{badge}</span>}
        </div>
        {formula && <div className="font-mono text-[11px] truncate" style={{ color: color + "BB" }}>{formula}</div>}
      </div>
      <canvas ref={ref} style={{ display: "block", width: "100%", height }} />
    </div>
  );
}
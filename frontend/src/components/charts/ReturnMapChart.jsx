import { useEffect, useRef } from "react";

/**
 * ReturnMapChart — parametric scatter of (xₙ, xₙ₊₁).
 *
 * For a 1D map f, this plot literally traces f(x): each orbit sample
 * x_n produces the point (x_n, f(x_n) = x_{n+1}).  In a periodic
 * regime you see isolated dots; in chaos you see the deterministic
 * function curve *revealed by the dynamics*.
 *
 * This is one of the most underrated visualizations in nonlinear
 * dynamics — most people don't realize that even noisy-looking chaotic
 * orbits trace out a clean function graph.
 *
 * Props:
 *   orbit  — number[]  (1D orbit)
 *   domain — [lo, hi]
 *   size   — pixel size of the square canvas (default 320)
 */

const PAD = 36;

export default function ReturnMapChart({ orbit, domain = [0, 1], size = 320 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv || !orbit || orbit.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    cnv.width = size * dpr;
    cnv.height = size * dpr;
    cnv.style.width = `${size}px`;
    cnv.style.height = `${size}px`;
    const ctx = cnv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const [lo, hi] = domain;
    const span = hi - lo;
    const plotSize = size - 2 * PAD;

    const toX = (v) => PAD + ((v - lo) / span) * plotSize;
    const toY = (v) => PAD + plotSize - ((v - lo) / span) * plotSize;

    // Background
    ctx.fillStyle = "#0a0e1a";
    ctx.fillRect(0, 0, size, size);

    // Grid
    ctx.strokeStyle = "#2a3454";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const v = lo + (i / 5) * span;
      const px = toX(v), py = toY(v);
      ctx.beginPath(); ctx.moveTo(px, PAD); ctx.lineTo(px, PAD + plotSize); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD, py); ctx.lineTo(PAD + plotSize, py); ctx.stroke();
    }

    // Border
    ctx.strokeStyle = "#2a3454";
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD, PAD, plotSize, plotSize);

    // y = x diagonal
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(toX(lo), toY(lo));
    ctx.lineTo(toX(hi), toY(hi));
    ctx.stroke();
    ctx.setLineDash([]);

    // Points — skip first 200 as transient
    const skip = Math.min(200, Math.floor(orbit.length * 0.1));
    ctx.fillStyle = "rgba(34, 211, 238, 0.45)";
    for (let i = skip; i < orbit.length - 1; i++) {
      const x = orbit[i], y = orbit[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < lo || x > hi || y < lo || y > hi) continue;
      ctx.fillRect(toX(x), toY(y), 1.5, 1.5);
    }

    // Axis labels
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("xₙ", size / 2, size - 14);
    ctx.save();
    ctx.translate(10, size / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "top";
    ctx.fillText("xₙ₊₁", 0, 0);
    ctx.restore();

    // Tick labels
    ctx.textBaseline = "top";
    ctx.fillText(lo.toFixed(1), toX(lo), PAD + plotSize + 4);
    ctx.fillText(hi.toFixed(1), toX(hi), PAD + plotSize + 4);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(lo.toFixed(1), PAD - 4, toY(lo));
    ctx.fillText(hi.toFixed(1), PAD - 4, toY(hi));

  }, [orbit, domain, size]);

  if (!orbit || orbit.length < 2) {
    return (
      <div style={{ width: size, height: size }}
           className="flex items-center justify-center text-xs text-ink-dim bg-bg-base rounded-md border border-bg-line">
        No orbit data
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <canvas ref={canvasRef} className="rounded-md" />
    </div>
  );
}
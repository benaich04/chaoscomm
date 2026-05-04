import { useEffect, useRef } from "react";

/**
 * WaveformChart — Canvas-based CSK/DCSK waveform renderer with per-bit
 * color-coding.
 *
 * For DCSK: reference half in cyan, information half in amber.
 * For CSK:  bit-0 chips in cyan, bit-1 chips in amber.
 *
 * Canvas is used instead of Recharts because:
 *   1. CSK waveforms can have 1000+ chips — Recharts slows down
 *   2. We need per-segment coloring which Recharts can't do natively
 *   3. The stepped waveform look requires custom drawing anyway
 */

const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 24;

export default function WaveformChart({
  waveform,
  perBit,
  scheme = "dcsk",
  height = 200,
  showFirst = 600,
  domain = null,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const cnv = canvasRef.current;
    const container = containerRef.current;
    if (!cnv || !container || !waveform || waveform.length < 2) return;

    const width = container.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    cnv.width = width * dpr;
    cnv.height = height * dpr;
    cnv.style.width = `${width}px`;
    cnv.style.height = `${height}px`;
    const ctx = cnv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const n = Math.min(waveform.length, showFirst);
    const data = waveform.slice(0, n);

    // Y range
    let yMin, yMax;
    if (domain) {
      [yMin, yMax] = domain;
    } else {
      yMin = Math.min(...data);
      yMax = Math.max(...data);
      const pad = (yMax - yMin) * 0.1 || 0.1;
      yMin -= pad;
      yMax += pad;
    }

    const plotW = width - PAD_L - PAD_R;
    const plotH = height - PAD_T - PAD_B;

    const toX = (i) => PAD_L + (i / n) * plotW;
    const toY = (v) => PAD_T + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    // Background
    ctx.fillStyle = "#0a0e1a";
    ctx.fillRect(0, 0, width, height);

    // Border + grid
    ctx.strokeStyle = "#2a3454";
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD_L, PAD_T, plotW, plotH);

    // Zero line
    if (yMin < 0 && yMax > 0) {
      ctx.strokeStyle = "#64748b";
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD_L, toY(0));
      ctx.lineTo(PAD_L + plotW, toY(0));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw per-bit colored segments
    if (perBit && perBit.length > 0) {
      for (const pb of perBit) {
        const start = pb.chip_start ?? pb.ref_start ?? 0;
        const end = Math.min(pb.chip_end ?? pb.info_end ?? n, n);
        if (start >= n) continue;

        if (scheme === "dcsk" || scheme === "fm_dcsk") {
          // Reference half: cyan
          const refEnd = Math.min(pb.ref_end ?? start, n);
          if (refEnd > start) {
            ctx.strokeStyle = "rgba(34, 211, 238, 0.8)";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(toX(start), toY(data[start]));
            for (let i = start + 1; i < refEnd; i++) {
              ctx.lineTo(toX(i), toY(data[i]));
            }
            ctx.stroke();
          }
          // Info half: amber
          const infoStart = pb.info_start ?? refEnd;
          const infoEnd = Math.min(pb.info_end ?? end, n);
          if (infoEnd > infoStart) {
            ctx.strokeStyle = "rgba(251, 191, 36, 0.8)";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(toX(infoStart), toY(data[infoStart]));
            for (let i = infoStart + 1; i < infoEnd; i++) {
              ctx.lineTo(toX(i), toY(data[i]));
            }
            ctx.stroke();
          }
        } else {
          // CSK: bit 0 = cyan, bit 1 = amber
          const color = pb.bit_value === 1
            ? "rgba(251, 191, 36, 0.8)"
            : "rgba(34, 211, 238, 0.8)";
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(toX(start), toY(data[start]));
          for (let i = start + 1; i < end && i < n; i++) {
            ctx.lineTo(toX(i), toY(data[i]));
          }
          ctx.stroke();
        }

        // Bit value label at top
        const midX = toX((start + Math.min(end, n)) / 2);
        ctx.fillStyle = pb.bit_value === 1 ? "#fbbf24" : "#22d3ee";
        ctx.font = "9px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(String(pb.bit_value), midX, PAD_T - 1);

        // Separator line between bits
        if (start > 0) {
          ctx.strokeStyle = "rgba(42, 52, 84, 0.6)";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(toX(start), PAD_T);
          ctx.lineTo(toX(start), PAD_T + plotH);
          ctx.stroke();
        }
      }
    } else {
      // Fallback: single color
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(data[0]));
      for (let i = 1; i < n; i++) ctx.lineTo(toX(i), toY(data[i]));
      ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("chip index", width / 2, height - 10);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(yMin.toFixed(1), PAD_L - 4, toY(yMin));
    ctx.fillText(yMax.toFixed(1), PAD_L - 4, toY(yMax));

    // Legend
    const legY = PAD_T + 6;
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "left";
    if (scheme === "dcsk" || scheme === "fm_dcsk") {
      ctx.fillStyle = "#22d3ee"; ctx.fillRect(PAD_L + 6, legY, 12, 3);
      ctx.fillStyle = "#e2e8f0"; ctx.fillText("reference", PAD_L + 22, legY + 4);
      ctx.fillStyle = "#fbbf24"; ctx.fillRect(PAD_L + 80, legY, 12, 3);
      ctx.fillStyle = "#e2e8f0"; ctx.fillText("information", PAD_L + 96, legY + 4);
    } else {
      ctx.fillStyle = "#22d3ee"; ctx.fillRect(PAD_L + 6, legY, 12, 3);
      ctx.fillStyle = "#e2e8f0"; ctx.fillText("bit 0 (r₀)", PAD_L + 22, legY + 4);
      ctx.fillStyle = "#fbbf24"; ctx.fillRect(PAD_L + 90, legY, 12, 3);
      ctx.fillStyle = "#e2e8f0"; ctx.fillText("bit 1 (r₁)", PAD_L + 106, legY + 4);
    }

  }, [waveform, perBit, scheme, height, showFirst, domain]);

  if (!waveform || waveform.length < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-xs text-ink-dim">
        No waveform data
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <canvas ref={canvasRef} className="rounded-md" style={{ width: "100%", height }} />
    </div>
  );
}
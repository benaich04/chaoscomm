import { useEffect, useRef, useState } from "react";

/**
 * HenonAttractorChart — the iconic 2D strange attractor.
 *
 * Features:
 *   - Canvas-based for 10k+ points
 *   - Click anywhere to zoom 4× centered on that point
 *   - "Reset zoom" button returns to full view
 *   - Each zoom level reveals more fractal layered structure —
 *     the self-similarity is the visual punchline
 *
 * Props:
 *   orbitX, orbitY — parallel arrays of the x and y components
 *   width, height  — canvas dimensions
 */

const PAD = 40;

export default function HenonAttractorChart({
  orbitX, orbitY,
  width = 560, height = 380,
}) {
  const canvasRef = useRef(null);
  const [view, setView] = useState(null); // null = auto-fit
  const [zoomLevel, setZoomLevel] = useState(0);

  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv || !orbitX || !orbitY || orbitX.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    cnv.width = width * dpr;
    cnv.height = height * dpr;
    cnv.style.width = `${width}px`;
    cnv.style.height = `${height}px`;
    const ctx = cnv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Compute view bounds
    let xMin, xMax, yMin, yMax;
    if (view) {
      ({ xMin, xMax, yMin, yMax } = view);
    } else {
      // Auto-fit with 5% padding
      xMin = Math.min(...orbitX); xMax = Math.max(...orbitX);
      yMin = Math.min(...orbitY); yMax = Math.max(...orbitY);
      const xPad = (xMax - xMin) * 0.05 || 0.1;
      const yPad = (yMax - yMin) * 0.05 || 0.1;
      xMin -= xPad; xMax += xPad;
      yMin -= yPad; yMax += yPad;
    }

    const plotW = width - 2 * PAD;
    const plotH = height - 2 * PAD;
    const spanX = xMax - xMin;
    const spanY = yMax - yMin;

    const toX = (v) => PAD + ((v - xMin) / spanX) * plotW;
    const toY = (v) => PAD + plotH - ((v - yMin) / spanY) * plotH;

    // Background
    ctx.fillStyle = "#0a0e1a";
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = "rgba(42, 52, 84, 0.5)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const px = PAD + (i / 5) * plotW;
      const py = PAD + (i / 5) * plotH;
      ctx.beginPath(); ctx.moveTo(px, PAD); ctx.lineTo(px, PAD + plotH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD, py); ctx.lineTo(PAD + plotW, py); ctx.stroke();
    }

    // Border
    ctx.strokeStyle = "#2a3454";
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD, PAD, plotW, plotH);

    // Points — skip transient
    const skip = Math.min(500, Math.floor(orbitX.length * 0.05));
    ctx.fillStyle = "rgba(251, 191, 36, 0.5)"; // amber
    for (let i = skip; i < orbitX.length; i++) {
      const x = orbitX[i], y = orbitY[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < xMin || x > xMax || y < yMin || y > yMax) continue;
      ctx.fillRect(toX(x), toY(y), 1.2, 1.2);
    }

    // Axis labels + ticks
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("x", width / 2, height - 12);
    ctx.fillText(xMin.toFixed(2), toX(xMin), PAD + plotH + 4);
    ctx.fillText(xMax.toFixed(2), toX(xMax), PAD + plotH + 4);
    ctx.save();
    ctx.translate(10, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "top";
    ctx.fillText("y", 0, 0);
    ctx.restore();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(yMin.toFixed(2), PAD - 4, toY(yMin));
    ctx.fillText(yMax.toFixed(2), PAD - 4, toY(yMax));

    // Zoom level indicator
    if (zoomLevel > 0) {
      ctx.fillStyle = "#fbbf24";
      ctx.font = "10px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`zoom: ${Math.pow(4, zoomLevel)}×`, PAD + 6, PAD + 6);
    }

  }, [orbitX, orbitY, width, height, view, zoomLevel]);

  // Click to zoom 4× on that point
  const handleClick = (e) => {
    if (!orbitX || orbitX.length < 2) return;
    const cnv = canvasRef.current;
    const rect = cnv.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (px < PAD || px > width - PAD || py < PAD || py > height - PAD) return;

    const plotW = width - 2 * PAD;
    const plotH = height - 2 * PAD;

    // Current view bounds
    let xMin, xMax, yMin, yMax;
    if (view) {
      ({ xMin, xMax, yMin, yMax } = view);
    } else {
      xMin = Math.min(...orbitX); xMax = Math.max(...orbitX);
      yMin = Math.min(...orbitY); yMax = Math.max(...orbitY);
      const xPad = (xMax - xMin) * 0.05 || 0.1;
      const yPad = (yMax - yMin) * 0.05 || 0.1;
      xMin -= xPad; xMax += xPad;
      yMin -= yPad; yMax += yPad;
    }

    const clickX = xMin + ((px - PAD) / plotW) * (xMax - xMin);
    const clickY = yMin + (1 - (py - PAD) / plotH) * (yMax - yMin);

    // Zoom 4× centered on click
    const newSpanX = (xMax - xMin) / 4;
    const newSpanY = (yMax - yMin) / 4;
    setView({
      xMin: clickX - newSpanX / 2,
      xMax: clickX + newSpanX / 2,
      yMin: clickY - newSpanY / 2,
      yMax: clickY + newSpanY / 2,
    });
    setZoomLevel((z) => z + 1);
  };

  const resetZoom = () => { setView(null); setZoomLevel(0); };

  if (!orbitX || !orbitY || orbitX.length < 2) {
    return (
      <div style={{ width, height }}
           className="flex items-center justify-center text-xs text-ink-dim bg-bg-base rounded-md border border-bg-line">
        No 2D orbit data
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-center">
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          className="cursor-crosshair rounded-md"
        />
      </div>
      <div className="flex items-center justify-center gap-3">
        <span className="caption-mono text-[11px]">
          Click to zoom 4× · {orbitX.length.toLocaleString()} samples
        </span>
        {zoomLevel > 0 && (
          <button
            onClick={resetZoom}
            className="text-xs text-cyan hover:text-cyan-glow transition-colors"
          >
            Reset zoom
          </button>
        )}
      </div>
    </div>
  );
}
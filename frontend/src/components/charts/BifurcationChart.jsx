import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";

/**
 * BifurcationChart — Canvas-based, streaming-friendly scatter renderer.
 *
 * Bifurcation diagrams routinely have 100,000–250,000 points; SVG and
 * Recharts both choke on that.  Canvas paints a million pixels in <50ms.
 *
 * Streaming integration:
 *   The parent passes a ref; we expose `appendChunk(chunk)` and `clear()`
 *   via useImperativeHandle.  The hook calls these directly without
 *   re-rendering React.
 *
 * Click handling:
 *   onClickPoint(r, x) is fired with the parameter and x value at the
 *   clicked pixel.  Used by the page to lock in a parameter.
 *
 * Markers:
 *   - aInfinity:  draws a glowing amber vertical line at a∞
 *   - lockedR:    draws a cyan crosshair at the user's clicked parameter
 *
 * Theming uses the project's palette to match the dark cockpit aesthetic.
 */

const COLOR_BG     = "#0a0e1a";
const COLOR_GRID   = "#2a3454";
const COLOR_AXIS   = "#94a3b8";
const COLOR_POINT  = "rgba(34, 211, 238, 0.55)";   // cyan @ alpha
const COLOR_AINF   = "rgba(251, 191, 36, 0.85)";   // amber
const COLOR_LOCK   = "rgba(34, 211, 238, 0.9)";    // cyan crosshair

const PAD_LEFT   = 50;
const PAD_RIGHT  = 18;
const PAD_TOP    = 18;
const PAD_BOTTOM = 28;

const BifurcationChart = forwardRef(function BifurcationChart(
  {
    pMin, pMax,
    yMin = 0, yMax = 1,
    height = 360,
    aInfinity = null,
    lockedR = null,
    onClickPoint,
    onHoverChange,
  },
  ref
) {
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: height });

  const rangeRef = useRef({ pMin, pMax, yMin, yMax });
  useEffect(() => {
    rangeRef.current = { pMin, pMax, yMin, yMax };
  }, [pMin, pMax, yMin, yMax]);

  const rFromPx = (px) => {
    const { pMin, pMax } = rangeRef.current;
    return pMin + ((px - PAD_LEFT) / (size.w - PAD_LEFT - PAD_RIGHT)) * (pMax - pMin);
  };
  const xFromPy = (py) => {
    const { yMin, yMax } = rangeRef.current;
    return yMin + (1 - (py - PAD_TOP) / (size.h - PAD_TOP - PAD_BOTTOM)) * (yMax - yMin);
  };

  // Track DPR-aware sizing.
  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv?.parentElement) return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.floor(r.width), h: height });
    });
    observer.observe(cnv.parentElement);
    return () => observer.disconnect();
  }, [height]);

  // Set up canvas backing store + draw axes whenever size changes.
  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv) return;
    const dpr = window.devicePixelRatio || 1;
    cnv.width = Math.max(1, size.w * dpr);
    cnv.height = Math.max(1, size.h * dpr);
    cnv.style.width = `${size.w}px`;
    cnv.style.height = `${size.h}px`;
    const ctx = cnv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground(ctx, size, rangeRef.current);
  }, [size]);

  useImperativeHandle(ref, () => ({
    /** Clear plot area and redraw axes. */
    clear: () => {
      const cnv = canvasRef.current;
      if (!cnv) return;
      const ctx = cnv.getContext("2d");
      drawBackground(ctx, size, rangeRef.current);
    },
    /** Append a chunk of (param[i], x[i]) points to the canvas. */
    appendChunk: (chunk) => {
      const cnv = canvasRef.current;
      if (!cnv) return;
      const ctx = cnv.getContext("2d");
      ctx.fillStyle = COLOR_POINT;
      const ps = chunk.param;
      const xs = chunk.x;
      const len = ps.length;
      const { pMin, pMax, yMin, yMax } = rangeRef.current;
      const w = size.w - PAD_LEFT - PAD_RIGHT;
      const h = size.h - PAD_TOP - PAD_BOTTOM;
      const dr = pMax - pMin;
      const dy = yMax - yMin;
      for (let i = 0; i < len; i++) {
        const r = ps[i], x = xs[i];
        if (r < pMin || r > pMax || x < yMin || x > yMax) continue;
        const px = PAD_LEFT + ((r - pMin) / dr) * w;
        const py = PAD_TOP + (1 - (x - yMin) / dy) * h;
        ctx.fillRect(px, py, 1, 1);
      }
      drawMarkers(ctx, size, rangeRef.current, aInfinity, lockedR);
    },
  }), [size, aInfinity, lockedR]);

  // Re-draw markers when their values change.
  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv) return;
    const ctx = cnv.getContext("2d");
    drawMarkers(ctx, size, rangeRef.current, aInfinity, lockedR);
  }, [aInfinity, lockedR, size]);

  const handleClick = (e) => {
    if (!onClickPoint) return;
    const cnv = canvasRef.current;
    const rect = cnv.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < PAD_LEFT || px > size.w - PAD_RIGHT) return;
    if (py < PAD_TOP || py > size.h - PAD_BOTTOM) return;
    onClickPoint(rFromPx(px), xFromPy(py));
  };

  const handleMove = (e) => {
    if (!onHoverChange) return;
    const cnv = canvasRef.current;
    const rect = cnv.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < PAD_LEFT || px > size.w - PAD_RIGHT) {
      onHoverChange(null);
      return;
    }
    onHoverChange(rFromPx(px));
  };
  const handleLeave = () => onHoverChange?.(null);

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        className="cursor-crosshair rounded-md"
        style={{ width: "100%", height: `${height}px`, display: "block" }}
      />
    </div>
  );
});

export default BifurcationChart;


// ---------- pure drawing helpers -----------------------------------------

function drawBackground(ctx, size, range) {
  const { pMin, pMax, yMin, yMax } = range;
  const w = size.w, h = size.h;

  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = COLOR_GRID;
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD_LEFT, PAD_TOP, w - PAD_LEFT - PAD_RIGHT, h - PAD_TOP - PAD_BOTTOM);

  ctx.font = "10px JetBrains Mono, monospace";
  ctx.fillStyle = COLOR_AXIS;

  // x-ticks
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  const xTickCount = 8;
  for (let i = 0; i <= xTickCount; i++) {
    const r = pMin + (i / xTickCount) * (pMax - pMin);
    const px = PAD_LEFT + (i / xTickCount) * (w - PAD_LEFT - PAD_RIGHT);
    ctx.strokeStyle = "rgba(42, 52, 84, 0.5)";
    ctx.beginPath();
    ctx.moveTo(px, PAD_TOP);
    ctx.lineTo(px, h - PAD_BOTTOM);
    ctx.stroke();
    ctx.fillText(r.toFixed(2), px, h - PAD_BOTTOM + 4);
  }

  // y-ticks
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const yTickCount = 5;
  for (let i = 0; i <= yTickCount; i++) {
    const x = yMin + (i / yTickCount) * (yMax - yMin);
    const py = PAD_TOP + (1 - i / yTickCount) * (h - PAD_TOP - PAD_BOTTOM);
    ctx.strokeStyle = "rgba(42, 52, 84, 0.5)";
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, py);
    ctx.lineTo(w - PAD_RIGHT, py);
    ctx.stroke();
    ctx.fillText(x.toFixed(2), PAD_LEFT - 4, py);
  }

  ctx.fillStyle = COLOR_AXIS;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("parameter", (PAD_LEFT + w - PAD_RIGHT) / 2, h - 6);
  ctx.save();
  ctx.translate(12, (PAD_TOP + h - PAD_BOTTOM) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("attractor x", 0, 0);
  ctx.restore();
}


function drawMarkers(ctx, size, range, aInfinity, lockedR) {
  const { pMin, pMax } = range;
  const w = size.w, h = size.h;
  const usableW = w - PAD_LEFT - PAD_RIGHT;

  if (aInfinity != null && aInfinity >= pMin && aInfinity <= pMax) {
    const px = PAD_LEFT + ((aInfinity - pMin) / (pMax - pMin)) * usableW;
    ctx.shadowColor = COLOR_AINF;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = COLOR_AINF;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, PAD_TOP);
    ctx.lineTo(px, h - PAD_BOTTOM);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = COLOR_AINF;
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`a∞ ≈ ${aInfinity.toFixed(4)}`, px, PAD_TOP - 4);
  }

  if (lockedR != null && lockedR >= pMin && lockedR <= pMax) {
    const px = PAD_LEFT + ((lockedR - pMin) / (pMax - pMin)) * usableW;
    ctx.strokeStyle = COLOR_LOCK;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px, PAD_TOP);
    ctx.lineTo(px, h - PAD_BOTTOM);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLOR_LOCK;
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`r = ${lockedR.toFixed(4)}`, px, h - PAD_BOTTOM + 16);
  }
}
import { useEffect, useRef } from "react";
import { PLATFORM_DATA, ENEMY_DATA } from "./AircraftAssets.jsx";

export default function MissionRadarMap({ state, height = 320, transmitting = false, animation = true }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(0);
  const tRef      = useRef(0);

  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv) return;
    const W = cnv.parentElement.clientWidth, H = height;
    const dpr = window.devicePixelRatio || 1;
    cnv.width = W * dpr; cnv.height = H * dpr;
    cnv.style.width = W + "px"; cnv.style.height = H + "px";
    const ctx = cnv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const platform = PLATFORM_DATA[state.allyPlatform] || PLATFORM_DATA.F22;
    const enemy = ENEMY_DATA[state.enemyThreat] || ENEMY_DATA.SIGINT;

    const baseX = 80, baseY = H - 70;
    const allyX = W * 0.7, allyY = 80;
    const enemyX = W - 80, enemyY = H * 0.55;

    function draw() {
      tRef.current += 1;
      const t = tRef.current;
      ctx.clearRect(0, 0, W, H);

      // Background gradient
      const grad = ctx.createRadialGradient(W/2, H, 0, W/2, H, W);
      grad.addColorStop(0, "#0a1426");
      grad.addColorStop(0.7, "#050a14");
      grad.addColorStop(1, "#020408");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Tactical grid
      ctx.strokeStyle = "rgba(34,211,238,0.04)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      // Compass marks
      ctx.fillStyle = "rgba(34,211,238,0.25)";
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.fillText("N", W/2 - 4, 14);
      ctx.fillText("S", W/2 - 4, H - 4);
      ctx.fillText("W", 6, H/2);
      ctx.fillText("E", W - 14, H/2);

      // Range circles around base
      ctx.strokeStyle = "rgba(34,211,238,0.08)";
      ctx.lineWidth = 0.5;
      [80, 160, 240, 320].forEach(r => {
        ctx.beginPath(); ctx.arc(baseX, baseY, r, 0, Math.PI * 2); ctx.stroke();
      });

      // Radar sweep from base
      if (animation) {
        const sweepAngle = (t * 0.012) % (Math.PI * 2);
        const sweepGrad = ctx.createRadialGradient(baseX, baseY, 0, baseX, baseY, 280);
        sweepGrad.addColorStop(0, "rgba(34,211,238,0.0)");
        sweepGrad.addColorStop(1, "rgba(34,211,238,0.0)");
        ctx.save();
        ctx.translate(baseX, baseY);
        ctx.rotate(sweepAngle);
        const sweepFan = ctx.createLinearGradient(0, 0, 280, 0);
        sweepFan.addColorStop(0, "rgba(34,211,238,0.18)");
        sweepFan.addColorStop(0.7, "rgba(34,211,238,0.05)");
        sweepFan.addColorStop(1, "rgba(34,211,238,0)");
        ctx.fillStyle = sweepFan;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 280, -0.06, 0.06);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Terrain
      ctx.fillStyle = "rgba(16,40,20,0.4)";
      ctx.beginPath();
      ctx.moveTo(0, H * 0.85);
      ctx.bezierCurveTo(W * 0.3, H * 0.7, W * 0.6, H * 0.95, W, H * 0.8);
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
      ctx.fill();

      // ─── BEAM (base → ally) ───
      if (transmitting && state.allyPlatform) {
        const dx = allyX - baseX, dy = allyY - baseY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Outer glow
        ctx.strokeStyle = platform.color + "20";
        ctx.lineWidth = 14;
        ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(allyX, allyY); ctx.stroke();
        // Inner line
        ctx.strokeStyle = platform.color + "70";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 4]);
        ctx.lineDashOffset = -t * 0.6;
        ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(allyX, allyY); ctx.stroke();
        ctx.setLineDash([]);

        // Travelling pulse
        const pulseT = (t * 0.015) % 1;
        const px = baseX + dx * pulseT, py = baseY + dy * pulseT;
        ctx.fillStyle = platform.color;
        ctx.shadowColor = platform.color; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ─── ENEMY DETECTION CONE ───
      if (animation && state.enemyThreat) {
        const ang = (t * 0.005) % (Math.PI * 2);
        ctx.save();
        ctx.translate(enemyX, enemyY);
        ctx.rotate(Math.PI + ang);
        const coneGrad = ctx.createLinearGradient(0, 0, 200, 0);
        coneGrad.addColorStop(0, "rgba(239,68,68,0.20)");
        coneGrad.addColorStop(1, "rgba(239,68,68,0)");
        ctx.fillStyle = coneGrad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 200, -Math.PI / 6, Math.PI / 6);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(239,68,68,0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(-Math.PI/6) * 200, Math.sin(-Math.PI/6) * 200);
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(Math.PI/6) * 200, Math.sin(Math.PI/6) * 200);
        ctx.stroke();
        ctx.restore();
      }

      // ─── BASE STATION ───
      ctx.save();
      ctx.translate(baseX, baseY);
      ctx.shadowColor = "#22d3ee"; ctx.shadowBlur = 14;
      ctx.fillStyle = "#22d3ee";
      // Tower
      ctx.fillRect(-3, -10, 6, 20);
      ctx.beginPath();
      ctx.moveTo(-10, 10); ctx.lineTo(10, 10); ctx.lineTo(8, 14); ctx.lineTo(-8, 14); ctx.closePath();
      ctx.fill();
      // Dish
      ctx.beginPath();
      ctx.arc(0, -16, 8, Math.PI, 2 * Math.PI);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(34,211,238,0.85)";
      ctx.font = "bold 9px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("BASE STATION", 0, 28);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.fillText("ALPHA-1", 0, 40);
      ctx.restore();

      // Charging halo when transmitting
      if (transmitting) {
        for (let r = 0; r < 3; r++) {
          const radius = ((t * 0.4 + r * 30) % 90);
          ctx.strokeStyle = `rgba(34,211,238,${0.5 * (1 - radius / 90)})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(baseX, baseY - 5, radius, 0, Math.PI * 2); ctx.stroke();
        }
      }

      // ─── ALLY AIRCRAFT ───
      if (state.allyPlatform) {
        ctx.save();
        ctx.translate(allyX + Math.sin(t * 0.02) * 3, allyY + Math.cos(t * 0.025) * 2);
        const ac = platform;
        ctx.shadowColor = ac.color; ctx.shadowBlur = 16;

        // Draw aircraft using simple SVG-like paths
        ctx.fillStyle = ac.color;
        ctx.strokeStyle = ac.color;
        ctx.lineWidth = 1;
        const s = 0.4; // scale
        if (state.allyPlatform === "F22") {
          ctx.beginPath();
          ctx.moveTo(0, -25*s);
          ctx.lineTo(2*s, 5*s);
          ctx.lineTo(28*s, 12*s);
          ctx.lineTo(28*s, 18*s);
          ctx.lineTo(15*s, 18*s);
          ctx.lineTo(12*s, 28*s);
          ctx.lineTo(15*s, 38*s);
          ctx.lineTo(8*s, 40*s);
          ctx.lineTo(0, 30*s);
          ctx.lineTo(-8*s, 40*s);
          ctx.lineTo(-15*s, 38*s);
          ctx.lineTo(-12*s, 28*s);
          ctx.lineTo(-15*s, 18*s);
          ctx.lineTo(-28*s, 18*s);
          ctx.lineTo(-28*s, 12*s);
          ctx.lineTo(-2*s, 5*s);
          ctx.closePath();
        } else if (state.allyPlatform === "F16") {
          ctx.beginPath();
          ctx.moveTo(0, -28*s);
          ctx.lineTo(3*s, 0);
          ctx.lineTo(32*s, 8*s);
          ctx.lineTo(32*s, 14*s);
          ctx.lineTo(8*s, 14*s);
          ctx.lineTo(12*s, 35*s);
          ctx.lineTo(0, 30*s);
          ctx.lineTo(-12*s, 35*s);
          ctx.lineTo(-8*s, 14*s);
          ctx.lineTo(-32*s, 14*s);
          ctx.lineTo(-32*s, 8*s);
          ctx.lineTo(-3*s, 0);
          ctx.closePath();
        } else if (state.allyPlatform === "C130") {
          ctx.beginPath();
          ctx.ellipse(0, 0, 5*s, 35*s, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-42*s, -5*s);
          ctx.lineTo(42*s, -5*s);
          ctx.lineTo(40*s, 0);
          ctx.lineTo(-40*s, 0);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-18*s, 30*s);
          ctx.lineTo(18*s, 30*s);
          ctx.lineTo(16*s, 33*s);
          ctx.lineTo(-16*s, 33*s);
          ctx.closePath();
        } else {
          // UAV
          ctx.beginPath();
          ctx.ellipse(0, 0, 3*s, 28*s, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-40*s, -3*s);
          ctx.lineTo(40*s, -3*s);
          ctx.lineTo(38*s, 0);
          ctx.lineTo(-38*s, 0);
          ctx.closePath();
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();

        // Label
        ctx.fillStyle = ac.color;
        ctx.font = "bold 9px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(`ALLY ${state.allyPlatform}`, allyX, allyY - 25);
      }

      // ─── ENEMY ───
      if (state.enemyThreat) {
        ctx.save();
        ctx.translate(enemyX, enemyY);
        ctx.shadowColor = "#ef4444"; ctx.shadowBlur = 12;
        ctx.fillStyle = "#ef4444";
        const s = 0.45;
        // Generic dish/icon
        ctx.beginPath();
        ctx.arc(0, -8*s, 12*s, Math.PI, 2 * Math.PI);
        ctx.lineTo(-12*s, 0);
        ctx.fill();
        ctx.fillRect(-3*s, 0, 6*s, 18*s);
        ctx.beginPath();
        ctx.moveTo(-10*s, 18*s);
        ctx.lineTo(10*s, 18*s);
        ctx.lineTo(8*s, 22*s);
        ctx.lineTo(-8*s, 22*s);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();

        ctx.fillStyle = "#ef4444";
        ctx.font = "bold 9px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText("ENEMY", enemyX, enemyY + 30);
        ctx.fillStyle = "rgba(239,68,68,0.6)";
        ctx.font = "8px 'JetBrains Mono', monospace";
        ctx.fillText(state.enemyThreat || "", enemyX, enemyY + 41);
      }

      // ─── HUD overlay (corners) ───
      ctx.strokeStyle = "rgba(34,211,238,0.5)";
      ctx.lineWidth = 1;
      [[8, 8, 20, 0, 0, 20], [W-8, 8, -20, 0, 0, 20], [8, H-8, 20, 0, 0, -20], [W-8, H-8, -20, 0, 0, -20]]
        .forEach(([x, y, dx1, dy1, dx2, dy2]) => {
          ctx.beginPath();
          ctx.moveTo(x + dx1, y + dy1); ctx.lineTo(x, y); ctx.lineTo(x + dx2, y + dy2);
          ctx.stroke();
        });

      // Corner text
      ctx.fillStyle = "rgba(34,211,238,0.4)";
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText(`SNR ${state.snrDb || 0} dB`, 18, 22);
      ctx.fillText(`DOPPLER ${(state.doppler || 0).toFixed(3)}`, 18, 36);
      ctx.textAlign = "right";
      ctx.fillText(`CHIPS/BIT ${state.chipsPerBit || 0}`, W - 18, 22);
      ctx.fillText(`MOD ${state.modulation || "—"}`, W - 18, 36);

      if (animation) rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [state, height, transmitting, animation]);

  return (
    <div className="rounded-xl border border-cyan-400/15 overflow-hidden"
      style={{ background: "#040912", boxShadow: "0 0 30px rgba(34,211,238,0.05) inset" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height, display: "block" }} />
    </div>
  );
}
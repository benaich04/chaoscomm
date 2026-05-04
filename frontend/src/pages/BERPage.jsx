import { useEffect, useState } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  ScatterChart,
  Scatter,
} from "recharts";

import EquationDisplay from "../components/math/EquationDisplay.jsx";
import LearnerCard from "../components/math/LearnerCard.jsx";

const API = "https://chaoscomm.onrender.com";

const CURVE_STYLES = {
  bpsk: { color: "#10b981", label: "BPSK", dash: "0" },
  csk_antipodal: { color: "#22d3ee", label: "CSK (ρ=−1)", dash: "6 3" },
  csk_orthogonal: { color: "#60a5fa", label: "CSK (ρ=0)", dash: "3 3" },
  csk_rho: { color: "#fbbf24", label: "CSK (ρ=custom)", dash: "0" },
  dcsk: { color: "#a78bfa", label: "DCSK", dash: "0" },
  mc_theory: { color: "#f97316", label: "MC theory", dash: "4 2" },
  mc_sim: { color: "#ef4444", label: "MC simulated", dash: "0" },
};

export default function BERPage() {
  const [rho, setRho] = useState(0.0);
  const [beta, setBeta] = useState(40);
  const [mcScheme, setMcScheme] = useState("dcsk");
  const [mcBits, setMcBits] = useState(1000);

  const [curves, setCurves] = useState(null);
  const [mcData, setMcData] = useState(null);
  const [explainers, setExplainers] = useState(null);
  const [busyCurves, setBusyCurves] = useState(false);
  const [busyMC, setBusyMC] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/ber/explainers`)
      .then((r) => r.json())
      .then(setExplainers)
      .catch(() => {});
  }, []);

  const dRho = useDebouncedValue(rho, 200);
  const dBeta = useDebouncedValue(beta, 200);

  useEffect(() => {
    setBusyCurves(true);

    fetch(`${API}/api/ber/curves`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ebn0_db_min: -5,
        ebn0_db_max: 20,
        n_points: 60,
        rho: dRho,
        beta: dBeta,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        setCurves(d);
        setBusyCurves(false);
      })
      .catch(() => setBusyCurves(false));
  }, [dRho, dBeta]);

  function runMonteCarlo() {
    setBusyMC(true);

    fetch(`${API}/api/ber/monte-carlo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ebn0_db_min: 0,
        ebn0_db_max: 15,
        n_points: 12,
        scheme: mcScheme,
        beta,
        rho,
        n_bits: mcBits,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        console.log("Monte Carlo response:", d);
        setMcData(d);
        setBusyMC(false);
      })
      .catch(() => setBusyMC(false));
  }

  const chartData = curves
    ? curves.ebn0_db.map((e, i) => ({
        ebn0: e,
        bpsk: curves.bpsk[i],
        csk_antipodal: curves.csk_antipodal[i],
        csk_orthogonal: curves.csk_orthogonal[i],
        csk_rho: curves.csk_rho[i],
        dcsk: curves.dcsk[i],
      }))
    : [];

  const mcMap = {};
  if (mcData?.ebn0_db) {
    mcData.ebn0_db.forEach((e, i) => {
      mcMap[e.toFixed(2)] = {
        mc_theory: mcData.ber_theoretical[i],
        mc_sim: mcData.ber_simulated[i],
      };
    });
  }

  const fullData = chartData.map((row) => ({
    ...row,
    ...(mcMap[row.ebn0.toFixed(2)] || {}),
  }));

const scatterData = (mcData?.z_values || []).map((z, i) => ({
  index: i,
  z,
  correct: mcData.detected_bits[i] === mcData.true_bits[i],
}));

  const pgDb = (10 * Math.log10(Math.max(beta, 1))).toFixed(1);

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">
      {/* HERO */}
      <section className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">
          MODULE · BER ANALYSIS
        </div>

        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          Bit Error Rate — the Q-function in action
        </h1>

        <p className="text-ink-muted text-sm mb-4">
          Every BER formula is a tail probability of a Gaussian — the Q-function.
          Tune ρ and β to see how the curves shift.
        </p>

        <div className="flex flex-wrap gap-3">
          <div className="px-4 py-3 rounded-md bg-bg-base/60 border border-bg-line">
            <EquationDisplay
              tex={"Q(x) = \\frac{1}{2}\\,\\text{erfc}\\!\\left(\\frac{x}{\\sqrt{2}}\\right)"}
              block
            />
          </div>

          <div className="px-4 py-3 rounded-md bg-bg-base/60 border border-bg-line">
            <EquationDisplay
              tex={"P_e^{\\text{BPSK}} = Q\\!\\left(\\sqrt{2E_b/N_0}\\right)"}
              block
            />
          </div>

          <div className="px-4 py-3 rounded-md bg-bg-base/60 border border-bg-line">
            <EquationDisplay
              tex={"P_e^{\\text{CSK}} = Q\\!\\left(\\sqrt{\\frac{1-\\rho}{2}\\cdot\\beta\\cdot\\frac{E_b}{N_0}}\\right)"}
              block
            />
          </div>
        </div>
      </section>

      {/* LEARNER CARDS */}
      {explainers && (
        <section className="space-y-3">
          <LearnerCard title="The Q-function — why it appears in every BER formula">
            <p>{explainers.q_function}</p>
          </LearnerCard>

          <LearnerCard title="CSK BER and the ρ parameter" defaultOpen={false} icon="ρ">
            <p>{explainers.csk_ber}</p>
          </LearnerCard>

          <LearnerCard title="DCSK — the 3 dB synchronization penalty" defaultOpen={false} icon="⇄">
            <p>{explainers.dcsk_ber}</p>
          </LearnerCard>
        </section>
      )}

      {/* CONTROLS */}
      <section className="panel p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-ink-dim">
                Cross-correlation ρ (CSK)
              </span>
              <span className="font-mono text-sm text-amber">
                {rho.toFixed(2)}
              </span>
            </div>

            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={rho}
              onChange={(e) => setRho(parseFloat(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber"
            />

            <div className="mt-1 text-[10px] text-ink-dim flex justify-between">
              <span>ρ=−1</span>
              <span>ρ=0</span>
              <span>ρ=+1</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-ink-dim">
                Chips per bit β
              </span>
              <span className="font-mono text-sm text-amber">
                {beta} ({pgDb} dB gain)
              </span>
            </div>

            <input
              type="range"
              min={1}
              max={256}
              step={1}
              value={beta}
              onChange={(e) => setBeta(parseInt(e.target.value, 10))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan"
            />
          </div>

          <div className="rounded-md border border-bg-line bg-bg-base/40 p-3">
            <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-2">
              Active CSK formula
            </div>

            <div className="text-xs font-mono text-cyan break-all">
              P_e = Q(√( (1-{rho.toFixed(2)})/2 · {beta} · Eb/N0 ))
            </div>

            <div className="text-[10px] text-ink-dim mt-1">
              = Q(√( {((1 - rho) / 2 * beta).toFixed(2)} · Eb/N0 ))
            </div>

            {busyCurves && (
              <div className="caption-mono text-cyan animate-pulse-soft mt-1">
                updating…
              </div>
            )}
          </div>
        </div>
      </section>

      {/* BER CURVES */}
      <section className="panel p-5">
        <div className="mb-3">
          <div className="text-sm font-semibold text-ink">
            Theoretical BER curves
          </div>
          <div className="caption-mono">
            log scale — each decade = 10× improvement · β = {beta} chips/bit
          </div>
        </div>

        {fullData.length > 0 ? (
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={fullData} margin={{ top: 5, right: 20, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />

              <XAxis
                dataKey="ebn0"
                type="number"
                stroke="#94a3b8"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                label={{
                  value: "Eb/N0 (dB)",
                  position: "insideBottom",
                  offset: -10,
                  fill: "#94a3b8",
                  fontSize: 11,
                }}
              />

              <YAxis
                scale="log"
                domain={[1e-8, 1]}
                stroke="#94a3b8"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickFormatter={(v) => v.toExponential(0)}
                label={{
                  value: "BER",
                  angle: -90,
                  position: "insideLeft",
                  fill: "#94a3b8",
                  fontSize: 11,
                }}
              />

              <Tooltip
                contentStyle={{
                  backgroundColor: "#141b2d",
                  border: "1px solid #2a3454",
                  borderRadius: "6px",
                  fontSize: "11px",
                }}
                labelFormatter={(v) => `Eb/N0 = ${Number(v).toFixed(1)} dB`}
                formatter={(v, name) => {
                  const style = CURVE_STYLES[name];
                  return [Number(v).toExponential(2), style?.label || name];
                }}
              />

              <Legend
                wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                formatter={(name) => CURVE_STYLES[name]?.label || name}
              />

              <ReferenceLine y={0.5} stroke="#64748b" strokeDasharray="2 4" strokeWidth={0.5} />

              {Object.entries(CURVE_STYLES).map(([key, style]) =>
                key in (fullData[0] || {}) ? (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={style.color}
                    strokeWidth={key === "csk_rho" ? 2.5 : 1.5}
                    strokeDasharray={style.dash}
                    dot={key.startsWith("mc_") ? { r: 3, fill: style.color } : false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ) : null
              )}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-80 flex items-center justify-center text-xs text-ink-dim">
            Loading…
          </div>
        )}
      </section>

      {/* FORMULA TABLE */}
      {curves && (
        <section className="panel p-5">
          <div className="section-title mb-3">
            Formula reference (β = {beta}, ρ = {rho.toFixed(2)})
          </div>

          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-ink-dim border-b border-bg-line">
                <th className="text-left py-1.5">Scheme</th>
                <th className="text-left py-1.5">Formula</th>
                <th className="text-right py-1.5">BER @ 10 dB</th>
              </tr>
            </thead>

            <tbody>
              {[
                { key: "bpsk", label: "BPSK", formula: "Q(√(2·Eb/N0))" },
                { key: "csk_antipodal", label: "CSK (ρ=−1)", formula: `Q(√(${beta}·Eb/N0))` },
                { key: "csk_orthogonal", label: "CSK (ρ=0)", formula: `Q(√(${beta}/2·Eb/N0))` },
                {
                  key: "csk_rho",
                  label: `CSK (ρ=${rho.toFixed(2)})`,
                  formula: `Q(√(${((1 - rho) / 2 * beta).toFixed(2)}·Eb/N0))`,
                },
                { key: "dcsk", label: "DCSK", formula: `Q(√(${beta}/2·Eb/N0))` },
              ].map((row) => {
                const idx10 = curves.ebn0_db.findIndex((e) => e >= 10.0);
                const ber10 = curves[row.key]?.[idx10];

                return (
                  <tr key={row.key} className="border-b border-bg-line/30">
                    <td className="py-1.5" style={{ color: CURVE_STYLES[row.key]?.color }}>
                      {row.label}
                    </td>
                    <td className="py-1.5 text-ink-muted">{row.formula}</td>
                    <td className="py-1.5 text-right text-ink">
                      {ber10 ? ber10.toExponential(2) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* MONTE CARLO */}
      <section className="panel p-5">
        <div className="mb-4">
          <div className="text-sm font-semibold text-ink">
            Monte Carlo simulation
          </div>
          <div className="caption-mono">
            verify theory against simulated noise — dots should land on the curves
          </div>
        </div>

        <div className="flex flex-wrap gap-4 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">
              Scheme
            </div>

            <div className="flex gap-1">
              {["dcsk", "csk"].map((s) => (
                <button
                  key={s}
                  onClick={() => setMcScheme(s)}
                  className={`px-3 py-1.5 rounded text-xs ${
                    mcScheme === s
                      ? "bg-amber/15 text-amber border border-amber/40"
                      : "bg-bg-base border border-bg-line text-ink-muted hover:text-ink"
                  }`}
                >
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">
              Bits per point
            </div>

            <div className="flex gap-1">
              {[500, 1000, 2000].map((n) => (
                <button
                  key={n}
                  onClick={() => setMcBits(n)}
                  className={`px-3 py-1.5 rounded text-xs font-mono ${
                    mcBits === n
                      ? "bg-cyan/15 text-cyan border border-cyan/40"
                      : "bg-bg-base border border-bg-line text-ink-muted hover:text-ink"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-end">
            <button
              onClick={runMonteCarlo}
              disabled={busyMC}
              className="px-5 py-2 rounded-md text-sm font-medium bg-amber/20 text-amber border border-amber/40 hover:bg-amber/30 disabled:opacity-50"
            >
              {busyMC ? "simulating…" : "▶ Run Monte Carlo"}
            </button>
          </div>
        </div>

        {mcData && (
          <div className="caption-mono mt-1">
            {mcData.scheme.toUpperCase()} · β={mcData.beta} · simulated BER points added to curve
          </div>
        )}
      </section>

      {/* MONTE CARLO DECISION VISUAL */}
      {mcData && scatterData.length > 0 && (
        <section className="panel p-5">
          <div className="text-sm font-semibold text-ink mb-1">
            Decision variable visualization
          </div>

          <div className="caption-mono mb-3">
            Each point is one transmitted bit. Above 0 → detected as 1 · below 0 → detected as 0 · red = error.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className="rounded-md border border-bg-line bg-bg-base/50 p-3">
              <div className="text-[10px] uppercase tracking-widest text-ink-dim">
                Errors
              </div>
              <div className="text-xl font-mono text-crimson">
                {mcData.n_errors} / {mcData.n_bits}
              </div>
            </div>

            <div className="rounded-md border border-bg-line bg-bg-base/50 p-3">
              <div className="text-[10px] uppercase tracking-widest text-ink-dim">
                Simulated BER
              </div>
              <div className="text-xl font-mono text-amber">
                {Array.isArray(mcData.ber_simulated)
                  ? mcData.ber_simulated[0]?.toExponential(2)
                  : mcData.ber_simulated?.toExponential?.(2) || "—"}
              </div>
            </div>

            <div className="rounded-md border border-bg-line bg-bg-base/50 p-3">
              <div className="text-[10px] uppercase tracking-widest text-ink-dim">
                Threshold
              </div>
              <div className="text-xl font-mono text-cyan">z = 0</div>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />

              <XAxis
                dataKey="index"
                type="number"
                name="Bit index"
                stroke="#94a3b8"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                label={{
                  value: "bit index",
                  position: "insideBottom",
                  offset: -10,
                  fill: "#94a3b8",
                  fontSize: 11,
                }}
              />

              <YAxis
                dataKey="z"
                name="Decision value"
                stroke="#94a3b8"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                label={{
                  value: "decision variable z",
                  angle: -90,
                  position: "insideLeft",
                  fill: "#94a3b8",
                  fontSize: 11,
                }}
              />

              <Tooltip
                contentStyle={{
                  backgroundColor: "#141b2d",
                  border: "1px solid #2a3454",
                  borderRadius: "6px",
                  fontSize: "11px",
                }}
                formatter={(v, name) => [Number(v).toFixed(4), name]}
                labelFormatter={(v) => `bit ${v}`}
              />

              <Legend wrapperStyle={{ fontSize: "11px" }} />

              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />

              <Scatter
                name="Correct decisions"
                data={scatterData.filter((p) => p.correct)}
                fill="#10b981"
              />

              <Scatter
                name="Errors"
                data={scatterData.filter((p) => !p.correct)}
                fill="#ef4444"
              />
            </ScatterChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* CONCEPT CARDS */}
      {explainers && (
        <section className="space-y-3">
          <div className="section-title px-1">Deep dive</div>

          <LearnerCard title="Processing gain and the BER shift" defaultOpen={false} icon="📊">
            <p>{explainers.processing_gain_ber}</p>
          </LearnerCard>

          <LearnerCard title="Monte Carlo simulation — verifying theory" defaultOpen={false} icon="🎲">
            <p>{explainers.monte_carlo}</p>
          </LearnerCard>

          <LearnerCard title="BPSK — the antipodal reference" defaultOpen={false} icon="±">
            <p>{explainers.bpsk_ber}</p>
          </LearnerCard>
        </section>
      )}
    </div>
  );
}
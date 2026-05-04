import { useEffect, useState } from "react";
import { useStore } from "../store/useStore.js";
import { postMapsOrbit } from "../api/client.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

import EquationDisplay from "../components/math/EquationDisplay.jsx";
import LearnerCard     from "../components/math/LearnerCard.jsx";
import OrbitChart      from "../components/charts/OrbitChart.jsx";

/**
 * MatchedFilterPage — Three implementations, one optimal detector.
 *
 * Layout:
 *   1. Hero with the Cauchy-Schwarz SNR bound
 *   2. Learner cards
 *   3. Controls: generate a chaotic template, add noise, pick SNR
 *   4. Three-tab view: Convolution / Correlator / FFT outputs side by side
 *   5. ROC curve (theoretical)
 *   6. Processing gain calculator
 *   7. Concept cards
 */

const API = "https://chaoscomm.onrender.com";

export default function MatchedFilterPage() {
  const { mapsRegistry, mapsRegistryLoading, loadMapsRegistry, mapsRegistryError } = useStore();

  const [nChips, setNChips]     = useState(64);
  const [snrDb, setSnrDb]       = useState(10);
  const [mfData, setMfData]     = useState(null);
  const [rocData, setRocData]   = useState(null);
  const [pgData, setPgData]     = useState(null);
  const [explainers, setExplainers] = useState(null);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const [activeTab, setActiveTab] = useState("convolution");

  useEffect(() => { loadMapsRegistry(); }, [loadMapsRegistry]);

  useEffect(() => {
    fetch(`${API}/api/matched-filter/explainers`)
      .then(r => r.json()).then(setExplainers).catch(() => {});
  }, []);

  const dNChips = useDebouncedValue(nChips, 300);
  const dSnrDb  = useDebouncedValue(snrDb, 300);

  // Generate template + noisy received → compare all 3 implementations + ROC + PG
  useEffect(() => {
    setBusy(true); setError(null);

    // Generate chaotic template via orbit
    postMapsOrbit({
      map: "logistic", parameters: { r: 3.9 },
      initial_state: [0.31415], n_samples: dNChips + 200,
    })
      .then(orbitData => {
        const template = orbitData.orbit.slice(200, 200 + dNChips);
        const energy = template.reduce((s, v) => s + v * v, 0);

        // Add AWGN noise at the specified SNR
        const snrLinear = Math.pow(10, dSnrDb / 10);
        const noiseVar = energy / (snrLinear * dNChips);
        const noiseStd = Math.sqrt(noiseVar);

        // Simple Box-Muller noise (deterministic seed via index)
        const received = template.map((v, i) => {
          const u1 = ((i * 7919 + 1) % 10007) / 10007;
          const u2 = ((i * 104729 + 3) % 10007) / 10007;
          const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
          return v + noiseStd * z;
        });

        // Compare all 3 implementations
        const compareP = fetch(`${API}/api/matched-filter/compare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ received, template }),
        }).then(r => r.json());

        // ROC curve
        const rocP = fetch(`${API}/api/matched-filter/roc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signal_energy: energy, noise_variance: noiseVar || 0.001 }),
        }).then(r => r.json());

        // Processing gain
        const pgP = fetch(`${API}/api/matched-filter/processing-gain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ n_chips: dNChips }),
        }).then(r => r.json());

        return Promise.all([compareP, rocP, pgP]);
      })
      .then(([cmp, roc, pg]) => {
        setMfData(cmp);
        setRocData(roc);
        setPgData(pg);
        setBusy(false);
      })
      .catch(e => { setError(e.message); setBusy(false); });
  }, [dNChips, dSnrDb]);

  if (mapsRegistryError) {
    return (
      <div className="px-8 py-8 max-w-6xl mx-auto">
        <div className="panel p-6 border-l-4 border-crimson/60">
          <div className="text-crimson font-semibold">Backend connection failed</div>
        </div>
      </div>
    );
  }

  const TABS = [
    { id: "convolution", label: "Convolution h[k]=s[N-k]", complexity: mfData?.convolution?.complexity },
    { id: "correlator",  label: "Correlator z=Σr·s",       complexity: mfData?.correlator?.complexity },
    { id: "fft",         label: "FFT Y=R·S*",              complexity: mfData?.fft?.complexity },
  ];

  const activeResult = mfData?.[activeTab];
  const output = activeTab === "correlator"
    ? activeResult?.sliding_correlation
    : activeResult?.output;

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">

      {/* ============== HERO ============== */}
      <section className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">
          MODULE · MATCHED FILTER DESIGN
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          Matched filter — three implementations, one optimal detector
        </h1>
        <p className="text-ink-muted text-sm mb-4">
          The filter that maximizes output SNR. Three ways to compute it — all give the same answer.
        </p>
        <div className="flex gap-4 flex-wrap">
          <div className="px-4 py-3 rounded-md bg-bg-base/60 border border-bg-line">
            <EquationDisplay tex={"h(t) = s^*(T - t)"} block />
          </div>
          <div className="px-4 py-3 rounded-md bg-bg-base/60 border border-bg-line">
            <EquationDisplay tex={"\\text{SNR}_{\\max} = \\frac{2E_s}{N_0}"} block />
          </div>
        </div>
      </section>

      {/* ============== LEARNER CARDS ============== */}
      {explainers && (
        <section className="space-y-4">
          <LearnerCard title="What is the matched filter and why is it optimal?">
            <p>{explainers.matched_filter_theory}</p>
          </LearnerCard>
          <LearnerCard title="Why does this matter for CSK?" defaultOpen={false} icon="⇄">
            <p>{explainers.why_mf_for_csk}</p>
          </LearnerCard>
        </section>
      )}

      {/* ============== CONTROLS ============== */}
      <section className="panel p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-ink-dim">Template length N</span>
              <span className="font-mono text-sm text-amber">{nChips}</span>
            </div>
            <input
              type="range" min={16} max={256} step={16}
              value={nChips}
              onChange={e => setNChips(parseInt(e.target.value, 10))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-ink-dim">Input SNR (dB)</span>
              <span className="font-mono text-sm text-amber">{snrDb}</span>
            </div>
            <input
              type="range" min={-10} max={30} step={1}
              value={snrDb}
              onChange={e => setSnrDb(parseInt(e.target.value, 10))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan"
            />
          </div>
          <div className="flex flex-col justify-center text-sm">
            {pgData && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-ink-dim">Processing gain</div>
                <div className="font-mono text-lg text-amber">{pgData.processing_gain_db.toFixed(1)} dB</div>
                <div className="caption-mono">= 10·log₁₀({nChips})</div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3 text-xs">
          {busy && <span className="caption-mono text-cyan animate-pulse-soft">computing…</span>}
          {error && <span className="caption-mono text-crimson">{error}</span>}
          {mfData && (
            <span className="caption-mono">
              Peaks match across all 3: {mfData.peaks_match ? "✓ yes" : "✗ no"} ·
              Peak = {activeResult?.peak_value?.toFixed(2)}
            </span>
          )}
        </div>
      </section>

      {/* ============== THREE-TAB OUTPUT ============== */}
      <section className="panel p-5">
        <div className="flex gap-1 mb-4">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                "px-4 py-2 rounded-t text-xs font-medium transition-colors",
                tab.id === activeTab
                  ? "bg-bg-raised text-amber border border-bg-line border-b-0"
                  : "bg-transparent text-ink-muted hover:text-ink",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="bg-bg-raised rounded-b rounded-tr p-4 border border-bg-line">
          {activeResult && (
            <>
              <div className="flex items-baseline justify-between mb-2">
                <div>
                  <div className="text-sm font-semibold text-ink">
                    {activeTab === "convolution" && "Convolution output y[n]"}
                    {activeTab === "correlator" && "Sliding correlation"}
                    {activeTab === "fft" && "FFT-based output y[n]"}
                  </div>
                  <div className="caption-mono">
                    {TABS.find(t => t.id === activeTab)?.complexity}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-ink-dim">Peak</div>
                  <div className="font-mono text-lg text-amber">
                    {activeResult.peak_value?.toFixed(3)}
                  </div>
                  <div className="caption-mono">at index {activeResult.peak_index}</div>
                </div>
              </div>

              {output && (
                <OrbitChart
                  orbit={output.slice(0, 500)}
                  domain={[
                    Math.min(...output.slice(0, 500)) * 1.1,
                    Math.max(...output.slice(0, 500)) * 1.1,
                  ]}
                  showFirst={500}
                />
              )}

              {/* Method-specific details */}
              {activeTab === "convolution" && activeResult.filter_taps && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">
                    Filter taps h[k] = s[N-1-k] (first 50)
                  </div>
                  <div className="font-mono text-[10px] text-ink-muted break-all">
                    [{activeResult.filter_taps.slice(0, 50).map(v => v.toFixed(3)).join(", ")}...]
                  </div>
                </div>
              )}

              {activeTab === "correlator" && (
                <div className="mt-3 rounded-md border-l-4 border-cyan/50 bg-cyan/[0.04] p-3 text-sm">
                  Decision statistic z = {activeResult.decision_statistic?.toFixed(4)} ·
                  Template energy Eₛ = {activeResult.template_energy?.toFixed(4)}
                </div>
              )}

              {activeTab === "fft" && activeResult.frequency_response_mag && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1">
                    Matched filter frequency response |H(f)| = |S*(f)|
                  </div>
                  <OrbitChart
                    orbit={activeResult.frequency_response_mag.slice(0, 200)}
                    domain={[0, Math.max(...activeResult.frequency_response_mag) * 1.1]}
                    showFirst={200}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* ============== ROC CURVE ============== */}
      {rocData && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="panel p-5">
            <div className="mb-3">
              <div className="text-sm font-semibold text-ink">ROC curve (theoretical)</div>
              <div className="caption-mono">
                P_d vs P_fa at SNR = {rocData.snr_db?.toFixed(1)} dB · AUC = {rocData.auc?.toFixed(4)}
              </div>
            </div>
            <ROCChart pfa={rocData.pfa} pd={rocData.pd} />
          </div>

          <div className="panel p-5">
            <div className="section-title mb-3">Performance summary</div>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Template length N" value={nChips} />
              <Stat label="Input SNR" value={`${snrDb} dB`} />
              <Stat label="Processing gain" value={`${pgData?.processing_gain_db?.toFixed(1)} dB`} />
              <Stat label="Output SNR" value={`${(snrDb + (pgData?.processing_gain_db || 0)).toFixed(1)} dB`} />
              <Stat label="ROC AUC" value={rocData.auc?.toFixed(4)} />
              <Stat label="Peaks match (3 methods)" value={mfData?.peaks_match ? "✓" : "✗"} />
            </div>
          </div>
        </section>
      )}

      {/* ============== CONCEPT CARDS ============== */}
      {explainers && (
        <section className="space-y-3">
          <div className="section-title px-1">Deep dive — three implementations</div>
          <LearnerCard title="Convolution filter h[k] = s[N-k]" defaultOpen={false} icon="▬">
            <p>{explainers.convolution_implementation}</p>
          </LearnerCard>
          <LearnerCard title="Correlator z = Σ r[k]·s[k]" defaultOpen={false} icon="⊗">
            <p>{explainers.correlator_implementation}</p>
          </LearnerCard>
          <LearnerCard title="FFT-based Y(f) = R(f)·S*(f)" defaultOpen={false} icon="🔄">
            <p>{explainers.fft_implementation}</p>
          </LearnerCard>
          <LearnerCard title="Processing gain — why spreading works" defaultOpen={false} icon="📊">
            <p>{explainers.processing_gain}</p>
          </LearnerCard>
          <LearnerCard title="ROC curves — measuring detector quality" defaultOpen={false} icon="📈">
            <p>{explainers.roc_curves}</p>
          </LearnerCard>
        </section>
      )}
    </div>
  );
}


/* ============== ROC Chart (simple inline Recharts) ============== */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

function ROCChart({ pfa, pd }) {
  if (!pfa || !pd) return null;

  // Downsample for display
  const step = Math.max(1, Math.floor(pfa.length / 100));
  const data = [];
  for (let i = 0; i < pfa.length; i += step) {
    data.push({ pfa: pfa[i], pd: pd[i] });
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a3454" />
        <XAxis
          dataKey="pfa" type="number" scale="log"
          domain={[1e-6, 1]}
          stroke="#94a3b8"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          tickFormatter={v => v.toExponential(0)}
          label={{ value: "P_fa", position: "insideBottomRight", offset: -2, fill: "#94a3b8", fontSize: 10 }}
        />
        <YAxis
          domain={[0, 1]}
          stroke="#94a3b8"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          label={{ value: "P_d", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#141b2d", border: "1px solid #2a3454", borderRadius: "6px", fontSize: "12px" }}
          labelFormatter={v => `P_fa = ${Number(v).toExponential(2)}`}
          formatter={v => [Number(v).toFixed(4), "P_d"]}
        />
        {/* Coin-flip diagonal */}
        <ReferenceLine
          segment={[{ x: 1e-6, y: 1e-6 }, { x: 1, y: 1 }]}
          stroke="#64748b" strokeDasharray="4 4" strokeWidth={0.8}
        />
        <Line
          type="monotone" dataKey="pd"
          stroke="#22d3ee" strokeWidth={2}
          dot={false} isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}


function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-ink-dim">{label}</div>
      <div className="font-mono text-sm text-ink">{value ?? "—"}</div>
    </div>
  );
}
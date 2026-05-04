import { useEffect, useState } from "react";
import { useStore } from "../store/useStore.js";
import { postMapsOrbit } from "../api/client.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

import MapSelector       from "../components/controls/MapSelector.jsx";
import ParameterSlider   from "../components/controls/ParameterSlider.jsx";
import EquationDisplay   from "../components/math/EquationDisplay.jsx";
import LearnerCard       from "../components/math/LearnerCard.jsx";
import WaveformChart     from "../components/charts/WaveformChart.jsx";
import OrbitChart        from "../components/charts/OrbitChart.jsx";

/**
 * SignalPage — Waveform Construction from quantized chaotic samples.
 *
 * Layout:
 *   1. Hero with the construction equation
 *   2. Learner cards
 *   3. Controls: map, parameter, pulse shape, samples per chip, roll-off α
 *   4. Raw chips (discrete dots) → constructed waveform (continuous)
 *   5. Pulse shape comparison (NRZ vs RC vs RRC side by side)
 *   6. PSD overlay for all three pulse shapes
 *   7. Bandwidth & energy metrics
 *   8. Concept cards
 */

const API = "http://localhost:8000";

const PULSE_SHAPES = [
  { id: "nrz",            label: "NRZ (rectangular)",     hasAlpha: false },
  { id: "raised_cosine",  label: "Raised Cosine",         hasAlpha: true },
  { id: "rrc",            label: "Root-Raised Cosine",    hasAlpha: true },
];

function defaultParamsFor(meta) {
  if (!meta?.parameters) return {};
  return Object.fromEntries(meta.parameters.map(p => [p.name, p.default]));
}

export default function SignalPage() {
  const { mapsRegistry, mapsRegistryLoading, loadMapsRegistry, mapsRegistryError } = useStore();

  const [mapId, setMapId]         = useState("logistic");
  const [params, setParams]       = useState({ r: 3.9 });
  const [pulseShape, setPulseShape] = useState("nrz");
  const [spc, setSpc]             = useState(8);
  const [alpha, setAlpha]         = useState(0.5);

  const [orbit, setOrbit]               = useState(null);
  const [wavData, setWavData]           = useState(null);
  const [compareData, setCompareData]   = useState(null);
  const [explainers, setExplainers]     = useState(null);
  const [busy, setBusy]                 = useState(false);
  const [error, setError]               = useState(null);

  useEffect(() => { loadMapsRegistry(); }, [loadMapsRegistry]);

  useEffect(() => {
    fetch(`${API}/api/waveform/explainers`)
      .then(r => r.json()).then(setExplainers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!mapsRegistry) return;
    const meta = mapsRegistry.maps[mapId];
    if (!meta) return;
    setParams(defaultParamsFor(meta));
    setOrbit(null); setWavData(null); setCompareData(null);
  }, [mapId, mapsRegistry]);

  const dParams = useDebouncedValue(params, 250);
  const dSpc    = useDebouncedValue(spc, 250);
  const dAlpha  = useDebouncedValue(alpha, 250);

  // Pipeline: orbit → waveform + comparison
  useEffect(() => {
    if (!mapsRegistry) return;
    const meta = mapsRegistry.maps[mapId];
    if (!meta || meta.dimension !== 1) return;

    setBusy(true); setError(null);

    postMapsOrbit({
      map: mapId,
      parameters: dParams,
      initial_state: [meta.default_x0 ?? 0.31415],
      n_samples: 200,
    })
      .then(orbitData => {
        setOrbit(orbitData);
        const chips = orbitData.orbit.slice(0, 100);

        return Promise.all([
          fetch(`${API}/api/waveform/construct`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chips, pulse_shape: pulseShape,
              samples_per_chip: dSpc, alpha: dAlpha,
            }),
          }).then(r => r.json()),
          fetch(`${API}/api/waveform/compare`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chips: chips.slice(0, 50),
              samples_per_chip: dSpc, alpha: dAlpha,
            }),
          }).then(r => r.json()),
        ]);
      })
      .then(([wav, cmp]) => {
        setWavData(wav);
        setCompareData(cmp);
        setBusy(false);
      })
      .catch(e => { setError(e.message); setBusy(false); });
  }, [mapId, dParams, pulseShape, dSpc, dAlpha, mapsRegistry]);

  // Gates
  if (mapsRegistryError) {
    return (
      <div className="px-8 py-8 max-w-6xl mx-auto">
        <div className="panel p-6 border-l-4 border-crimson/60">
          <div className="text-crimson font-semibold">Backend connection failed</div>
        </div>
      </div>
    );
  }
  if (mapsRegistryLoading || !mapsRegistry) {
    return (
      <div className="px-8 py-8 max-w-6xl mx-auto">
        <div className="text-sm text-ink-muted animate-pulse-soft">Loading…</div>
      </div>
    );
  }

  const meta = mapsRegistry.maps[mapId];
  const domain = meta?.domain ?? [0, 1];

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">

      {/* ============== HERO ============== */}
      <section className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">
          MODULE · SIGNAL CONSTRUCTION
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          Waveform construction — from samples to signals
        </h1>
        <p className="text-ink-muted text-sm mb-4">
          Shape each quantized chaotic chip into a continuous-time waveform
          ready for transmission.
        </p>
        <div className="px-4 py-3 rounded-md bg-bg-base/60 border border-bg-line inline-block">
          <EquationDisplay
            tex={"s(t) = \\sum_n \\hat{x}_n \\cdot \\varphi(t - nT_c)"}
            block
          />
        </div>
      </section>

      {/* ============== LEARNER CARDS ============== */}
      {explainers && (
        <section className="space-y-4">
          <LearnerCard title="What is waveform construction?">
            <p>{explainers.what_is_waveform_construction}</p>
          </LearnerCard>
          <LearnerCard title="The bandwidth–ISI trade-off" defaultOpen={false} icon="📊">
            <p>{explainers.bandwidth_tradeoff}</p>
          </LearnerCard>
        </section>
      )}

      {/* ============== CONTROLS ============== */}
      <section className="panel p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
          <MapSelector
            registry={{
              ...mapsRegistry,
              maps: Object.fromEntries(
                Object.entries(mapsRegistry.maps).filter(([, v]) => v.dimension === 1)
              ),
            }}
            value={mapId}
            onChange={setMapId}
          />

          {meta?.parameters?.map(p => (
            <ParameterSlider
              key={p.name} spec={p}
              value={params[p.name] ?? p.default}
              onChange={v => setParams({ ...params, [p.name]: v })}
            />
          ))}

          {/* Pulse shape */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1.5">
              Pulse shape φ(t)
            </div>
            <div className="space-y-1">
              {PULSE_SHAPES.map(ps => (
                <button
                  key={ps.id}
                  onClick={() => setPulseShape(ps.id)}
                  className={[
                    "block w-full text-left px-3 py-1.5 rounded text-xs",
                    ps.id === pulseShape
                      ? "bg-amber/15 text-amber border border-amber/40"
                      : "bg-bg-base border border-bg-line text-ink-muted hover:text-ink",
                  ].join(" ")}
                >
                  {ps.label}
                </button>
              ))}
            </div>
          </div>

          {/* Samples per chip */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-ink-dim">
                Samples / chip
              </span>
              <span className="font-mono text-sm text-amber">{spc}</span>
            </div>
            <input
              type="range" min={1} max={32} step={1}
              value={spc}
              onChange={e => setSpc(parseInt(e.target.value, 10))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber"
            />
          </div>

          {/* Roll-off α (only for RC/RRC) */}
          {pulseShape !== "nrz" && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-widest text-ink-dim">
                  Roll-off α
                </span>
                <span className="font-mono text-sm text-amber">{alpha.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0.05} max={1.0} step={0.05}
                value={alpha}
                onChange={e => setAlpha(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan"
              />
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3 text-xs">
          {busy && <span className="caption-mono text-cyan animate-pulse-soft">constructing…</span>}
          {error && <span className="caption-mono text-crimson">{error}</span>}
          {wavData && (
            <span className="caption-mono">
              {wavData.n_chips} chips × {wavData.samples_per_chip} samples = {wavData.n_samples} total ·
              E = {wavData.energy.toFixed(2)} ·
              BW₃dB = {wavData.bandwidth_3db.toFixed(3)}
            </span>
          )}
        </div>
      </section>

      {/* ============== RAW CHIPS → CONSTRUCTED WAVEFORM ============== */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink">Raw chaotic chips (discrete)</div>
            <div className="caption-mono">quantized samples before pulse shaping</div>
          </div>
          <OrbitChart
            orbit={orbit?.orbit?.slice(0, 100)}
            domain={domain}
            showFirst={100}
          />
        </div>

        <div className="panel p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink">
              Constructed waveform — {PULSE_SHAPES.find(p => p.id === pulseShape)?.label}
            </div>
            <div className="caption-mono">
              continuous-time signal s(t) after pulse shaping
            </div>
          </div>
          {wavData ? (
            <OrbitChart
              orbit={wavData.waveform.slice(0, 800)}
              domain={[
                Math.min(...wavData.waveform.slice(0, 800)) - 0.05,
                Math.max(...wavData.waveform.slice(0, 800)) + 0.05,
              ]}
              showFirst={800}
            />
          ) : (
            <div className="h-60 flex items-center justify-center text-xs text-ink-dim">
              No waveform data yet
            </div>
          )}
        </div>
      </section>

      {/* ============== PULSE SHAPE VISUALIZATION ============== */}
      {wavData?.pulse && (
        <section className="panel p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink">Pulse shape φ(t)</div>
            <div className="caption-mono">
              {pulseShape === "nrz"
                ? "rectangular — sharp edges, infinite bandwidth"
                : `${pulseShape === "rrc" ? "root-" : ""}raised cosine — α = ${alpha}, smooth rolloff`}
            </div>
          </div>
          <OrbitChart
            orbit={wavData.pulse}
            domain={[
              Math.min(...wavData.pulse) - 0.1,
              Math.max(...wavData.pulse) + 0.1,
            ]}
          />
        </section>
      )}

      {/* ============== COMPARISON: NRZ vs RC vs RRC ============== */}
      {compareData && (
        <section className="panel p-5">
          <div className="mb-4">
            <div className="text-sm font-semibold text-ink">
              Pulse shape comparison — same chips, three shapes
            </div>
            <div className="caption-mono">
              NRZ has the widest bandwidth · RC/RRC concentrate energy in a narrower band
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {["nrz", "raised_cosine", "rrc"].map(ps => {
              const d = compareData[ps];
              if (!d) return null;
              const wav = d.waveform.slice(0, 400);
              return (
                <div key={ps} className="rounded-md border border-bg-line bg-bg-base/40 p-3">
                  <div className="text-xs font-semibold text-amber mb-1">{d.name}</div>
                  <OrbitChart
                    orbit={wav}
                    domain={[Math.min(...wav) - 0.1, Math.max(...wav) + 0.1]}
                    showFirst={400}
                  />
                  <div className="mt-2 grid grid-cols-2 gap-x-3 text-[10px] font-mono text-ink-muted">
                    <div>E = {d.energy.toFixed(2)}</div>
                    <div>BW₃dB = {d.bandwidth_3db.toFixed(3)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ============== METRICS ============== */}
      {wavData && (
        <section className="panel p-5">
          <div className="section-title mb-3">Signal metrics</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Pulse shape" value={wavData.pulse_shape} />
            <Stat label="Chips" value={wavData.n_chips} />
            <Stat label="Total samples" value={wavData.n_samples} />
            <Stat label="Samples / chip" value={wavData.samples_per_chip} />
            <Stat label="Signal energy E" value={wavData.energy.toFixed(3)} />
            <Stat label="Energy / chip" value={wavData.energy_per_chip.toFixed(4)} />
            <Stat label="3dB bandwidth" value={wavData.bandwidth_3db.toFixed(4)} />
            <Stat label="Roll-off α" value={wavData.alpha ?? "N/A"} />
          </div>
        </section>
      )}

      {/* ============== CONCEPT CARDS ============== */}
      {explainers && (
        <section className="space-y-3">
          <div className="section-title px-1">Deep dive</div>
          <LearnerCard title="NRZ pulse — simplest but widest" defaultOpen={false} icon="▬">
            <p>{explainers.nrz_pulse}</p>
          </LearnerCard>
          <LearnerCard title="Raised cosine — zero ISI" defaultOpen={false} icon="∿">
            <p>{explainers.raised_cosine}</p>
          </LearnerCard>
          <LearnerCard title="Root-raised cosine — the matched pair" defaultOpen={false} icon="√">
            <p>{explainers.root_raised_cosine}</p>
          </LearnerCard>
          <LearnerCard title="Signal energy and E_b/N₀" defaultOpen={false} icon="⚡">
            <p>{explainers.signal_energy}</p>
          </LearnerCard>
        </section>
      )}
    </div>
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
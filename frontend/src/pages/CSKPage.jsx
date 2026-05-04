import { useEffect, useState } from "react";
import { useStore } from "../store/useStore.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { api } from "../api/client.js";

import MapSelector       from "../components/controls/MapSelector.jsx";
import ParameterSlider   from "../components/controls/ParameterSlider.jsx";
import EquationDisplay   from "../components/math/EquationDisplay.jsx";
import LearnerCard       from "../components/math/LearnerCard.jsx";
import WaveformChart     from "../components/charts/WaveformChart.jsx";
import OrbitChart        from "../components/charts/OrbitChart.jsx";

/**
 * CSKPage — the visual and intellectual centerpiece of ChaosComm.
 *
 * Layout:
 *   1. Hero with three-scheme overview
 *   2. Learner cards: CSK, DCSK, FM-DCSK, synchronization, spreading
 *   3. Message input + ASCII→binary animation
 *   4. Controls: scheme selector, map, parameters, chips-per-bit
 *   5. Modulated waveform with per-bit color-coding
 *   6. Correlation detector output (per-bit decisions)
 *   7. Recovered message display + BER
 *   8. PSD of the modulated waveform
 *   9. Scheme comparison panel
 *   10. Deep-dive concept cards
 */

const API = "https://chaoscomm.onrender.com";

const SCHEMES = [
  { id: "csk",     label: "CSK",      desc: "Coherent — needs sync" },
  { id: "dcsk",    label: "DCSK",     desc: "Differential — no sync" },
  { id: "fm_dcsk", label: "FM-DCSK",  desc: "FM — constant envelope" },
];

function defaultParamsFor(meta) {
  if (!meta?.parameters) return {};
  return Object.fromEntries(meta.parameters.map(p => [p.name, p.default]));
}

export default function CSKPage() {
  const { mapsRegistry, mapsRegistryLoading, loadMapsRegistry, mapsRegistryError } = useStore();

  // Controls
  const [message, setMessage]       = useState("Hi");
  const [scheme, setScheme]         = useState("dcsk");
  const [mapId, setMapId]           = useState("logistic");
  const [params, setParams]         = useState({ r: 3.9 });
  const [chipsPerBit, setChipsPerBit] = useState(40);
  const [r0, setR0]                 = useState(3.6);
  const [r1, setR1]                 = useState(3.9);

  // Data
  const [bitsData, setBitsData]       = useState(null);
  const [pipelineData, setPipelineData] = useState(null);
  const [psdData, setPsdData]         = useState(null);
  const [explainers, setExplainers]   = useState(null);

  // Status
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { loadMapsRegistry(); }, [loadMapsRegistry]);

  useEffect(() => {
    fetch(`${API}/api/csk/explainers`)
      .then(r => r.json()).then(setExplainers).catch(() => {});
  }, []);

  // Reset params on map change
  useEffect(() => {
    if (!mapsRegistry) return;
    const meta = mapsRegistry.maps[mapId];
    if (!meta) return;
    setParams(defaultParamsFor(meta));
  }, [mapId, mapsRegistry]);

  // Debounce
  const dMessage = useDebouncedValue(message, 300);
  const dChips   = useDebouncedValue(chipsPerBit, 300);

  // Pipeline: text → bits → modulate → detect → recovered
  useEffect(() => {
    if (!dMessage || dMessage.length === 0) return;

    setBusy(true);
    setError(null);

    // Step 1: text to bits
    fetch(`${API}/api/csk/text-to-bits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: dMessage }),
    })
      .then(r => r.json())
      .then(bits => {
        setBitsData(bits);

        // Step 2: full pipeline
        const pipeReq = {
          message: dMessage,
          scheme,
          map_name: mapId,
          parameter: params[Object.keys(params)[0]] ?? 3.9,
          x0: 0.31415,
          chips_per_bit: dChips,
          r0, r1,
        };

        return fetch(`${API}/api/csk/pipeline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pipeReq),
        }).then(r => r.json());
      })
      .then(pipe => {
        setPipelineData(pipe);

        // Step 3: PSD of the modulated waveform
        if (pipe.modulation?.waveform) {
          return fetch(`${API}/api/csk/psd`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ waveform: pipe.modulation.waveform, fs: 1.0 }),
          }).then(r => r.json());
        }
        return null;
      })
      .then(psd => {
        if (psd) setPsdData(psd);
        setBusy(false);
      })
      .catch(e => { setError(e.message); setBusy(false); });
  }, [dMessage, scheme, mapId, params, dChips, r0, r1]);

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
  const det = pipelineData?.detection;

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">

      {/* ============== HERO ============== */}
      <section className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">
          MODULE · CSK / DCSK / FM-DCSK
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          Chaotic Shift Keying — the communication system
        </h1>
        <p className="text-ink-muted text-sm mb-4">
          Type a message, choose a modulation scheme, and watch chaos encode your data.
        </p>
        <div className="flex gap-3 flex-wrap">
          {SCHEMES.map(s => (
            <div key={s.id} className="px-3 py-2 rounded-md bg-bg-base/60 border border-bg-line">
              <div className="text-xs font-semibold text-amber">{s.label}</div>
              <div className="text-[10px] text-ink-muted">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ============== LEARNER CARDS ============== */}
      {explainers && (
        <section className="space-y-4">
          <LearnerCard title="How does Chaotic Shift Keying work?">
            <p>{explainers.csk_overview}</p>
          </LearnerCard>
          <LearnerCard title="DCSK — solving the synchronization problem" defaultOpen={false} icon="⇄">
            <p>{explainers.dcsk_overview}</p>
          </LearnerCard>
          <LearnerCard title="FM-DCSK — constant envelope for real amplifiers" defaultOpen={false} icon="📡">
            <p>{explainers.fmdcsk_overview}</p>
          </LearnerCard>
          <LearnerCard title="The synchronization problem (why CSK is hard)" defaultOpen={false} icon="🔗">
            <p>{explainers.synchronization_problem}</p>
          </LearnerCard>
        </section>
      )}

      {/* ============== MESSAGE INPUT ============== */}
      <section className="panel p-6">
        <div className="section-title mb-3">Your secret message</div>
        <div className="flex gap-3">
          <input
            type="text"
            value={message}
            onChange={e => setMessage(e.target.value.slice(0, 16))}
            maxLength={16}
            placeholder="Type up to 16 characters…"
            className="flex-1 rounded-md px-4 py-2.5 font-mono text-lg bg-bg-base border border-bg-line text-ink focus:outline-none focus:border-cyan/60 focus:ring-1 focus:ring-cyan/30"
          />
          <div className="text-right text-xs text-ink-dim self-end">
            {message.length}/16 chars · {(message.length * 8)} bits
          </div>
        </div>

        {/* Binary display */}
        {bitsData && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1.5">
              ASCII → Binary
            </div>
            <div className="flex flex-wrap gap-2">
              {message.split("").map((ch, ci) => {
                const bits8 = bitsData.bits.slice(ci * 8, ci * 8 + 8);
                return (
                  <div key={ci} className="rounded-md bg-bg-base border border-bg-line px-2 py-1.5">
                    <div className="text-center text-sm font-semibold text-amber">{ch}</div>
                    <div className="font-mono text-[10px] text-cyan tracking-wider">
                      {bits8.join("")}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 caption-mono">
              Hamming weight: {bitsData.analysis?.ones}/{bitsData.analysis?.n_bits} ·
              entropy: {bitsData.analysis?.entropy?.toFixed(3)} bits/symbol ·
              balance: {(bitsData.analysis?.balance * 100)?.toFixed(1)}%
            </div>
          </div>
        )}
      </section>

      {/* ============== CONTROLS ============== */}
      <section className="panel p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Scheme selector */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-ink-dim mb-1.5">
              Modulation scheme
            </div>
            <div className="space-y-1">
              {SCHEMES.map(s => (
                <button
                  key={s.id}
                  onClick={() => setScheme(s.id)}
                  className={[
                    "block w-full text-left px-3 py-2 rounded text-sm",
                    s.id === scheme
                      ? "bg-amber/15 text-amber border border-amber/40 font-medium"
                      : "bg-bg-base border border-bg-line text-ink-muted hover:text-ink",
                  ].join(" ")}
                >
                  <span className="font-semibold">{s.label}</span>
                  <span className="ml-2 text-xs text-ink-dim">{s.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Map selector */}
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

          {/* Parameters */}
          {scheme === "csk" ? (
            <div className="space-y-3">
              <ParameterSlider
                spec={{ name: "r0", label: "r₀ (bit 0)", min: 2.5, max: 4.0, step: 0.01, default: 3.6 }}
                value={r0}
                onChange={setR0}
              />
              <ParameterSlider
                spec={{ name: "r1", label: "r₁ (bit 1)", min: 2.5, max: 4.0, step: 0.01, default: 3.9 }}
                value={r1}
                onChange={setR1}
              />
            </div>
          ) : (
            meta?.parameters?.map(p => (
              <ParameterSlider
                key={p.name} spec={p}
                value={params[p.name] ?? p.default}
                onChange={v => setParams({ ...params, [p.name]: v })}
              />
            ))
          )}

          {/* Chips per bit */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-ink-dim">
                Chips per bit (β)
              </span>
              <span className="font-mono text-sm text-amber">{chipsPerBit}</span>
            </div>
            <input
              type="range" min={4} max={128} step={4}
              value={chipsPerBit}
              onChange={e => setChipsPerBit(parseInt(e.target.value, 10))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-line [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber"
            />
            <div className="caption-mono mt-1">
              Processing gain: {(10 * Math.log10(scheme === "dcsk" ? chipsPerBit / 2 : chipsPerBit)).toFixed(1)} dB
            </div>
          </div>
        </div>

        {/* Status line */}
        <div className="mt-3 flex items-center gap-3 text-xs">
          {busy && <span className="caption-mono text-cyan animate-pulse-soft">encoding…</span>}
          {error && <span className="caption-mono text-crimson">{error}</span>}
          {pipelineData && (
            <span className="caption-mono">
              {pipelineData.modulation?.total_chips} chips total ·
              BER = {pipelineData.ber} ·
              {pipelineData.success ? " ✓ message recovered" : " ✗ errors detected"}
            </span>
          )}
        </div>
      </section>

      {/* ============== WAVEFORM ============== */}
      <section className="panel p-5">
        <div className="mb-3">
          <div className="text-sm font-semibold text-ink">
            Modulated waveform — {scheme.toUpperCase()}
          </div>
          <div className="caption-mono">
            {scheme === "dcsk" || scheme === "fm_dcsk"
              ? "cyan = reference half · amber = information half · bit labels at top"
              : "cyan = bit 0 (r₀) · amber = bit 1 (r₁) · bit labels at top"}
          </div>
        </div>
        <WaveformChart
          waveform={pipelineData?.modulation?.waveform}
          perBit={pipelineData?.modulation?.per_bit}
          scheme={scheme}
          height={220}
          showFirst={800}
        />
      </section>

      {/* ============== DETECTOR OUTPUT ============== */}
      {det && (
        <section className="panel p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink">Correlation detector output</div>
            <div className="caption-mono">
              {scheme === "dcsk" || scheme === "fm_dcsk"
                ? "z = Σ r[k]·i[k] — positive → bit 1, negative → bit 0"
                : "max(corr₀, corr₁) — higher correlation wins"}
            </div>
          </div>

          {/* Per-bit decision table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-ink-dim border-b border-bg-line">
                  <th className="text-left py-1.5 px-2">Bit</th>
                  <th className="text-left py-1.5 px-2">Sent</th>
                  {(scheme === "csk") && <th className="text-left py-1.5 px-2">Corr₀</th>}
                  {(scheme === "csk") && <th className="text-left py-1.5 px-2">Corr₁</th>}
                  {(scheme !== "csk") && <th className="text-left py-1.5 px-2">Correlation z</th>}
                  <th className="text-left py-1.5 px-2">Decision</th>
                  <th className="text-left py-1.5 px-2">Correct?</th>
                </tr>
              </thead>
              <tbody>
                {det.correlations.slice(0, 32).map((c, i) => {
                  const sent = pipelineData.bits[i];
                  const correct = c.decision === sent;
                  return (
                    <tr key={i} className="border-b border-bg-line/30">
                      <td className="py-1 px-2 text-ink-dim">{i}</td>
                      <td className="py-1 px-2">{sent}</td>
                      {scheme === "csk" && <td className="py-1 px-2 text-cyan">{c.corr_0?.toFixed(2)}</td>}
                      {scheme === "csk" && <td className="py-1 px-2 text-amber">{c.corr_1?.toFixed(2)}</td>}
                      {scheme !== "csk" && (
                        <td className={`py-1 px-2 ${c.correlation > 0 ? "text-amber" : "text-cyan"}`}>
                          {c.correlation?.toFixed(4)}
                        </td>
                      )}
                      <td className="py-1 px-2 font-semibold">{c.decision}</td>
                      <td className={`py-1 px-2 ${correct ? "text-phosphor" : "text-crimson font-bold"}`}>
                        {correct ? "✓" : "✗"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {det.correlations.length > 32 && (
            <div className="text-xs text-ink-dim mt-2">
              Showing first 32 of {det.correlations.length} bits
            </div>
          )}
        </section>
      )}

      {/* ============== RECOVERED MESSAGE ============== */}
      {pipelineData && (
        <section className="panel p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="section-title mb-2">Recovered message</div>
              <div className="font-mono text-2xl text-amber tracking-wider">
                {pipelineData.recovered_text}
              </div>
              <div className={[
                "mt-2 text-sm font-medium",
                pipelineData.success ? "text-phosphor" : "text-crimson",
              ].join(" ")}>
                {pipelineData.success
                  ? "✓ Perfect recovery — BER = 0 (noiseless channel)"
                  : `✗ ${pipelineData.n_errors} bit errors — BER = ${pipelineData.ber.toFixed(4)}`}
              </div>
            </div>
            <div>
              <div className="section-title mb-2">Transmission summary</div>
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <Stat label="Scheme" value={scheme.toUpperCase()} />
                <Stat label="Map" value={meta?.name} />
                <Stat label="Chips / bit" value={chipsPerBit} />
                <Stat label="Total chips" value={pipelineData.modulation?.total_chips} />
                <Stat label="Message bits" value={pipelineData.bits?.length} />
                <Stat label="BER" value={pipelineData.ber.toFixed(4)} />
                {psdData && (
                  <Stat
                    label="Spectral flatness"
                    value={`${(psdData.spectral_flatness * 100).toFixed(1)}%`}
                  />
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ============== PSD ============== */}
      {psdData && psdData.freq?.length > 0 && (
        <section className="panel p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink">Power spectral density</div>
            <div className="caption-mono">
              spectral flatness = {(psdData.spectral_flatness * 100).toFixed(1)}% —
              {psdData.spectral_flatness > 0.5 ? " noise-like (good LPI)" : " has spectral structure"}
            </div>
          </div>
          <OrbitChart
            orbit={psdData.psd}
            domain={[Math.min(...psdData.psd) - 5, Math.max(...psdData.psd) + 5]}
          />
        </section>
      )}

      {/* ============== CONCEPT CARDS ============== */}
      {explainers && (
        <section className="space-y-3">
          <div className="section-title px-1">Deep dive</div>
          <LearnerCard title="Spreading factor β and processing gain" defaultOpen={false} icon="📊">
            <p>{explainers.spreading_factor}</p>
          </LearnerCard>
          <LearnerCard title="Correlation detection — the receiver's core operation" defaultOpen={false} icon="⊗">
            <p>{explainers.correlation_detection}</p>
          </LearnerCard>
          <LearnerCard title="Waveform construction — pulse shaping" defaultOpen={false} icon="∿">
            <p>{explainers.waveform_construction}</p>
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
      <div className="font-mono text-ink">{value ?? "—"}</div>
    </div>
  );
}
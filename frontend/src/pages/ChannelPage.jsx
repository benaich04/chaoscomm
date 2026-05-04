import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useStore } from "../store/useStore.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

import MapSelector from "../components/controls/MapSelector.jsx";
import ParameterSlider from "../components/controls/ParameterSlider.jsx";
import EquationDisplay from "../components/math/EquationDisplay.jsx";
import LearnerCard from "../components/math/LearnerCard.jsx";
import WaveformChart from "../components/charts/WaveformChart.jsx";

/**
 * ChannelPage — Real-world channel models for ChaosComm.
 *
 * Layout:
 *   1. Hero: transmitted waveform → channel → received waveform
 *   2. Learner cards: ideal, AWGN, fading, multipath, jamming
 *   3. Controls: message, scheme, map, chips/bit, channel type, channel params
 *   4. Clean transmitted waveform vs received waveform
 *   5. Impairment chart: noise / fading / echoes / jammer
 *   6. Metrics: TX power, RX power, impairment power, effective SNR
 *   7. Channel comparison panel
 *
 * Backend expected:
 *   GET  /api/channel/explainers
 *   POST /api/channel/apply
 *   POST /api/channel/compare
 *   POST /api/csk/pipeline
 */

const API = "http://localhost:8000";

const SCHEMES = [
  { id: "csk", label: "CSK", desc: "Coherent — needs sync" },
  { id: "dcsk", label: "DCSK", desc: "Differential — no sync" },
  { id: "fm_dcsk", label: "FM-DCSK", desc: "FM — constant envelope" },
];

const CHANNELS = [
  {
    id: "ideal",
    label: "Ideal",
    desc: "No damage: r[n] = s[n]",
  },
  {
    id: "awgn",
    label: "AWGN",
    desc: "Additive Gaussian noise",
  },
  {
    id: "flat_fading",
    label: "Flat fading",
    desc: "Constant gain h",
  },
  {
    id: "rayleigh",
    label: "Rayleigh",
    desc: "No line-of-sight fading",
  },
  {
    id: "rician",
    label: "Rician",
    desc: "LOS + scattered paths",
  },
  {
    id: "multipath",
    label: "Multipath",
    desc: "Delayed echoes",
  },
  {
    id: "jammer",
    label: "Jammer",
    desc: "Intentional interference",
  },
];

const JAMMER_TYPES = [
  { id: "tone", label: "Tone" },
  { id: "broadband", label: "Broadband noise" },
  { id: "pulsed", label: "Pulsed" },
  { id: "chirp", label: "Chirp" },
];

function defaultParamsFor(meta) {
  if (!meta?.parameters) return {};
  return Object.fromEntries(meta.parameters.map((p) => [p.name, p.default]));
}

function metric(v, digits = 3) {
  if (v === null || v === undefined) return "—";
  if (v === Infinity || v === "Infinity") return "∞";
  if (v === -Infinity || v === "-Infinity") return "-∞";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function ChannelFormula({ channelType }) {
  if (channelType === "ideal") {
    return (
      <EquationDisplay
        latex={String.raw`r[n] = s[n]`}
        caption="Ideal channel"
      />
    );
  }

  if (channelType === "awgn") {
    return (
      <EquationDisplay
        latex={String.raw`r[n] = s[n] + w[n]`}
        caption="AWGN channel"
      />
    );
  }

  if (channelType === "flat_fading") {
    return (
      <EquationDisplay
        latex={String.raw`r[n] = h\,s[n] + w[n]`}
        caption="Flat fading channel"
      />
    );
  }

  if (channelType === "rayleigh") {
    return (
      <EquationDisplay
        latex={String.raw`r[n] = h[n]\,s[n] + w[n], \quad h[n]\sim \mathrm{Rayleigh}`}
        caption="Rayleigh fading"
      />
    );
  }

  if (channelType === "rician") {
    return (
      <EquationDisplay
        latex={String.raw`r[n] = h[n]\,s[n] + w[n], \quad h[n]\sim \mathrm{Rician}(K)`}
        caption="Rician fading"
      />
    );
  }

  if (channelType === "multipath") {
    return (
      <EquationDisplay
        latex={String.raw`r[n] = \sum_k a_k\,s[n-d_k] + w[n]`}
        caption="Multipath channel"
      />
    );
  }

  if (channelType === "jammer") {
    return (
      <EquationDisplay
        latex={String.raw`r[n] = s[n] + j[n] + w[n]`}
        caption="Jamming channel"
      />
    );
  }

  return null;
}

function ChannelSpecificControls({
  channelType,
  snrDb,
  setSnrDb,
  gain,
  setGain,
  blockFading,
  setBlockFading,
  kFactor,
  setKFactor,
  delays,
  setDelays,
  gains,
  setGains,
  jammerType,
  setJammerType,
  jsrDb,
  setJsrDb,
  jammerFreq,
  setJammerFreq,
  dutyCycle,
  setDutyCycle,
}) {
  if (channelType === "ideal") {
    return (
      <div className="rounded-md border border-bg-line bg-bg-base/50 p-4">
        <div className="text-sm text-ink-muted">
          The ideal channel does not apply noise, fading, delay, or interference.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {channelType !== "multipath" && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="caption-mono">SNR</label>
            <span className="caption-mono text-cyan">{snrDb} dB</span>
          </div>
          <input
            type="range"
            min="-5"
            max="40"
            step="1"
            value={snrDb}
            onChange={(e) => setSnrDb(Number(e.target.value))}
            className="w-full"
          />
        </div>
      )}

      {channelType === "multipath" && (
        <>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="caption-mono">SNR</label>
              <span className="caption-mono text-cyan">{snrDb} dB</span>
            </div>
            <input
              type="range"
              min="-5"
              max="40"
              step="1"
              value={snrDb}
              onChange={(e) => setSnrDb(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="caption-mono block mb-1">Path delays</label>
            <input
              value={delays}
              onChange={(e) => setDelays(e.target.value)}
              className="w-full rounded-md border border-bg-line bg-bg-base px-3 py-2 text-sm"
              placeholder="0,3,8"
            />
            <div className="caption-mono mt-1">Comma-separated sample delays</div>
          </div>

          <div>
            <label className="caption-mono block mb-1">Path gains</label>
            <input
              value={gains}
              onChange={(e) => setGains(e.target.value)}
              className="w-full rounded-md border border-bg-line bg-bg-base px-3 py-2 text-sm"
              placeholder="1.0,0.45,0.2"
            />
            <div className="caption-mono mt-1">Same length as delays</div>
          </div>
        </>
      )}

      {channelType === "flat_fading" && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="caption-mono">Channel gain h</label>
            <span className="caption-mono text-cyan">{gain.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={gain}
            onChange={(e) => setGain(Number(e.target.value))}
            className="w-full"
          />
        </div>
      )}

      {(channelType === "rayleigh" || channelType === "rician") && (
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={blockFading}
            onChange={(e) => setBlockFading(e.target.checked)}
          />
          Use block fading, one gain for the whole waveform
        </label>
      )}

      {channelType === "rician" && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="caption-mono">Rician K-factor</label>
            <span className="caption-mono text-cyan">{kFactor.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="20"
            step="0.5"
            value={kFactor}
            onChange={(e) => setKFactor(Number(e.target.value))}
            className="w-full"
          />
        </div>
      )}

      {channelType === "jammer" && (
        <>
          <div>
            <label className="caption-mono block mb-1">Jammer type</label>
            <div className="grid grid-cols-2 gap-2">
              {JAMMER_TYPES.map((j) => (
                <button
                  key={j.id}
                  onClick={() => setJammerType(j.id)}
                  className={`rounded-md border px-3 py-2 text-xs transition ${
                    jammerType === j.id
                      ? "border-crimson bg-crimson/15 text-crimson"
                      : "border-bg-line bg-bg-base text-ink-muted hover:border-crimson/40"
                  }`}
                >
                  {j.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="caption-mono">JSR</label>
              <span className="caption-mono text-crimson">{jsrDb} dB</span>
            </div>
            <input
              type="range"
              min="-20"
              max="20"
              step="1"
              value={jsrDb}
              onChange={(e) => setJsrDb(Number(e.target.value))}
              className="w-full"
            />
          </div>

          {(jammerType === "tone" || jammerType === "chirp") && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="caption-mono">Jammer frequency</label>
                <span className="caption-mono text-cyan">{jammerFreq.toFixed(3)}</span>
              </div>
              <input
                type="range"
                min="0.005"
                max="0.45"
                step="0.005"
                value={jammerFreq}
                onChange={(e) => setJammerFreq(Number(e.target.value))}
                className="w-full"
              />
            </div>
          )}

          {jammerType === "pulsed" && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="caption-mono">Duty cycle</label>
                <span className="caption-mono text-cyan">
                  {(dutyCycle * 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={dutyCycle}
                onChange={(e) => setDutyCycle(Number(e.target.value))}
                className="w-full"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function parseNumberList(str, fallback) {
  try {
    const arr = str
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x));

    return arr.length > 0 ? arr : fallback;
  } catch {
    return fallback;
  }
}

function MetricCard({ label, value, unit = "" }) {
  return (
    <div className="rounded-md border border-bg-line bg-bg-base/50 p-4">
      <div className="caption-mono mb-1">{label}</div>
      <div className="text-2xl font-semibold">
        {value}
        {unit && <span className="text-sm text-ink-muted ml-1">{unit}</span>}
      </div>
    </div>
  );
}

export default function ChannelPage() {
  const {
    mapsRegistry,
    mapsRegistryLoading,
    loadMapsRegistry,
    mapsRegistryError,
  } = useStore();

  // Main communication controls
  const [message, setMessage] = useState("Hi");
  const [scheme, setScheme] = useState("dcsk");
  const [mapId, setMapId] = useState("logistic");
  const [params, setParams] = useState({ r: 3.9 });
  const [chipsPerBit, setChipsPerBit] = useState(40);
  const [r0, setR0] = useState(3.6);
  const [r1, setR1] = useState(3.9);

  // Channel controls
  const [channelType, setChannelType] = useState("awgn");
  const [snrDb, setSnrDb] = useState(12);
  const [gain, setGain] = useState(0.8);
  const [blockFading, setBlockFading] = useState(false);
  const [kFactor, setKFactor] = useState(5.0);
  const [delays, setDelays] = useState("0,3,8");
  const [gains, setGains] = useState("1.0,0.45,0.2");
  const [jammerType, setJammerType] = useState("tone");
  const [jsrDb, setJsrDb] = useState(0);
  const [jammerFreq, setJammerFreq] = useState(0.05);
  const [dutyCycle, setDutyCycle] = useState(0.25);

  // Data
  const [pipelineData, setPipelineData] = useState(null);
  const [channelData, setChannelData] = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [explainers, setExplainers] = useState(null);

  // Status
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadMapsRegistry();
  }, [loadMapsRegistry]);

  useEffect(() => {
    fetch(`${API}/api/channel/explainers`)
      .then((r) => r.json())
      .then(setExplainers)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!mapsRegistry) return;
    const meta = mapsRegistry.maps[mapId];
    if (!meta) return;
    setParams(defaultParamsFor(meta));
  }, [mapId, mapsRegistry]);

  const dMessage = useDebouncedValue(message, 300);
  const dChips = useDebouncedValue(chipsPerBit, 300);
  const dParams = useDebouncedValue(params, 250);
  const dSnrDb = useDebouncedValue(snrDb, 250);
  const dGain = useDebouncedValue(gain, 250);
  const dKFactor = useDebouncedValue(kFactor, 250);
  const dDelays = useDebouncedValue(delays, 300);
  const dGains = useDebouncedValue(gains, 300);
  const dJsrDb = useDebouncedValue(jsrDb, 250);
  const dJammerFreq = useDebouncedValue(jammerFreq, 250);
  const dDutyCycle = useDebouncedValue(dutyCycle, 250);

  function buildChannelParams() {
    if (channelType === "ideal") {
      return {};
    }

    if (channelType === "awgn") {
      return {
        snr_db: dSnrDb,
        seed: 1,
      };
    }

    if (channelType === "flat_fading") {
      return {
        gain: dGain,
        snr_db: dSnrDb,
        seed: 1,
      };
    }

    if (channelType === "rayleigh") {
      return {
        snr_db: dSnrDb,
        seed: 2,
        block_fading: blockFading,
      };
    }

    if (channelType === "rician") {
      return {
        snr_db: dSnrDb,
        seed: 3,
        block_fading: blockFading,
        k_factor: dKFactor,
      };
    }

    if (channelType === "multipath") {
      return {
        delays: parseNumberList(dDelays, [0, 3, 8]).map((x) => Math.round(x)),
        gains: parseNumberList(dGains, [1.0, 0.45, 0.2]),
        snr_db: dSnrDb,
        seed: 4,
      };
    }

    if (channelType === "jammer") {
      return {
        jammer_type: jammerType,
        jsr_db: dJsrDb,
        snr_db: dSnrDb,
        fs: 1.0,
        freq: dJammerFreq,
        seed: 5,
        duty_cycle: dDutyCycle,
        chirp_f0: 0.02,
        chirp_f1: Math.max(0.03, dJammerFreq),
      };
    }

    return {};
  }

  useEffect(() => {
    if (!dMessage || dMessage.length === 0) return;

    setBusy(true);
    setError(null);

    const parameterValue = dParams[Object.keys(dParams)[0]] ?? 3.9;

    const pipeReq = {
      message: dMessage,
      scheme,
      map_name: mapId,
      parameter: parameterValue,
      x0: 0.31415,
      chips_per_bit: dChips,
      r0,
      r1,
    };

    fetch(`${API}/api/csk/pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pipeReq),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`CSK pipeline failed: ${r.status}`);
        return r.json();
      })
      .then((pipe) => {
        setPipelineData(pipe);

        const waveform = pipe.modulation?.waveform;
        if (!waveform || waveform.length === 0) {
          throw new Error("Pipeline did not return a waveform.");
        }

        const applyReq = {
          waveform,
          channel_type: channelType,
          params: buildChannelParams(),
        };

        const compareReq = {
          waveform,
          channel_specs: [
            {
              channel_type: "ideal",
              params: {},
            },
            {
              channel_type: "awgn",
              params: { snr_db: dSnrDb, seed: 11 },
            },
            {
              channel_type: "rayleigh",
              params: { snr_db: dSnrDb, seed: 12, block_fading: false },
            },
            {
              channel_type: "multipath",
              params: {
                delays: [0, 3, 8],
                gains: [1.0, 0.45, 0.2],
                snr_db: dSnrDb,
                seed: 13,
              },
            },
            {
              channel_type: "jammer",
              params: {
                jammer_type: "tone",
                jsr_db: dJsrDb,
                snr_db: dSnrDb,
                freq: dJammerFreq,
                seed: 14,
              },
            },
          ],
        };

        return Promise.all([
          fetch(`${API}/api/channel/apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(applyReq),
          }).then((r) => {
            if (!r.ok) throw new Error(`Channel apply failed: ${r.status}`);
            return r.json();
          }),
          fetch(`${API}/api/channel/compare`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(compareReq),
          }).then((r) => {
            if (!r.ok) throw new Error(`Channel compare failed: ${r.status}`);
            return r.json();
          }),
        ]);
      })
      .then(([ch, cmp]) => {
        setChannelData(ch);
        setCompareData(cmp);
        setBusy(false);
      })
      .catch((e) => {
        setError(e.message);
        setBusy(false);
      });
  }, [
    dMessage,
    scheme,
    mapId,
    dParams,
    dChips,
    r0,
    r1,
    channelType,
    dSnrDb,
    dGain,
    blockFading,
    dKFactor,
    dDelays,
    dGains,
    jammerType,
    dJsrDb,
    dJammerFreq,
    dDutyCycle,
  ]);

  if (mapsRegistryError) {
    return (
      <div className="px-8 py-8 max-w-6xl mx-auto">
        <div className="panel p-6 border-l-4 border-crimson/60">
          <div className="text-crimson font-semibold">Backend connection failed</div>
          <div className="text-sm text-ink-muted mt-1">
            Make sure FastAPI is running on http://localhost:8000.
          </div>
        </div>
      </div>
    );
  }

  if (mapsRegistryLoading || !mapsRegistry) {
    return (
      <div className="px-8 py-8 max-w-6xl mx-auto">
        <div className="panel p-8 animate-pulse-soft text-ink-muted">
          Loading channel lab…
        </div>
      </div>
    );
  }

  const selectedMap = mapsRegistry.maps[mapId];
  const metrics = channelData?.metrics || {};
  const waveform = pipelineData?.modulation?.waveform || [];
  const received = channelData?.received || [];
  const impairment = channelData?.impairment || [];
  const fading = channelData?.fading || null;
  const jammer = channelData?.jammer || null;

  const explainerKeys = [
    "channel_overview",
    "ideal_channel",
    "awgn",
    "flat_fading",
    "rayleigh",
    "rician",
    "multipath",
    "jamming",
    "snr_jsr",
  ];

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">
      {/* Hero */}
      <div className="panel p-8 grid-bg relative overflow-hidden">
        <div className="absolute top-3 right-4 caption-mono text-[10px] text-ink-dim">
          CHANNEL MODELS · REAL-WORLD IMPAIRMENTS
        </div>

        <div className="flex items-baseline gap-3 mb-2">
          <span className="caption-mono text-cyan/80">[07]</span>
          <span className="pill bg-crimson/10 text-crimson border border-crimson/30">
            Noise / fading / echoes / jamming
          </span>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight mb-2">
          Channel Models
        </h1>

        <p className="text-ink-muted max-w-3xl">
          The channel is where the clean chaotic waveform meets the real world.
          This page takes the CSK/DCSK/FM-DCSK waveform and corrupts it with
          noise, fading, multipath, or jamming before the receiver tries to recover it.
        </p>

        <div className="mt-6 max-w-3xl">
          <ChannelFormula channelType={channelType} />
        </div>
      </div>

      {/* Top learner cards */}
      <div className="grid md:grid-cols-3 gap-4">
        <LearnerCard
          title="What the channel does"
          defaultOpen
        >
          The transmitter creates a clean waveform, but the receiver almost never
          sees that exact waveform. The channel can add random noise, scale the
          signal, create delayed echoes, or inject interference.
        </LearnerCard>

        <LearnerCard
          title="Why this matters for chaos"
          defaultOpen
        >
          Chaotic waveforms look noise-like already. That is useful for hiding and
          spreading the signal, but it also means the receiver depends heavily on
          correlation and matched filtering to recover the correct bits.
        </LearnerCard>

        <LearnerCard
          title="What to watch"
          defaultOpen
        >
          Increase noise or jamming and watch the received waveform lose structure.
          Increase chips per bit and the system usually becomes more robust because
          the receiver averages over more chaotic chips.
        </LearnerCard>
      </div>

      {/* Controls */}
      <div className="grid lg:grid-cols-3 gap-5">
        {/* Communication controls */}
        <div className="panel p-5 space-y-4">
          <div>
            <div className="section-title mb-1">Communication setup</div>
            <div className="caption-mono">Message → CSK waveform</div>
          </div>

          <div>
            <label className="caption-mono block mb-1">Message</label>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full rounded-md border border-bg-line bg-bg-base px-3 py-2 text-sm"
              placeholder="Type message"
            />
          </div>

          <div>
            <label className="caption-mono block mb-2">Scheme</label>
            <div className="grid grid-cols-3 gap-2">
              {SCHEMES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScheme(s.id)}
                  className={`rounded-md border px-3 py-2 text-left transition ${
                    scheme === s.id
                      ? "border-cyan bg-cyan/15 text-cyan"
                      : "border-bg-line bg-bg-base text-ink-muted hover:border-cyan/40"
                  }`}
                >
                  <div className="font-semibold text-sm">{s.label}</div>
                  <div className="text-[10px] opacity-70">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="caption-mono block mb-2">Chaotic map</label>
            <MapSelector
              mapsRegistry={mapsRegistry}
              value={mapId}
              onChange={setMapId}
              allowCustom={false}
            />
          </div>

          {selectedMap?.parameters?.map((p) => (
            <ParameterSlider
              key={p.name}
              spec={p}
              value={params[p.name] ?? p.default}
              onChange={(v) => setParams((old) => ({ ...old, [p.name]: v }))}
            />
          ))}

          {scheme === "csk" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="caption-mono">r₀</label>
                  <span className="caption-mono text-cyan">{r0.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="3.55"
                  max="4"
                  step="0.01"
                  value={r0}
                  onChange={(e) => setR0(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="caption-mono">r₁</label>
                  <span className="caption-mono text-cyan">{r1.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="3.55"
                  max="4"
                  step="0.01"
                  value={r1}
                  onChange={(e) => setR1(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="caption-mono">Chips per bit</label>
              <span className="caption-mono text-cyan">{chipsPerBit}</span>
            </div>
            <input
              type="range"
              min="8"
              max="160"
              step="4"
              value={chipsPerBit}
              onChange={(e) => setChipsPerBit(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        {/* Channel controls */}
        <div className="panel p-5 space-y-4">
          <div>
            <div className="section-title mb-1">Channel method</div>
            <div className="caption-mono">Apply impairment to waveform</div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {CHANNELS.map((ch) => (
              <button
                key={ch.id}
                onClick={() => setChannelType(ch.id)}
                className={`rounded-md border px-3 py-2 text-left transition ${
                  channelType === ch.id
                    ? "border-amber bg-amber/15 text-amber"
                    : "border-bg-line bg-bg-base text-ink-muted hover:border-amber/40"
                }`}
              >
                <div className="font-semibold text-sm">{ch.label}</div>
                <div className="text-[10px] opacity-70">{ch.desc}</div>
              </button>
            ))}
          </div>

          <ChannelSpecificControls
            channelType={channelType}
            snrDb={snrDb}
            setSnrDb={setSnrDb}
            gain={gain}
            setGain={setGain}
            blockFading={blockFading}
            setBlockFading={setBlockFading}
            kFactor={kFactor}
            setKFactor={setKFactor}
            delays={delays}
            setDelays={setDelays}
            gains={gains}
            setGains={setGains}
            jammerType={jammerType}
            setJammerType={setJammerType}
            jsrDb={jsrDb}
            setJsrDb={setJsrDb}
            jammerFreq={jammerFreq}
            setJammerFreq={setJammerFreq}
            dutyCycle={dutyCycle}
            setDutyCycle={setDutyCycle}
          />
        </div>

        {/* Metrics */}
        <div className="panel p-5 space-y-4">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="section-title mb-1">Channel metrics</div>
              <div className="caption-mono">
                {busy ? "refreshing…" : "computed from received signal"}
              </div>
            </div>
            {busy && (
              <span className="caption-mono text-cyan animate-pulse-soft">
                running
              </span>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-crimson/40 bg-crimson/10 p-3 text-sm text-crimson">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label="TX power"
              value={metric(metrics.tx_power)}
            />
            <MetricCard
              label="RX power"
              value={metric(metrics.rx_power)}
            />
            <MetricCard
              label="Impairment power"
              value={metric(metrics.impairment_power)}
            />
            <MetricCard
              label="Effective SNR"
              value={metric(metrics.effective_snr_db, 2)}
              unit="dB"
            />
          </div>

          <div className="rounded-md border border-bg-line bg-bg-base/50 p-4">
            <div className="caption-mono mb-2">Recovered message before channel</div>
            <div className="text-lg font-semibold">
              {pipelineData?.recovered_message ?? "—"}
            </div>
            <div className="caption-mono mt-2">
              Current channel page corrupts the waveform visually/physically. The next step is
              to feed the channel output back into the CSK detector for BER-after-channel.
            </div>
          </div>

          {channelData?.metrics?.description && (
            <div className="text-xs text-ink-muted leading-relaxed">
              {channelData.metrics.description}
            </div>
          )}
        </div>
      </div>

      {/* Waveforms */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="panel p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="section-title">Transmitted waveform</div>
              <div className="caption-mono">Clean output from modulation</div>
            </div>
            <span className="caption-mono">{waveform.length} samples</span>
          </div>

          <WaveformChart
            waveform={waveform}
            perBit={pipelineData?.modulation?.per_bit}
            scheme={scheme}
            height={240}
            showFirst={700}
          />
        </div>

        <div className="panel p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="section-title">Received waveform</div>
              <div className="caption-mono">After {channelType}</div>
            </div>
            <span className="caption-mono">{received.length} samples</span>
          </div>

          <WaveformChart
            waveform={received}
            perBit={pipelineData?.modulation?.per_bit}
            scheme={scheme}
            height={240}
            showFirst={700}
          />
        </div>
      </div>

      {/* Impairment / fading / jammer */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="panel p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <div className="section-title">Impairment component</div>
              <div className="caption-mono">
                received - transmitted
              </div>
            </div>
          </div>

          <WaveformChart
            waveform={impairment}
            scheme="csk"
            height={220}
            showFirst={700}
          />
        </div>

        <div className="panel p-5">
          <div className="section-title mb-2">Extra channel view</div>

          {fading ? (
            <>
              <div className="caption-mono mb-2">Fading gain h[n]</div>
              <WaveformChart
                waveform={fading}
                scheme="csk"
                height={180}
                showFirst={700}
              />
            </>
          ) : jammer ? (
            <>
              <div className="caption-mono mb-2">Jammer j[n]</div>
              <WaveformChart
                waveform={jammer}
                scheme="csk"
                height={180}
                showFirst={700}
              />
            </>
          ) : channelData?.impulse_response ? (
            <div className="space-y-2">
              <div className="caption-mono">Impulse response h[n]</div>
              <div className="rounded-md border border-bg-line bg-bg-base p-3 text-sm font-mono">
                [{channelData.impulse_response.map((x) => metric(x, 2)).join(", ")}]
              </div>
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-xs text-ink-dim">
              No extra channel variable for this method
            </div>
          )}
        </div>
      </div>

      {/* Comparison */}
      <div className="panel p-5">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <div className="section-title">Channel comparison</div>
            <div className="caption-mono">
              Same transmitted waveform through different channels
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-5 gap-3">
          {compareData?.results?.map((r) => (
            <div
              key={r.channel_type}
              className={`rounded-md border p-4 ${
                r.channel_type === channelType
                  ? "border-amber bg-amber/10"
                  : "border-bg-line bg-bg-base/50"
              }`}
            >
              <div className="font-semibold mb-1">{r.channel_type}</div>
              <div className="caption-mono mb-3">
                SNR {metric(r.metrics?.effective_snr_db, 1)} dB
              </div>
              <div className="text-xs text-ink-muted space-y-1">
                <div>RX power: {metric(r.metrics?.rx_power)}</div>
                <div>Impairment: {metric(r.metrics?.impairment_power)}</div>
              </div>
            </div>
          )) || (
            <div className="text-sm text-ink-dim">
              No comparison data yet.
            </div>
          )}
        </div>
      </div>

      {/* Deep concept cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {explainers &&
          explainerKeys
            .filter((k) => explainers[k])
            .map((k) => (
              <LearnerCard
                key={k}
                title={k.replaceAll("_", " ")}
              >
                {explainers[k]}
              </LearnerCard>
            ))}
      </div>
    </div>
  );
}
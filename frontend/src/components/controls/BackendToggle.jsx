import { useStore } from "../../store/useStore.js";

/**
 * BackendToggle — small switch to flip between NumPy and MATLAB
 * computation backends.  Hidden when MATLAB isn't available.
 *
 * The switch sets `preferences.preferMatlab` in the global store.  Pages
 * that issue requests check the store's `effectiveBackend()` helper and
 * pass `backend: "matlab"` or `"numpy"` to the API.
 */
export default function BackendToggle() {
  const matlabAvailable = useStore((s) => s.backend.matlabAvailable);
  const preferMatlab    = useStore((s) => s.preferences.preferMatlab);
  const setPreferences  = useStore((s) => s.setPreferences);

  if (!matlabAvailable) return null;

  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] uppercase tracking-widest text-ink-dim">
        Backend
      </span>
      <div className="flex rounded-md border border-bg-line overflow-hidden">
        <button
          onClick={() => setPreferences({ preferMatlab: false })}
          className={[
            "px-3 py-1 text-xs font-medium transition-colors",
            !preferMatlab
              ? "bg-cyan/15 text-cyan"
              : "bg-transparent text-ink-muted hover:text-ink",
          ].join(" ")}
        >
          NumPy
        </button>
        <button
          onClick={() => setPreferences({ preferMatlab: true })}
          className={[
            "px-3 py-1 text-xs font-medium transition-colors border-l border-bg-line",
            preferMatlab
              ? "bg-amber/15 text-amber"
              : "bg-transparent text-ink-muted hover:text-ink",
          ].join(" ")}
        >
          MATLAB
        </button>
      </div>
    </div>
  );
}
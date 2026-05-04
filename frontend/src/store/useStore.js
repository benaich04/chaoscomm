import { create } from "zustand";
import { getBackendInfo, getMapsRegistry } from "../api/client.js";

/**
 * Global app state.
 *
 * Slices:
 *   backend       — health/MATLAB status (polled by Header)
 *   mapsRegistry  — cached payload of /api/maps/registry (loaded once)
 *   simulation    — current map + parameters (shared across pages)
 *   preferences   — user toggles (MATLAB-vs-NumPy etc.)
 */
export const useStore = create((set, get) => ({
  // ---------------- Backend status ----------------
  backend: {
    status: "unknown",
    matlabAvailable: false,
    matlabVersion: null,
    activeBackend: "numpy",
    lastCheckedAt: null,
    error: null,
  },
  setBackend: (partial) =>
    set((state) => ({ backend: { ...state.backend, ...partial } })),

  refreshBackend: async () => {
    try {
      const info = await getBackendInfo();
      set({
        backend: {
          status: "ok",
          matlabAvailable: info.matlab_available,
          matlabVersion: info.matlab_version,
          activeBackend: info.active_backend,
          lastCheckedAt: Date.now(),
          error: info.matlab_error || null,
        },
      });
    } catch (e) {
      set((state) => ({
        backend: {
          ...state.backend,
          status: "down",
          lastCheckedAt: Date.now(),
          error: e.message,
        },
      }));
    }
  },

  // ---------------- Maps registry (cached) ----------------
  mapsRegistry: null,           // null until first load completes
  mapsRegistryLoading: false,
  mapsRegistryError: null,

  loadMapsRegistry: async () => {
    if (get().mapsRegistry || get().mapsRegistryLoading) return;
    set({ mapsRegistryLoading: true, mapsRegistryError: null });
    try {
      const reg = await getMapsRegistry();
      set({ mapsRegistry: reg, mapsRegistryLoading: false });
    } catch (e) {
      set({ mapsRegistryLoading: false, mapsRegistryError: e.message });
    }
  },

  // ---------------- Simulation parameters ----------------
  simulation: {
    map: "logistic",
    parameters: { r: 3.9 },
    initialState: [0.31415],
    nSamples: 2000,
    customExpression: "",
  },
  setSimulation: (partial) =>
    set((state) => ({ simulation: { ...state.simulation, ...partial } })),

  // ---------------- Preferences ----------------
  preferences: {
    preferMatlab: true,
  },
  setPreferences: (partial) =>
    set((state) => ({ preferences: { ...state.preferences, ...partial } })),

  effectiveBackend: () => {
    const { preferences, backend } = get();
    return preferences.preferMatlab && backend.matlabAvailable ? "matlab" : "numpy";
  },
}));
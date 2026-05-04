import axios from "axios";

/**
 * Axios instance configured for the FastAPI backend.
 *
 * VITE_API_URL can be set in frontend/.env if the backend is hosted
 * elsewhere; defaults to localhost:8000 for development.
 */
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

// Light response interceptor so error messages bubble up cleanly to UI
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg =
      err.response?.data?.detail ||
      err.response?.data?.message ||
      err.message ||
      "Unknown backend error";
    return Promise.reject(new Error(msg));
  }
);

// ---------------------------------------------------------------------------
// Foundational endpoints
// ---------------------------------------------------------------------------
export async function getHealth() {
  const { data } = await api.get("/health");
  return data;
}

export async function getBackendInfo() {
  const { data } = await api.get("/backend-info");
  return data;
}

// ---------------------------------------------------------------------------
// Maps API
// ---------------------------------------------------------------------------
export async function getMapsRegistry() {
  const { data } = await api.get("/api/maps/registry");
  return data;
}

export async function postMapsOrbit(req) {
  const { data } = await api.post("/api/maps/orbit", req);
  return data;
}

export async function postMapsCobweb(req) {
  const { data } = await api.post("/api/maps/cobweb", req);
  return data;
}

// ---------------------------------------------------------------------------
// Bifurcation API
// ---------------------------------------------------------------------------
export async function getBifurcationExplainers() {
  const { data } = await api.get("/api/bifurcation/explainers");
  return data;
}

export async function postBifurcationSnapshot(req) {
  const { data } = await api.post("/api/bifurcation/snapshot", req);
  return data;
}

/** Fast vectorized λ(r) sweep — returns in <1s, no period detection. */
export async function postLyapunovSweep(req) {
  const { data } = await api.post("/api/bifurcation/lyapunov", req);
  return data;
}

/**
 * Full Feigenbaum analysis — SLOW (30-90s) because it probes individual
 * orbits sequentially.  Uses a 90s timeout instead of the default 30s.
 */
export async function postFeigenbaum(req) {
  const { data } = await api.post("/api/bifurcation/feigenbaum", req, {
    timeout: 90000,
  });
  return data;
}

// Raw base URL — used by the WebSocket client
export const API_BASE_URL = BASE_URL;
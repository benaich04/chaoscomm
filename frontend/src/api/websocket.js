import { API_BASE_URL } from "./client.js";

/**
 * Lightweight WebSocket helper for streaming computations.
 *
 * The FastAPI backend exposes WebSocket endpoints under /ws/* (e.g.
 * /ws/bifurcation, /ws/ber-monte-carlo) that emit a stream of:
 *   { type: "progress", pct: number, data: {...} }
 *   { type: "complete", data: {...} }
 *   { type: "error",    message: string }
 *
 * This class wraps the browser WebSocket, parses messages, and dispatches
 * to user-supplied callbacks. It is not used in Step 3 — only scaffolded
 * so the import path is stable when later modules need it.
 *
 * Usage (later):
 *   const stream = new ChaosWebSocket("/ws/bifurcation", {
 *     onProgress: ({ pct, data }) => updateChart(data, pct),
 *     onComplete: (data) => finalize(data),
 *     onError:    (msg) => toast(msg),
 *   });
 *   stream.connect({ map: "logistic", rMin: 2.5, rMax: 4.0 });
 */
export class ChaosWebSocket {
  constructor(path, { onProgress, onComplete, onError, onOpen, onClose } = {}) {
    this.path = path.startsWith("/") ? path : `/${path}`;
    this.callbacks = { onProgress, onComplete, onError, onOpen, onClose };
    this.ws = null;
  }

  /** Build the ws:// or wss:// URL from the configured HTTP base. */
  _wsUrl() {
    const httpUrl = new URL(API_BASE_URL);
    const proto = httpUrl.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${httpUrl.host}${this.path}`;
  }

  /**
   * Open the connection and send the parameter payload.
   * The backend reads the first message as the job spec.
   */
  connect(payload = {}) {
    this.ws = new WebSocket(this._wsUrl());

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify(payload));
      this.callbacks.onOpen?.();
    };

    this.ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); }
      catch {
        this.callbacks.onError?.("Malformed message from backend");
        return;
      }

      switch (msg.type) {
        case "progress": this.callbacks.onProgress?.(msg); break;
        case "complete": this.callbacks.onComplete?.(msg.data); break;
        case "error":    this.callbacks.onError?.(msg.message || "Backend error"); break;
        default: /* ignore unknown frame types */ break;
      }
    };

    this.ws.onerror = () => this.callbacks.onError?.("WebSocket connection error");
    this.ws.onclose = () => this.callbacks.onClose?.();
  }

  /** Send an arbitrary message to the open socket (e.g. cancel signal). */
  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /** Close the socket cleanly. */
  close() {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close();
    }
  }
}
import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE_URL } from "../api/client.js";

/**
 * useBifurcationStream — connect to /ws/bifurcation, accumulate chunks,
 * expose streaming state via React.
 *
 * Why a hook:
 *   The bifurcation chart accumulates 100k+ points across 30+ chunks.
 *   Pushing every chunk through React state would re-render the chart on
 *   every frame.  Instead, the hook calls `onChunk(chunk)` imperatively —
 *   the chart paints directly to its canvas without any reconciliation.
 *
 * Lifecycle:
 *   - Effect re-runs on `spec` change OR explicit `restart()` call.
 *   - WebSocket is closed on cleanup, so navigating away aborts the work.
 *
 * API:
 *   const { state, progress, meta, error, restart } =
 *     useBifurcationStream(spec, onChunk);
 *
 *   state:    "idle" | "connecting" | "streaming" | "complete" | "error"
 *   progress: 0..1 (based on chunks-received vs total_chunks from meta)
 *   meta:     { p_min, p_max, n_params, total_chunks, ... } | null
 *   error:    string | null
 *   restart:  () => void
 */
export function useBifurcationStream(spec, onChunk) {
  const [state, setState]       = useState("idle");
  const [meta, setMeta]         = useState(null);
  const [error, setError]       = useState(null);
  const [chunksReceived, setChunksReceived] = useState(0);
  const [tick, setTick]         = useState(0);

  const onChunkRef = useRef(onChunk);
  useEffect(() => { onChunkRef.current = onChunk; }, [onChunk]);

  const restart = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!spec) return;

    setState("connecting");
    setMeta(null);
    setError(null);
    setChunksReceived(0);

    const httpUrl = new URL(API_BASE_URL);
    const proto = httpUrl.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${httpUrl.host}/ws/bifurcation`;

    const ws = new WebSocket(wsUrl);
    let closedByUs = false;

    ws.onopen = () => {
      setState("streaming");
      ws.send(JSON.stringify(spec));
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); }
      catch { return; }

      if (msg.type === "meta") {
        setMeta(msg);
      } else if (msg.type === "chunk") {
        onChunkRef.current?.(msg);
        setChunksReceived((c) => c + 1);
      } else if (msg.type === "complete") {
        setState("complete");
      } else if (msg.type === "error") {
        setState("error");
        setError(msg.message || "Stream error");
      }
    };

    ws.onerror = () => {
      if (!closedByUs) { setState("error"); setError("WebSocket error"); }
    };

    ws.onclose = () => {
      // If we end up here without a "complete" message we leave state alone;
      // the user might have unmounted (closedByUs=true) or the server died.
    };

    return () => {
      closedByUs = true;
      if (ws.readyState !== WebSocket.CLOSED) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(spec), tick]);

  const progress = meta?.total_chunks
    ? Math.min(1, chunksReceived / meta.total_chunks)
    : 0;

  return { state, progress, meta, error, restart };
}
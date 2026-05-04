import { useEffect, useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * Renders a LaTeX string with KaTeX.
 *
 * Props:
 *   tex      — the LaTeX source (no surrounding $ or \[ \])
 *   block    — true → display mode (centred, larger); false → inline
 *   className — additional Tailwind classes for the wrapping element
 *
 * Designed so any equation that KaTeX cannot parse falls back to a
 * monospace string instead of crashing the page.
 */
export default function EquationDisplay({ tex, block = false, className = "" }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      katex.render(tex || "", ref.current, {
        displayMode: block,
        throwOnError: false,
        errorColor: "#ef4444",
        strict: "ignore",
      });
    } catch {
      ref.current.textContent = tex || "";
    }
  }, [tex, block]);

  const Tag = block ? "div" : "span";
  return (
    <Tag
      ref={ref}
      className={[
        block ? "katex-block py-1" : "katex-inline",
        className,
      ].join(" ")}
    />
  );
}
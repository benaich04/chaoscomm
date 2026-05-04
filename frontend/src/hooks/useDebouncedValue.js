import { useEffect, useState } from "react";

/**
 * useDebouncedValue — return a value that lags behind the live one by `delay`ms.
 *
 * Used by parameter sliders so we only fire an API request once the user
 * stops dragging.  Pure utility, no dependencies.
 */
export function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
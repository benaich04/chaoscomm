"""
MATLAB Engine wrapper — singleton with lazy startup and graceful fallback.

Design goals:
  1. Probing for MATLAB availability must be FAST (no engine start).
     Used at FastAPI startup so /backend-info returns instantly.
  2. The actual MATLAB engine is heavy (10-15s to boot) and uses ~500MB
     of RAM. We start it lazily on first use, not at server startup.
  3. If MATLAB is unavailable, the wrapper raises MatlabUnavailable so
     callers (in core/*.py) can catch it and fall back to NumPy/SciPy
     transparently.
  4. The engine is reused across requests — starting one per request
     would be unusable. A simple module-level singleton suffices since
     FastAPI runs one process per worker and MATLAB calls are blocking
     anyway (we wrap them in run_in_executor at the route level).
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Optional

import numpy as np

logger = logging.getLogger(__name__)


def _to_numpy(obj: Any) -> Any:
    """
    Convert MATLAB-engine return types to Python/NumPy equivalents.

    matlab.double / matlab.int* / matlab.logical → np.ndarray
    dict (struct)                                → dict (recursed)
    list / tuple                                 → list (recursed)
    everything else                              → unchanged
    """
    # Lazy import — only available when matlab.engine itself is available.
    try:
        import matlab
    except ImportError:
        matlab = None  # noqa: F841

    if matlab is not None:
        # matlab.double, matlab.int*, etc. all share a common base behaviour:
        # they support iteration / size and can be converted via numpy.array.
        # Rather than hard-coding type names, we duck-type the conversion.
        if hasattr(obj, "_size") or type(obj).__module__.startswith("matlab"):
            try:
                return np.array(obj)
            except Exception:
                return obj

    if isinstance(obj, dict):
        return {k: _to_numpy(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_numpy(v) for v in obj]
    return obj


class MatlabUnavailable(RuntimeError):
    """Raised when MATLAB backend is requested but not available."""


class MatlabEngineWrapper:
    """
    Holds at most one MATLAB engine for the process lifetime.

    Public attributes (set after probe()):
        available (bool):       True iff `import matlab.engine` succeeded.
        version (str | None):   MATLAB release string, or None.
        error_message (str|None): Reason MATLAB is unavailable, or None.

    Public methods:
        probe()      — fast import-only check, called at app startup.
        get_engine() — returns a started engine or raises MatlabUnavailable.
        shutdown()   — cleanly stops the engine if running.
    """

    def __init__(self) -> None:
        self.available: bool = False
        self.version: Optional[str] = None
        self.error_message: Optional[str] = None
        self._engine = None
        self._lock = threading.Lock()  # guards engine creation

    # ------------------------------------------------------------------
    # Probe — fast, no engine start
    # ------------------------------------------------------------------
    def probe(self) -> None:
        """
        Attempt to import matlab.engine. This is cheap (~50ms) and tells
        us whether the matlabengine package is installed AND its native
        libraries can be loaded. We do NOT start an engine here.
        """
        try:
            import matlab.engine  # noqa: F401
        except ImportError as e:
            self.available = False
            self.error_message = f"matlab.engine not importable: {e}"
            logger.info("MATLAB backend unavailable: %s", self.error_message)
            return
        except Exception as e:
            # Native library load failures, license issues, etc.
            self.available = False
            self.error_message = f"matlab.engine import raised: {type(e).__name__}: {e}"
            logger.warning("MATLAB backend probe failed: %s", self.error_message)
            return

        self.available = True
        # Defer version detection until engine is actually started — it
        # requires a running engine. Leave version None for now; populated
        # on first get_engine() call.
        self.version = "unknown (engine not yet started)"
        logger.info("MATLAB backend available (engine import succeeded).")

    # ------------------------------------------------------------------
    # Engine accessor — lazy start, thread-safe
    # ------------------------------------------------------------------
    def get_engine(self):
        """
        Returns a running MATLAB engine, starting it on first call.
        Raises MatlabUnavailable if the probe determined MATLAB is missing.
        """
        if not self.available:
            raise MatlabUnavailable(self.error_message or "MATLAB not available")

        if self._engine is not None:
            return self._engine

        with self._lock:
            # Double-checked locking — another thread may have started it.
            if self._engine is not None:
                return self._engine

            try:
                import matlab.engine
                logger.info("Starting MATLAB engine (this takes 10-15s)...")
                self._engine = matlab.engine.start_matlab()
                # Now that engine is up, we can fetch the real version
                try:
                    self.version = self._engine.version()
                except Exception:
                    self.version = "started (version query failed)"
                # Add this package's directory to the MATLAB path so the
                # .m scripts ship alongside Python code can be called.
                try:
                    import os
                    mfile_dir = os.path.dirname(os.path.abspath(__file__))
                    self._engine.addpath(mfile_dir, nargout=0)
                except Exception as e:
                    logger.warning("Failed to add MATLAB path: %s", e)
                logger.info("MATLAB engine started: %s", self.version)
            except Exception as e:
                self.available = False
                self.error_message = f"engine start failed: {type(e).__name__}: {e}"
                logger.error("MATLAB engine failed to start: %s", self.error_message)
                raise MatlabUnavailable(self.error_message) from e

        return self._engine

    # ------------------------------------------------------------------
    # Convenience: call a MATLAB function and return numpy-friendly output
    # ------------------------------------------------------------------
    def call(self, function_name: str, *args, nargout: int = 1):
        """
        Run a MATLAB function and convert its output to native Python /
        NumPy types where possible.

        Returns whatever MATLAB returned, with the following conversions:
          - matlab.double / matlab.int*  →  numpy.ndarray
          - struct fields                →  dict (recursively)
          - everything else              →  unchanged
        """
        eng = self.get_engine()
        fn = getattr(eng, function_name)
        result = fn(*args, nargout=nargout)
        return _to_numpy(result)

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------
    def shutdown(self) -> None:
        """Cleanly stop the engine if running. Safe to call multiple times."""
        with self._lock:
            if self._engine is not None:
                try:
                    self._engine.quit()
                    logger.info("MATLAB engine shut down.")
                except Exception as e:
                    logger.warning("Error during MATLAB shutdown: %s", e)
                finally:
                    self._engine = None
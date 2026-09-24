import { useEffect, useState } from 'react';
import { biomeAt, type BiomeState } from './biome';

/**
 * The biome, as React state.
 *
 * Re-renders only when the ground actually changes — a handful of times a
 * cycle — rather than sampling the clock on a cadence of its own. The SVG
 * views repaint from it; the 3D scene reads `biomeAt` directly on its frame
 * loop and never re-renders at all.
 */
export function useBiome(): BiomeState {
  const [state, setState] = useState<BiomeState>(() => biomeAt(Date.now()));
  useEffect(() => {
    let timer: number;
    const arm = () => {
      const next = biomeAt(Date.now());
      setState(next);
      timer = window.setTimeout(arm, Math.max(250, next.changesAt - Date.now() + 60));
    };
    arm();
    return () => clearTimeout(timer);
  }, []);
  return state;
}

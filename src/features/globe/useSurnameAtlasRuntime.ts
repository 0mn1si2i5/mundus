import { useEffect, useState } from 'react';

export type SurnameAtlasRuntime = typeof import('./surnameAtlasRuntime');

let runtimePromise: Promise<SurnameAtlasRuntime> | null = null;

function loadSurnameAtlasRuntime(): Promise<SurnameAtlasRuntime> {
  runtimePromise ??= import('./surnameAtlasRuntime').catch((error) => {
    // Allow a later activation to retry after a failed chunk request.
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

/** Loads the surname-only geometry and slot runtime once it is needed. */
export function useSurnameAtlasRuntime(
  active: boolean,
): SurnameAtlasRuntime | null {
  const [runtime, setRuntime] = useState<SurnameAtlasRuntime | null>(null);

  useEffect(() => {
    if (!active || runtime) return;
    let current = true;
    loadSurnameAtlasRuntime().then(
      (loaded) => {
        if (current) setRuntime(loaded);
      },
      (error: unknown) => {
        console.error('Surname Atlas geometry failed to load', error);
      },
    );
    return () => {
      current = false;
    };
  }, [active, runtime]);

  return runtime;
}

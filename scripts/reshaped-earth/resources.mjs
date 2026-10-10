import { execFileSync } from 'node:child_process';

function systemMemory() {
  if (process.platform !== 'darwin')
    return { swapMiB: null, freePercent: null };
  const swap = execFileSync('sysctl', ['-n', 'vm.swapusage'], {
    encoding: 'utf8',
  });
  const pressure = execFileSync('memory_pressure', ['-Q'], {
    encoding: 'utf8',
  });
  return {
    swapMiB: Number(swap.match(/used = ([\d.]+)M/)[1]),
    freePercent: Number(pressure.match(/free percentage: (\d+)%/)[1]),
  };
}

/** One computation at a time; report machine-wide swap against the approved baseline. */
export function resourceMonitor(phase, { maxRSS = 1.5 * 1024 ** 3 } = {}) {
  const start = performance.now();
  const initial = systemMemory();
  const swapBaseline = Math.max(
    initial.swapMiB ?? 0,
    Number(process.env.MUNDUS_RESHAPED_SWAP_BASELINE_MIB ?? 9554.25),
  );
  let lastCheck = -Infinity;
  let peakRSS = 0;
  let peakSwapMiB = initial.swapMiB;
  function progress(detail = {}, force = false) {
    const seconds = (performance.now() - start) / 1000;
    const rss = process.memoryUsage().rss;
    peakRSS = Math.max(peakRSS, rss);
    if (rss > maxRSS || seconds > 1800)
      throw new Error(`S3: ${phase}: RSS ${rss}, elapsed ${seconds}s`);
    if (!force && seconds - lastCheck < 5) return;
    lastCheck = seconds;
    const memory = systemMemory();
    peakSwapMiB = Math.max(peakSwapMiB ?? 0, memory.swapMiB ?? 0);
    console.log(
      JSON.stringify({
        ...detail,
        phase,
        seconds,
        rss,
        peakRSS,
        swapBaselineMiB: swapBaseline,
        ...memory,
      }),
    );
    // Swap can fluctuate when unrelated apps recover pages. Bound the job's
    // own RSS and stop on material additional swap or machine memory pressure.
    if (
      (memory.swapMiB != null && memory.swapMiB > swapBaseline + 1024) ||
      (memory.freePercent != null && memory.freePercent < 20)
    )
      throw new Error(`S3: ${phase}: additional swap or memory pressure`);
  }
  progress({}, true);
  return {
    progress,
    finish() {
      progress({ complete: true }, true);
      return {
        phase,
        seconds: (performance.now() - start) / 1000,
        peakRSS,
        swapBaselineMiB: swapBaseline,
        peakSwapMiB,
      };
    },
  };
}

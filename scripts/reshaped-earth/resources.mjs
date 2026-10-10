import { execFileSync } from 'node:child_process';

const GiB = 1024 ** 3;
export function resourceStopReason({
  peakRSS,
  swapMiB,
  swapBaselineMiB,
  critical,
  seconds,
}) {
  if (peakRSS > 4 * GiB) return 'process RSS exceeds 4 GiB';
  if (peakRSS > 2 * GiB && swapMiB !== null && swapMiB - swapBaselineMiB > 1024)
    return 'process RSS exceeds 2 GiB and swap grew by more than 1 GiB';
  if (critical) return 'macOS memory pressure is critical';
  if (seconds > 1800) return 'step exceeds 30 minutes';
  return null;
}
function systemMemory() {
  if (process.platform !== 'darwin')
    return {
      swapMiB: null,
      swapFreeMiB: null,
      freePercent: null,
      critical: false,
    };
  const swap = execFileSync('sysctl', ['-n', 'vm.swapusage'], {
    encoding: 'utf8',
  });
  const pressure = execFileSync('memory_pressure', ['-Q'], {
    encoding: 'utf8',
  });
  const pressureLevel = Number(
    execFileSync('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], {
      encoding: 'utf8',
    }),
  );
  return {
    swapMiB: Number(swap.match(/used = ([\d.]+)M/)[1]),
    swapFreeMiB: Number(swap.match(/free = ([\d.]+)M/)[1]),
    freePercent: Number(pressure.match(/free percentage: (\d+)%/)[1]),
    pressureLevel,
    critical: pressureLevel >= 4 || /critical/i.test(pressure),
  };
}

/** Single-process jobs; machine swap alone is recorded, never attributed to this job. */
export function resourceMonitor(phase) {
  const start = performance.now(),
    initial = systemMemory();
  if (initial.swapFreeMiB !== null && initial.swapFreeMiB < 256)
    throw new Error(
      `S3: ${phase}: swap free ${initial.swapFreeMiB} MiB <256; close other applications before a new computation`,
    );
  const swapBaselineMiB = initial.swapMiB ?? 0;
  let lastCheck = -Infinity,
    peakRSS = 0,
    peakSwapMiB = initial.swapMiB;
  function progress(detail = {}, force = false) {
    const seconds = (performance.now() - start) / 1000,
      rss = process.memoryUsage().rss;
    peakRSS = Math.max(peakRSS, rss, process.resourceUsage().maxRSS * 1024);
    if (
      !force &&
      seconds - lastCheck < 5 &&
      peakRSS <= 4 * GiB &&
      seconds <= 1800
    )
      return;
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
        swapBaselineMiB,
        ...memory,
      }),
    );
    const reason = resourceStopReason({
      peakRSS,
      swapBaselineMiB,
      seconds,
      ...memory,
    });
    if (reason) throw new Error(`S3: ${phase}: ${reason}`);
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
        swapBaselineMiB,
        peakSwapMiB,
      };
    },
  };
}

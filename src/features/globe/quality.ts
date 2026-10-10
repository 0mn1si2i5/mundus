export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityProfile {
  level: QualityLevel;
  dpr: [number, number];
  textureWidth: 1024 | 2048;
  vectorDetail: '110m' | '50m';
  sphereSegments: [number, number];
  starCount: number;
}

interface DeviceSignals {
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  hardwareConcurrency: number;
}

export function chooseQualityProfile(signals: DeviceSignals): QualityProfile {
  const constrained =
    signals.viewportWidth <= 760 ||
    // A phone-class short edge stays within the low GPU and transfer ceiling.
    Math.min(signals.viewportWidth, signals.viewportHeight) <= 480 ||
    signals.hardwareConcurrency <= 4;
  const highDensityDesktop =
    !constrained &&
    signals.viewportWidth >= 1280 &&
    signals.hardwareConcurrency >= 8;

  if (constrained) {
    return {
      level: 'low',
      dpr: [1, Math.min(1.25, signals.devicePixelRatio)],
      textureWidth: 1024,
      vectorDetail: '110m',
      sphereSegments: [64, 40],
      starCount: 280,
    };
  }

  if (highDensityDesktop) {
    return {
      level: 'high',
      dpr: [1, Math.min(1.75, signals.devicePixelRatio)],
      textureWidth: 2048,
      vectorDetail: '50m',
      sphereSegments: [96, 64],
      starCount: 550,
    };
  }

  return {
    level: 'medium',
    dpr: [1, Math.min(1.5, signals.devicePixelRatio)],
    textureWidth: 2048,
    vectorDetail: '50m',
    sphereSegments: [80, 48],
    starCount: 400,
  };
}

export function detectQualityProfile(): QualityProfile {
  return chooseQualityProfile({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    hardwareConcurrency: navigator.hardwareConcurrency || 4,
  });
}

let runtimeQualityProfile: QualityProfile | undefined;

/** Keep decoded mode assets and the Canvas on the same initial quality. */
export function getRuntimeQualityProfile(): QualityProfile {
  return (runtimeQualityProfile ??= detectQualityProfile());
}

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid colour: ${hex}`);
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

function linear(value: number) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function srgb(value: number) {
  return value <= 0.0031308
    ? value * 12.92
    : 1.055 * value ** (1 / 2.4) - 0.055;
}

export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
  );
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

function lab(rgb: Rgb): [number, number, number] {
  const r = linear(rgb[0]);
  const g = linear(rgb[1]);
  const b = linear(rgb[2]);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (value: number) =>
    value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIELCh in degrees, using the same D65 CIELAB conversion as ΔE00. */
export function rgbToLch(rgb: Rgb): [number, number, number] {
  const [lightness, a, b] = lab(rgb);
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return [lightness, Math.hypot(a, b), (hue + 360) % 360];
}

export function hueDifference(first: number, second: number): number {
  const difference = Math.abs(first - second) % 360;
  return Math.min(difference, 360 - difference);
}

/** The map shader blends casing in linear RGB before sRGB output conversion. */
export function compositeLinear(
  foreground: Rgb,
  background: Rgb,
  opacity: number,
): Rgb {
  return foreground.map((value, channel) =>
    srgb(
      linear(value) * opacity + linear(background[channel]!) * (1 - opacity),
    ),
  ) as Rgb;
}

export function deltaE2000(first: Rgb, second: Rgb): number {
  return deltaE2000Lab(lab(first), lab(second));
}

export function deltaE2000Lab(first: Rgb, second: Rgb): number {
  const [l1, a1, b1] = first;
  const [l2, a2, b2] = second;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a1;
  const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hp = (a: number, b: number) => {
    const angle = (Math.atan2(b, a) * 180) / Math.PI;
    return angle < 0 ? angle + 360 : angle;
  };
  const h1 = hp(ap1, b1);
  const h2 = hp(ap2, b2);
  const dL = l2 - l1;
  const dC = cp2 - cp1;
  let dh = h2 - h1;
  if (cp1 * cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh * Math.PI) / 360);
  const lBar = (l1 + l2) / 2;
  const cBarP = (cp1 + cp2) / 2;
  let hBar = h1 + h2;
  if (cp1 * cp2 === 0) hBar = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) hBar /= 2;
  else hBar = (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2;
  const t =
    1 -
    0.17 * Math.cos(((hBar - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hBar * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hBar + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hBar - 63) * Math.PI) / 180);
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt =
    -2 *
    Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7)) *
    Math.sin((60 * Math.exp(-(((hBar - 275) / 25) ** 2)) * Math.PI) / 180);
  return Math.sqrt(
    (dL / sl) ** 2 +
      (dC / sc) ** 2 +
      (dH / sh) ** 2 +
      rt * (dC / sc) * (dH / sh),
  );
}

const COLOR_BLIND_MATRICES = {
  protan: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882,
    -0.048116, 1.051998,
  ],
  deutan: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182,
    0.04294, 0.968881,
  ],
  tritan: [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733,
    0.691367, 0.3039,
  ],
} as const;

export type ColorBlindMode = keyof typeof COLOR_BLIND_MATRICES;

export function simulateColorBlind(rgb: Rgb, mode: ColorBlindMode): Rgb {
  const matrix = COLOR_BLIND_MATRICES[mode];
  const channels = rgb.map(linear);
  return [
    srgb(
      Math.max(
        0,
        Math.min(
          1,
          matrix[0] * channels[0]! +
            matrix[1] * channels[1]! +
            matrix[2] * channels[2]!,
        ),
      ),
    ),
    srgb(
      Math.max(
        0,
        Math.min(
          1,
          matrix[3] * channels[0]! +
            matrix[4] * channels[1]! +
            matrix[5] * channels[2]!,
        ),
      ),
    ),
    srgb(
      Math.max(
        0,
        Math.min(
          1,
          matrix[6] * channels[0]! +
            matrix[7] * channels[1]! +
            matrix[8] * channels[2]!,
        ),
      ),
    ),
  ];
}

export function desaturate(rgb: Rgb, amount = 0.7): Rgb {
  const grey = relativeLuminance(rgb);
  return rgb.map((value) =>
    srgb((linear(value) * (1 - amount) + grey * amount) * 0.85 + 0.15),
  ) as Rgb;
}

/** Shader lighting multiplies linear RGB before conversion to sRGB. */
export function applyLinearLight(rgb: Rgb, factor: number): Rgb {
  return rgb.map((value) => srgb(Math.min(1, linear(value) * factor))) as Rgb;
}

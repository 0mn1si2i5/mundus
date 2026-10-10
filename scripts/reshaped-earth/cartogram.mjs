/**
 * Density-equalizing flows on a cylindrical equal-area grid: x is periodic
 * (FFT); y is reflecting (cell-centred DCT-II). `diffusion` uses analytic heat
 * evolution rho_k(t)=rho_k(0) exp(-|k|^2 t), v=-grad(rho)/rho. `gsm2018` uses
 * Gastner, Seguy & More's linear density path rho(t)=(1-t)rho0+t*rhoMean,
 * with a time-independent flux solving div(J)=rho0-rhoMean and v=J/rho(t).
 * No runtime renderer or third-party numerical library is used here.
 */

const EPSILON = 1e-12;
const TAU = 2 * Math.PI;

function assertPowerOfTwo(value, name = 'length') {
  if (!Number.isInteger(value) || value < 1 || (value & (value - 1)) !== 0) {
    throw new RangeError(`${name} must be a positive power of two`);
  }
}

function asFloat64(values, name = 'values') {
  if (values == null || typeof values.length !== 'number') {
    throw new TypeError(`${name} must be an array-like value`);
  }
  return Float64Array.from(values);
}

function fftPlan(n) {
  assertPowerOfTwo(n);
  const reversed = new Uint32Array(n);
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    reversed[i] = j;
  }
  const cosine = new Float64Array(n / 2);
  const sine = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k += 1) {
    cosine[k] = Math.cos((TAU * k) / n);
    sine[k] = Math.sin((TAU * k) / n);
  }
  return { n, reversed, cosine, sine };
}

function fftInPlace(real, imag, plan, inverse = false) {
  const { n, reversed, cosine, sine } = plan;
  for (let i = 0; i < n; i += 1) {
    const j = reversed[i];
    if (i >= j) continue;
    const r = real[i];
    real[i] = real[j];
    real[j] = r;
    const v = imag[i];
    imag[i] = imag[j];
    imag[j] = v;
  }
  for (let length = 2; length <= n; length *= 2) {
    const half = length / 2;
    const stride = n / length;
    for (let start = 0; start < n; start += length) {
      for (let k = 0; k < half; k += 1) {
        const a = start + k;
        const b = a + half;
        const wr = cosine[k * stride];
        const wi = (inverse ? 1 : -1) * sine[k * stride];
        const r = wr * real[b] - wi * imag[b];
        const v = wr * imag[b] + wi * real[b];
        real[b] = real[a] - r;
        imag[b] = imag[a] - v;
        real[a] += r;
        imag[a] += v;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      real[i] /= n;
      imag[i] /= n;
    }
  }
}

/** Radix-2 complex FFT, with inverse 1/N normalisation; inputs are copied. */
export function fftRadix2(
  realInput,
  imaginaryOrInverse = false,
  inverse = false,
) {
  let real;
  let imag;
  if (realInput && typeof realInput === 'object' && 'real' in realInput) {
    real = asFloat64(realInput.real, 'real');
    imag = asFloat64(realInput.imag ?? realInput.imaginary, 'imag');
    inverse = Boolean(imaginaryOrInverse);
  } else {
    real = asFloat64(realInput, 'real');
    if (typeof imaginaryOrInverse === 'boolean') {
      inverse = imaginaryOrInverse;
      imag = new Float64Array(real.length);
    } else {
      imag = asFloat64(imaginaryOrInverse, 'imag');
    }
  }
  if (real.length !== imag.length)
    throw new RangeError('real and imag lengths differ');
  fftInPlace(real, imag, fftPlan(real.length), inverse);
  return { real, imag, imaginary: imag };
}

export function ifftRadix2(spectrum, imaginary) {
  return (
    imaginary === undefined
      ? fftRadix2(spectrum, true)
      : fftRadix2(spectrum, imaginary, true)
  ).real;
}

export const fft = fftRadix2;
export const inverseFft = ifftRadix2;

/** Small direct DFT for numerical reference checks. */
export function dft(values, inverse = false) {
  const input = asFloat64(values);
  const n = input.length;
  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    for (let i = 0; i < n; i += 1) {
      const angle = ((inverse ? 1 : -1) * TAU * k * i) / n;
      real[k] += input[i] * Math.cos(angle);
      imag[k] += input[i] * Math.sin(angle);
    }
    if (inverse) {
      real[k] /= n;
      imag[k] /= n;
    }
  }
  return { real, imag, imaginary: imag };
}

function dctPlan(n) {
  const plan = fftPlan(n);
  plan.phaseCos = new Float64Array(n);
  plan.phaseSin = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    plan.phaseCos[k] = Math.cos((Math.PI * k) / (2 * n));
    plan.phaseSin[k] = Math.sin((Math.PI * k) / (2 * n));
  }
  return plan;
}

// Reorder even samples forwards and odd samples backwards, then FFT. This
// implements complex-linear DCT-II/III with N, rather than 2N, FFT samples.
function dctComplex(real, imag, plan, inverse, workReal, workImag) {
  const { n, phaseCos, phaseSin } = plan;
  if (!inverse) {
    for (let j = 0; j < n / 2; j += 1) {
      workReal[j] = real[2 * j];
      workImag[j] = imag[2 * j];
      workReal[n - 1 - j] = real[2 * j + 1];
      workImag[n - 1 - j] = imag[2 * j + 1];
    }
    if (n === 1) {
      workReal[0] = real[0];
      workImag[0] = imag[0];
    }
    fftInPlace(workReal, workImag, plan);
    real[0] = 2 * workReal[0];
    imag[0] = 2 * workImag[0];
    for (let k = 1; k < n; k += 1) {
      const c = phaseCos[k];
      const s = phaseSin[k];
      real[k] =
        c * (workReal[k] + workReal[n - k]) +
        s * (workImag[k] - workImag[n - k]);
      imag[k] =
        c * (workImag[k] + workImag[n - k]) +
        s * (workReal[n - k] - workReal[k]);
    }
  } else {
    workReal[0] = real[0] / 2;
    workImag[0] = imag[0] / 2;
    for (let k = 1; k < n; k += 1) {
      const a = (real[k] + imag[n - k]) / 2;
      const b = (imag[k] - real[n - k]) / 2;
      workReal[k] = a * phaseCos[k] - b * phaseSin[k];
      workImag[k] = a * phaseSin[k] + b * phaseCos[k];
    }
    fftInPlace(workReal, workImag, plan, true);
    for (let j = 0; j < n / 2; j += 1) {
      real[2 * j] = workReal[j];
      imag[2 * j] = workImag[j];
      real[2 * j + 1] = workReal[n - 1 - j];
      imag[2 * j + 1] = workImag[n - 1 - j];
    }
    if (n === 1) {
      real[0] = workReal[0];
      imag[0] = workImag[0];
    }
  }
}

/** O(N log N) DCT-II: C_k = 2 sum_i f_i cos(pi (i+.5) k/N). */
export function dct(values) {
  const real = asFloat64(values);
  if (!real.length) return real;
  dctComplex(
    real,
    new Float64Array(real.length),
    dctPlan(real.length),
    false,
    new Float64Array(real.length),
    new Float64Array(real.length),
  );
  return real;
}

/** Inverse of {@link dct}, with C_0/(2N) normalisation. */
export function idct(values) {
  const real = asFloat64(values);
  if (!real.length) return real;
  dctComplex(
    real,
    new Float64Array(real.length),
    dctPlan(real.length),
    true,
    new Float64Array(real.length),
    new Float64Array(real.length),
  );
  return real;
}

export const dct2 = dct;
export const idct2 = idct;
export const dctTransform = dct;
export const inverseDct = idct;

export function fft2d(values, width, height, inverse = false) {
  assertPowerOfTwo(width, 'width');
  assertPowerOfTwo(height, 'height');
  const real = asFloat64(values?.real ?? values);
  const imag = values?.imag
    ? asFloat64(values.imag)
    : new Float64Array(real.length);
  if (real.length !== width * height || imag.length !== real.length)
    throw new RangeError('2D FFT input size mismatch');
  const xp = fftPlan(width);
  const yp = fftPlan(height);
  for (let y = 0; y < height; y += 1)
    fftInPlace(
      real.subarray(y * width, (y + 1) * width),
      imag.subarray(y * width, (y + 1) * width),
      xp,
      inverse,
    );
  const cr = new Float64Array(height);
  const ci = new Float64Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      cr[y] = real[y * width + x];
      ci[y] = imag[y * width + x];
    }
    fftInPlace(cr, ci, yp, inverse);
    for (let y = 0; y < height; y += 1) {
      real[y * width + x] = cr[y];
      imag[y * width + x] = ci[y];
    }
  }
  return { real, imag, imaginary: imag, width, height };
}

function assertDensityGrid(density, width, height) {
  assertPowerOfTwo(width, 'width');
  assertPowerOfTwo(height, 'height');
  if (width < 2 || height < 2)
    throw new RangeError('cartogram dimensions must be >= 2');
  if (!density || density.length !== width * height)
    throw new RangeError('density grid size mismatch');
  const clean = Float64Array.from(density, (value) => {
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError('density values must be finite and non-negative');
    return value;
  });
  const sum = clean.reduce((total, value) => total + value, 0);
  if (!(sum > 0)) throw new RangeError('density grid must have positive mass');
  return { clean, sum };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value)));
}
function wrap01(value) {
  return value - Math.floor(value);
}

/**
 * Analytic mixed-boundary heat solver. Both gradients are spectral: y uses
 * sin(k theta) = (-1)^j cos((N-k) theta) at the DCT's sample centres.
 * The returned velocity components are in normalised coordinates / time.
 */
function createSpectralSolver({
  width,
  height,
  density,
  blurSigma = 0.5,
  domainWidth = TAU,
  domainHeight = 2,
  zeroDensityFloor = 0.01,
} = {}) {
  const { clean, sum } = assertDensityGrid(density, width, height);
  if (
    !Number.isFinite(domainWidth) ||
    !Number.isFinite(domainHeight) ||
    !Number.isFinite(blurSigma) ||
    !Number.isFinite(zeroDensityFloor) ||
    !(domainWidth > 0) ||
    !(domainHeight > 0) ||
    blurSigma < 0 ||
    zeroDensityFloor < 0
  )
    throw new RangeError('invalid diffusion domain, blur or density floor');
  const mean = sum / clean.length;
  let flooredCells = 0;
  for (let i = 0; i < clean.length; i += 1) {
    if (clean[i] === 0) {
      clean[i] = zeroDensityFloor * mean;
      flooredCells += 1;
    }
  }
  const floorMean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const xp = fftPlan(width);
  const yp = dctPlan(height);
  const spectrumReal = Float64Array.from(clean, (v) => v / floorMean);
  const spectrumImag = new Float64Array(clean.length);
  const cr = new Float64Array(height);
  const ci = new Float64Array(height);
  const wr = new Float64Array(height);
  const wi = new Float64Array(height);
  const dr = new Float64Array(height);
  const di = new Float64Array(height);
  for (let y = 0; y < height; y += 1)
    fftInPlace(
      spectrumReal.subarray(y * width, (y + 1) * width),
      spectrumImag.subarray(y * width, (y + 1) * width),
      xp,
    );
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      cr[y] = spectrumReal[y * width + x];
      ci[y] = spectrumImag[y * width + x];
    }
    dctComplex(cr, ci, yp, false, wr, wi);
    for (let y = 0; y < height; y += 1) {
      const kx = x <= width / 2 ? x : x - width;
      const blur = Math.exp(
        -0.5 *
          blurSigma ** 2 *
          (((TAU * kx) / width) ** 2 + ((Math.PI * y) / height) ** 2),
      );
      spectrumReal[y * width + x] = cr[y] * blur;
      spectrumImag[y * width + x] = ci[y] * blur;
    }
  }
  // These work arrays are reused across evaluations, but returned velocity
  // arrays are independent so a predictor/corrector may retain two fields.
  const real = new Float64Array(clean.length);
  const imag = new Float64Array(clean.length);
  const gradYReal = new Float64Array(clean.length);
  const gradYImag = new Float64Array(clean.length);
  const kxSquared = Float64Array.from(
    { length: width },
    (_, x) => ((TAU * (x <= width / 2 ? x : x - width)) / domainWidth) ** 2,
  );
  const kySquared = Float64Array.from(
    { length: height },
    (_, y) => ((Math.PI * y) / domainHeight) ** 2,
  );
  let evaluations = 0;
  function reconstruct(time, poisson = false) {
    if (!Number.isFinite(time) || time < 0)
      throw new RangeError('diffusion time must be finite and non-negative');
    const decayX = Float64Array.from(kxSquared, (k) => Math.exp(-k * time));
    const decayY = Float64Array.from(kySquared, (k) => Math.exp(-k * time));
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        const i = y * width + x;
        const squaredFrequency = kxSquared[x] + kySquared[y];
        const decay = poisson
          ? squaredFrequency > 0
            ? 1 / squaredFrequency
            : 0
          : decayX[x] * decayY[y];
        cr[y] = spectrumReal[i] * decay;
        ci[y] = spectrumImag[i] * decay;
      }
      dr[0] = 0;
      di[0] = 0;
      for (let y = 1; y < height; y += 1) {
        // Physical gradient divided once more by Ly converts dy/dt to the
        // normalised y coordinate used by the transport mesh.
        const factor = -(Math.PI * y) / domainHeight ** 2;
        dr[height - y] = cr[y] * factor;
        di[height - y] = ci[y] * factor;
      }
      dctComplex(cr, ci, yp, true, wr, wi);
      dctComplex(dr, di, yp, true, wr, wi);
      for (let y = 0; y < height; y += 1) {
        const i = y * width + x;
        real[i] = cr[y];
        imag[i] = ci[y];
        gradYReal[i] = (y & 1 ? -1 : 1) * dr[y];
        gradYImag[i] = (y & 1 ? -1 : 1) * di[y];
      }
    }
    const rho = new Float64Array(clean.length);
    const vx = new Float64Array(clean.length);
    const vy = new Float64Array(clean.length);
    const xr = new Float64Array(width);
    const xi = new Float64Array(width);
    let maxSpeed = 0;
    let minimumDensity = Infinity;
    let maximumDensity = -Infinity;
    for (let y = 0; y < height; y += 1) {
      const start = y * width;
      for (let x = 0; x < width; x += 1) {
        const factor =
          x === width / 2
            ? 0
            : (TAU * (x < width / 2 ? x : x - width)) / domainWidth ** 2;
        xr[x] = -imag[start + x] * factor;
        xi[x] = real[start + x] * factor;
      }
      fftInPlace(xr, xi, xp, true);
      fftInPlace(
        real.subarray(start, start + width),
        imag.subarray(start, start + width),
        xp,
        true,
      );
      fftInPlace(
        gradYReal.subarray(start, start + width),
        gradYImag.subarray(start, start + width),
        xp,
        true,
      );
      for (let x = 0; x < width; x += 1) {
        const i = start + x;
        rho[i] = real[i];
        minimumDensity = Math.min(minimumDensity, rho[i]);
        maximumDensity = Math.max(maximumDensity, rho[i]);
        if (!poisson && !(rho[i] > 0))
          throw new Error(
            `Spectral density became non-positive at t=${time}, cell ${i}; increase blur or the density floor`,
          );
        vx[i] = poisson ? -xr[x] : -xr[x] / rho[i];
        vy[i] = poisson ? -gradYReal[i] : -gradYReal[i] / rho[i];
        maxSpeed = Math.max(maxSpeed, Math.hypot(vx[i], vy[i]));
      }
    }
    evaluations += 1;
    return { rho, vx, vy, time, maxSpeed, minimumDensity, maximumDensity };
  }
  return {
    width,
    height,
    mean: floorMean,
    flooredCells,
    evaluate: (time) => reconstruct(time),
    evaluateFlux: () => reconstruct(0, true),
    get evaluations() {
      return evaluations;
    },
  };
}

export function createDiffusionSolver(options = {}) {
  const solver = createSpectralSolver(options);
  return {
    width: solver.width,
    height: solver.height,
    mean: solver.mean,
    flooredCells: solver.flooredCells,
    evaluate: solver.evaluate,
    get evaluations() {
      return solver.evaluations;
    },
  };
}

function sampleScalar(values, width, height, x, y) {
  const px = wrap01(x) * width - 0.5;
  const baseX = Math.floor(px);
  const x0 = ((baseX % width) + width) % width;
  const x1 = (x0 + 1) % width;
  const fx = px - baseX;
  const py = clamp01(y) * height - 0.5;
  const baseY = Math.floor(py);
  const y0 = Math.min(height - 1, Math.max(0, baseY));
  const y1 = Math.min(height - 1, Math.max(0, baseY + 1));
  const fy = py - baseY;
  return (
    (1 - fy) *
      ((1 - fx) * values[y0 * width + x0] + fx * values[y0 * width + x1]) +
    fy * ((1 - fx) * values[y1 * width + x0] + fx * values[y1 * width + x1])
  );
}

/**
 * GSM2018 fast flow on the mixed periodic/reflecting domain. The flux is
 * J=-grad(phi), phi_k=rho0_k/|k|^2 for every nonzero mode; the zero mode is 0.
 * Thus div(J)=rho0-1 and d(rho)/dt+div(J)=0 throughout t in [0,1]. The density
 * has mean 1 after normalization. Only the initial density and two flux arrays
 * survive spectral preparation. Each time field samples J and rho separately
 * before division, without running another FFT or allocating world arrays.
 */
export function createGsm2018Solver(options = {}) {
  const spectral = createSpectralSolver(options);
  const { width, height, mean, flooredCells } = spectral;
  const {
    rho: initialDensity,
    minimumDensity: initialMinimum,
    maximumDensity: initialMaximum,
  } = spectral.evaluate(0);
  const { vx: fluxX, vy: fluxY } = spectral.evaluateFlux();
  const spectralEvaluations = spectral.evaluations;
  const flux = { vx: fluxX, vy: fluxY };
  let maxFlux = 0;
  for (let i = 0; i < initialDensity.length; i += 1)
    maxFlux = Math.max(maxFlux, Math.hypot(fluxX[i], fluxY[i]));
  let evaluations = 0;
  return {
    width,
    height,
    mean,
    flooredCells,
    initialDensity,
    fluxX,
    fluxY,
    spectralEvaluations,
    evaluate(time) {
      if (!Number.isFinite(time) || time < 0 || time > 1)
        throw new RangeError('GSM2018 time must be in [0, 1]');
      const minimumDensity = (1 - time) * initialMinimum + time;
      const maximumDensity = (1 - time) * initialMaximum + time;
      evaluations += 1;
      return {
        time,
        minimumDensity,
        maximumDensity,
        maxSpeed: maxFlux / minimumDensity,
        densityAtCell: (index) => (1 - time) * initialDensity[index] + time,
        sample(x, y, output) {
          sampleVelocity(flux, width, height, x, y, output);
          const rho =
            (1 - time) * sampleScalar(initialDensity, width, height, x, y) +
            time;
          output[0] /= rho;
          output[1] /= rho;
          return output;
        },
      };
    },
    get evaluations() {
      return evaluations;
    },
  };
}

function sampleVelocity(field, width, height, x, y, output) {
  if (field.sample) return field.sample(x, y, output);
  const px = wrap01(x) * width - 0.5;
  const x0 = ((Math.floor(px) % width) + width) % width;
  const x1 = (x0 + 1) % width;
  const fx = px - Math.floor(px);
  const py = clamp01(y) * height - 0.5;
  const y0 = Math.min(height - 1, Math.max(0, Math.floor(py)));
  const y1 = Math.min(height - 1, Math.max(0, Math.floor(py) + 1));
  const fy = py - Math.floor(py);
  const a = y0 * width;
  const b = y1 * width;
  output[0] =
    (1 - fy) * ((1 - fx) * field.vx[a + x0] + fx * field.vx[a + x1]) +
    fy * ((1 - fx) * field.vx[b + x0] + fx * field.vx[b + x1]);
  output[1] =
    (1 - fy) * ((1 - fx) * field.vy[a + x0] + fx * field.vy[a + x1]) +
    fy * ((1 - fx) * field.vy[b + x0] + fx * field.vy[b + x1]);
  if (py < 0) output[1] *= Math.max(0, 2 * y * height);
  if (py > height - 1) output[1] *= Math.max(0, 2 * (1 - y) * height);
  return output;
}

function identityNodes(width, height) {
  const grid = new Float64Array((width + 1) * (height + 1) * 2);
  for (let y = 0; y <= height; y += 1)
    for (let x = 0; x <= width; x += 1) {
      const i = (y * (width + 1) + x) * 2;
      grid[i] = x / width;
      grid[i + 1] = y / height;
    }
  return grid;
}

function cross(grid, a, b, c) {
  return (
    (grid[b] - grid[a]) * (grid[c + 1] - grid[a + 1]) -
    (grid[b + 1] - grid[a + 1]) * (grid[c] - grid[a])
  );
}

export function measureTriangleOrientation(map) {
  const { width, height, forwardGrid: grid } = map;
  let minimum = Infinity;
  let totalArea = 0;
  let nonPositive = 0;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const a = (y * (width + 1) + x) * 2;
      const b = a + 2;
      const d = a + (width + 1) * 2;
      const c = d + 2;
      const first = cross(grid, a, b, c) / 2;
      const second = cross(grid, a, c, d) / 2;
      minimum = Math.min(minimum, first, second);
      nonPositive += Number(first <= 0) + Number(second <= 0);
      totalArea += first + second;
    }
  return {
    positive: nonPositive === 0,
    nonPositive,
    minimum,
    triangles: 2 * width * height,
    totalArea,
    totalAreaSteradians: totalArea * 4 * Math.PI,
    totalAreaRelativeError: Math.abs(totalArea - 1),
  };
}

function sourceTriangle(map, x, y) {
  const { width, height, forwardGrid: grid } = map;
  const turn = Math.floor(x);
  const px = wrap01(x) * width;
  const py = clamp01(y) * height;
  const cx = Math.min(width - 1, Math.floor(px));
  const cy = Math.min(height - 1, Math.floor(py));
  const fx = px - cx;
  const fy = py - cy;
  const a = (cy * (width + 1) + cx) * 2;
  const b = a + 2;
  const d = a + (width + 1) * 2;
  const c = d + 2;
  const bx = fx >= fy ? b : c;
  const by = fx >= fy ? c : d;
  const first = fx >= fy ? fx - fy : fx;
  const second = fx >= fy ? fy : fy - fx;
  const mappedX =
    grid[a] +
    first * (grid[bx] - grid[a]) +
    second * (grid[by] - grid[a]) +
    turn;
  const mappedY =
    grid[a + 1] +
    first * (grid[bx + 1] - grid[a + 1]) +
    second * (grid[by + 1] - grid[a + 1]);
  const dxX = width * (fx >= fy ? grid[b] - grid[a] : grid[c] - grid[d]);
  const dxY =
    width * (fx >= fy ? grid[b + 1] - grid[a + 1] : grid[c + 1] - grid[d + 1]);
  const dyX = height * (fx >= fy ? grid[c] - grid[b] : grid[d] - grid[a]);
  const dyY =
    height * (fx >= fy ? grid[c + 1] - grid[b + 1] : grid[d + 1] - grid[a + 1]);
  return {
    point: [mappedX, mappedY],
    dxX,
    dxY,
    dyX,
    dyY,
    jacobian: dxX * dyY - dyX * dxY,
  };
}

function sampleNodeDisplacement(raster, x, y) {
  const { width, height, grid } = raster;
  const px = wrap01(x) * width;
  const py = clamp01(y) * height;
  const x0 = Math.min(width - 1, Math.floor(px));
  const y0 = Math.min(height - 1, Math.floor(py));
  const fx = px - x0;
  const fy = py - y0;
  let dx = 0;
  let dy = 0;
  for (let j = 0; j <= 1; j += 1)
    for (let i = 0; i <= 1; i += 1) {
      const weight = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      const index = ((y0 + j) * (width + 1) + x0 + i) * 2;
      dx += weight * (grid[index] - (x0 + i) / width);
      dy += weight * (grid[index + 1] - (y0 + j) / height);
    }
  return [x + dx, clamp01(y + dy)];
}

/** Create a piecewise-affine map from a positive periodic forward node mesh. */
export function cartogramFromForwardGrid({
  width,
  height,
  forwardGrid,
  diagnostics = {},
}) {
  if (forwardGrid?.length !== (width + 1) * (height + 1) * 2)
    throw new RangeError('forward node grid size mismatch');
  const map = {
    width,
    height,
    forwardGrid,
    diagnostics,
    forward(x, y) {
      return sourceTriangle(map, x, y).point;
    },
    jacobian(x, y) {
      return sourceTriangle(map, x, y).jacobian;
    },
  };
  let inverseRaster;
  map.inverse = (x, y) => {
    inverseRaster ??= rasterizeInverseMap(map, {
      width,
      height,
      centers: false,
    });
    let [sx, sy] = sampleNodeDisplacement(inverseRaster, x, y);
    // Rasterisation supplies the triangle inverse seed. Local affine Newton
    // correction removes interpolation error without approximating an inverse
    // by swapping or negating forward displacement.
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const cell = sourceTriangle(map, sx, sy);
      const ex = cell.point[0] - x;
      const ey = cell.point[1] - clamp01(y);
      if (Math.max(Math.abs(ex), Math.abs(ey)) < 1e-11) return [sx, sy];
      const dx = (cell.dyY * ex - cell.dyX * ey) / cell.jacobian;
      const dy = (-cell.dxY * ex + cell.dxX * ey) / cell.jacobian;
      // Restrict large seed corrections so highly compressed triangles cannot
      // throw a Newton step across the entire periodic domain.
      const damping = Math.min(
        1,
        0.25 / Math.max(Math.abs(dx), Math.abs(dy), EPSILON),
      );
      sx -= damping * dx;
      sy = clamp01(sy - damping * dy);
    }
    throw new Error(`Triangle inverse did not converge at (${x}, ${y})`);
  };
  return map;
}

/**
 * Integrate all mesh nodes by adaptive Euler prediction / trapezoid correction.
 * A proposed step is rejected for its local error or ANY inverted triangle.
 * All x coordinates remain unwrapped; the endpoint column is x0 + one turn.
 */
export function createCartogram({
  width,
  height,
  density,
  blurSigma = 0.5,
  tolerance = 0.02 / Math.max(width, height),
  speedTolerance = 1e-7,
  maxSteps = 4000,
  maxTime = 100,
  initialStep,
  onProgress,
  domainWidth = TAU,
  domainHeight = 2,
  zeroDensityFloor = 0.01,
  algorithm = 'diffusion',
} = {}) {
  if (!['diffusion', 'gsm2018'].includes(algorithm))
    throw new RangeError('cartogram algorithm must be diffusion or gsm2018');
  const linearFlow = algorithm === 'gsm2018';
  if (
    !Number.isFinite(tolerance) ||
    !Number.isFinite(speedTolerance) ||
    !Number.isFinite(maxTime) ||
    !(tolerance > 0) ||
    !(speedTolerance > 0) ||
    !Number.isInteger(maxSteps) ||
    !(maxSteps > 0) ||
    !(maxTime > 0) ||
    (linearFlow && maxTime < 1) ||
    (initialStep !== undefined &&
      (!Number.isFinite(initialStep) || initialStep <= 0))
  )
    throw new RangeError(
      'invalid diffusion integration tolerance or step budget',
    );
  const solver = (linearFlow ? createGsm2018Solver : createDiffusionSolver)({
    width,
    height,
    density,
    blurSigma,
    domainWidth,
    domainHeight,
    zeroDensityFloor,
  });
  let grid = identityNodes(width, height);
  let candidate = new Float64Array(grid.length);
  let field = solver.evaluate(0);
  let time = linearFlow && field.maxSpeed === 0 ? 1 : 0;
  const limit = linearFlow ? 1 : maxTime;
  let step =
    initialStep ??
    (linearFlow
      ? 0.01
      : 0.2 /
        (((Math.PI * height) / domainHeight) ** 2 +
          ((Math.PI * width) / domainWidth) ** 2));
  let accepted = 0;
  let rejected = 0;
  let maximumLocalError = 0;
  const velocity = new Float64Array(2);
  const predictedVelocity = new Float64Array(2);
  while (linearFlow ? time < 1 : field.maxSpeed > speedTolerance) {
    if (accepted + rejected >= maxSteps || time >= limit)
      throw new Error(
        `${linearFlow ? 'GSM2018' : 'Diffusion'} flow failed to converge: t=${time}, maxSpeed=${field.maxSpeed}, accepted=${accepted}, rejected=${rejected}`,
      );
    step = Math.min(step, limit - time);
    const nextTime = Math.min(limit, time + step);
    const nextField = solver.evaluate(nextTime);
    let error = 0;
    let boundaryValid = true;
    for (let y = 0; y <= height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * (width + 1) + x) * 2;
        sampleVelocity(field, width, height, grid[i], grid[i + 1], velocity);
        const px = grid[i] + step * velocity[0];
        const py = grid[i + 1] + step * velocity[1];
        if (py < -EPSILON || py > 1 + EPSILON) boundaryValid = false;
        sampleVelocity(nextField, width, height, px, py, predictedVelocity);
        candidate[i] =
          grid[i] + 0.5 * step * (velocity[0] + predictedVelocity[0]);
        candidate[i + 1] =
          y === 0
            ? 0
            : y === height
              ? 1
              : grid[i + 1] + 0.5 * step * (velocity[1] + predictedVelocity[1]);
        if (candidate[i + 1] < 0 || candidate[i + 1] > 1) boundaryValid = false;
        error = Math.max(
          error,
          Math.abs(candidate[i] - px),
          Math.abs(candidate[i + 1] - py),
        );
      }
      const start = y * (width + 1) * 2;
      candidate[start + width * 2] = candidate[start] + 1;
      candidate[start + width * 2 + 1] = candidate[start + 1];
    }
    const triangle =
      boundaryValid && error <= tolerance
        ? measureTriangleOrientation({ width, height, forwardGrid: candidate })
        : null;
    if (!triangle?.positive) {
      rejected += 1;
      step *= Math.max(
        0.1,
        Math.min(0.5, 0.8 * Math.sqrt(tolerance / Math.max(error, EPSILON))),
      );
      if (step < 1e-12 || time + step === time)
        throw new Error(
          `${linearFlow ? 'GSM2018' : 'Diffusion'} flow step underflow while preventing mesh folding`,
        );
      continue;
    }
    [grid, candidate] = [candidate, grid];
    time = nextTime;
    field = nextField;
    accepted += 1;
    maximumLocalError = Math.max(maximumLocalError, error);
    onProgress?.({
      phase: 'integration',
      algorithm,
      time,
      step,
      accepted,
      rejected,
      maxSpeed: field.maxSpeed,
    });
    step *= Math.max(
      0.5,
      Math.min(2, 0.9 * Math.sqrt(tolerance / Math.max(error, 1e-30))),
    );
  }
  const map = cartogramFromForwardGrid({
    width,
    height,
    forwardGrid: grid,
    diagnostics: {
      algorithm: linearFlow ? 'gsm2018-fast-flow' : 'spectral-diffusion-flow',
      densityPath: linearFlow ? 'linear-to-mean' : 'analytic-heat-diffusion',
      boundaryX: 'periodic-FFT',
      boundaryY: 'reflecting-DCT-II',
      blurSigma,
      tolerance,
      speedTolerance,
      acceptedSteps: accepted,
      rejectedSteps: rejected,
      spectralEvaluations: linearFlow
        ? solver.spectralEvaluations
        : solver.evaluations,
      velocityEvaluations: solver.evaluations,
      finalTime: time,
      finalMaxSpeed: field.maxSpeed,
      speedMeasure: linearFlow
        ? 'flux-over-min-density-upper-bound'
        : 'cell-maximum',
      maximumLocalError,
      flooredCells: solver.flooredCells,
    },
  });
  map.density = Float64Array.from(density);
  map.iterations = 1;
  return map;
}

export const buildCartogram = createCartogram;
export const buildDensityEqualizingMap = createCartogram;

/**
 * Rasterise the exact inverse of BOTH triangles in every deformed cell.
 * `centers=true`: width*height sample centres (texture). `centers=false`:
 * (width+1)*(height+1) endpoints (interpolation/validation). x seam copies
 * are unfolded before coverage and source coordinates receive the same turn.
 */
export function rasterizeInverseMap(
  map,
  {
    width = map.width,
    height = map.height,
    centers = true,
    allowMissing = false,
  } = {},
) {
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    !Number.isInteger(height) ||
    height < 1
  )
    throw new RangeError('inverse raster dimensions must be positive integers');
  const cols = centers ? width : width + 1;
  const rows = centers ? height : height + 1;
  const grid = new Float64Array(cols * rows * 2).fill(NaN);
  const offset = centers ? 0.5 : 0;
  const source = map.forwardGrid;
  const sourceWidth = map.width;
  const sourceHeight = map.height;
  function triangle(a, b, c, sx0, sy0, sx1, sy1, sx2, sy2) {
    const ax = source[a];
    const ay = source[a + 1];
    const bx = source[b];
    const by = source[b + 1];
    const cx = source[c];
    const cy = source[c + 1];
    const determinant = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (!(determinant > 0))
      throw new Error('Cannot rasterize an inverse for a folded triangle');
    const minX = Math.min(ax, bx, cx);
    const maxX = Math.max(ax, bx, cx);
    const startY = Math.max(
      0,
      Math.ceil(Math.min(ay, by, cy) * height - offset - EPSILON),
    );
    const endY = Math.min(
      rows - 1,
      Math.floor(Math.max(ay, by, cy) * height - offset + EPSILON),
    );
    for (let turn = Math.ceil(-maxX); turn <= Math.floor(1 - minX); turn += 1) {
      const startX = Math.max(
        0,
        Math.ceil((minX + turn) * width - offset - EPSILON),
      );
      const endX = Math.min(
        cols - 1,
        Math.floor((maxX + turn) * width - offset + EPSILON),
      );
      for (let y = startY; y <= endY; y += 1) {
        const dy = (y + offset) / height - ay;
        for (let x = startX; x <= endX; x += 1) {
          const dx = (x + offset) / width - turn - ax;
          const wb = (dx * (cy - ay) - dy * (cx - ax)) / determinant;
          const wc = ((bx - ax) * dy - (by - ay) * dx) / determinant;
          if (wb < -1e-9 || wc < -1e-9 || wb + wc > 1 + 1e-9) continue;
          const i = (y * cols + x) * 2;
          grid[i] = sx0 + wb * (sx1 - sx0) + wc * (sx2 - sx0) + turn;
          grid[i + 1] = sy0 + wb * (sy1 - sy0) + wc * (sy2 - sy0);
        }
      }
    }
  }
  for (let y = 0; y < sourceHeight; y += 1)
    for (let x = 0; x < sourceWidth; x += 1) {
      const a = (y * (sourceWidth + 1) + x) * 2;
      const b = a + 2;
      const d = a + (sourceWidth + 1) * 2;
      const c = d + 2;
      const x0 = x / sourceWidth;
      const x1 = (x + 1) / sourceWidth;
      const y0 = y / sourceHeight;
      const y1 = (y + 1) / sourceHeight;
      triangle(a, b, c, x0, y0, x1, y0, x1, y1);
      triangle(a, c, d, x0, y0, x1, y1, x0, y1);
    }
  let missingSamples = 0;
  for (let i = 0; i < grid.length; i += 2)
    if (!Number.isFinite(grid[i])) missingSamples += 1;
  if (missingSamples && !allowMissing)
    throw new Error(`Inverse raster has ${missingSamples} uncovered samples`);
  return { grid, width, height, cols, rows, centers, missingSamples };
}

/** Compose correction after an existing forward map, retaining its source mesh. */
export function composeCartograms(first, correction) {
  const grid = new Float64Array(first.forwardGrid.length);
  for (let i = 0; i < grid.length; i += 2) {
    const p = correction.forward(
      first.forwardGrid[i],
      first.forwardGrid[i + 1],
    );
    grid[i] = p[0];
    grid[i + 1] = p[1];
  }
  const rounds = [
    ...(first.diagnostics.rounds ?? [first.diagnostics]),
    ...(correction.diagnostics.rounds ?? [correction.diagnostics]),
  ];
  const map = cartogramFromForwardGrid({
    width: first.width,
    height: first.height,
    forwardGrid: grid,
    diagnostics: {
      algorithm: rounds.every(
        (round) => round.algorithm === 'gsm2018-fast-flow',
      )
        ? 'composed-gsm2018-fast-flow'
        : rounds.every((round) => round.algorithm === 'spectral-diffusion-flow')
          ? 'composed-spectral-diffusion-flow'
          : 'composed-density-equalizing-flow',
      rounds,
    },
  });
  const orientation = measureTriangleOrientation(map);
  if (!orientation.positive)
    throw new Error(
      `Composed map has ${orientation.nonPositive} folded triangles`,
    );
  map.iterations = (first.iterations ?? 1) + 1;
  map.density = first.density;
  return map;
}

/**
 * Re-rasterise ORIGINAL density in deformed space for an outer correction.
 * The density transforms as rho'(F(p)) = rho(p)/det(DF(p)); omitting the
 * Jacobian would repeatedly transport mass already equalized in earlier rounds.
 */
export function densityInMappedSpace(
  map,
  density,
  { width = map.width, height = map.height } = {},
) {
  if (density?.length !== map.width * map.height)
    throw new RangeError('original density grid size mismatch');
  const inverse = rasterizeInverseMap(map, { width, height, centers: true });
  const output = new Float64Array(width * height);
  for (let i = 0; i < output.length; i += 1) {
    const sx = inverse.grid[2 * i];
    const sy = inverse.grid[2 * i + 1];
    const x = Math.min(map.width - 1, Math.floor(wrap01(sx) * map.width));
    const y = Math.min(map.height - 1, Math.floor(clamp01(sy) * map.height));
    output[i] = density[y * map.width + x] / map.jacobian(sx, sy);
  }
  // Quadrature has finite raster resolution; preserve the original total
  // exactly rather than let repeated corrections accumulate mass drift.
  const inputMean = density.reduce((a, b) => a + b, 0) / density.length;
  const outputMean = output.reduce((a, b) => a + b, 0) / output.length;
  for (let i = 0; i < output.length; i += 1)
    output[i] *= inputMean / outputMean;
  return {
    density: output,
    inverse,
    quadratureRelativeError: Math.abs(outputMean / inputMean - 1),
  };
}

/** Mapped areas of original raster-labelled cells, measured from every triangle. */
export function computeUnitAreas(map, unitIds) {
  if (unitIds?.length !== map.width * map.height)
    throw new RangeError('unit ID grid size mismatch');
  const areas = new Map();
  for (let y = 0; y < map.height; y += 1)
    for (let x = 0; x < map.width; x += 1) {
      const a = (y * (map.width + 1) + x) * 2;
      const b = a + 2;
      const d = a + (map.width + 1) * 2;
      const c = d + 2;
      const area =
        (cross(map.forwardGrid, a, b, c) + cross(map.forwardGrid, a, c, d)) / 2;
      const id = unitIds[y * map.width + x];
      areas.set(id, (areas.get(id) ?? 0) + area);
    }
  return areas;
}

function angularDistanceDegrees(a, b) {
  const lonDelta = TAU * Math.min(wrap01(a[0] - b[0]), wrap01(b[0] - a[0]));
  const latA = Math.asin(Math.min(1, Math.max(-1, 2 * a[1] - 1)));
  const latB = Math.asin(Math.min(1, Math.max(-1, 2 * b[1] - 1)));
  const h =
    Math.sin((latA - latB) / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(lonDelta / 2) ** 2;
  return (
    (2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h)))) * 180) / Math.PI
  );
}

/** Sample an ENCODED/RESAMPLED inverse field, including periodic displacements. */
export function sampleInverseRaster(raster, x, y) {
  if (!raster.centers) return sampleNodeDisplacement(raster, x, y);
  const px = wrap01(x) * raster.width - 0.5;
  const py = clamp01(y) * raster.height - 0.5;
  const baseX = Math.floor(px);
  const baseY = Math.floor(py);
  const fx = px - baseX;
  const fy = py - baseY;
  let dx = 0;
  let dy = 0;
  for (let j = 0; j <= 1; j += 1)
    for (let i = 0; i <= 1; i += 1) {
      const cx = (((baseX + i) % raster.width) + raster.width) % raster.width;
      const cy = Math.max(0, Math.min(raster.height - 1, baseY + j));
      const index = (cy * raster.width + cx) * 2;
      const weight = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      dx += weight * (raster.grid[index] - (cx + 0.5) / raster.width);
      dy += weight * (raster.grid[index + 1] - (cy + 0.5) / raster.height);
    }
  // The inverse preserves reflecting domain edges too. Between an edge and
  // its nearest centre the vertical displacement tends linearly to zero.
  if (py < 0) dy *= Math.max(0, 2 * y * raster.height);
  if (py > raster.height - 1) dy *= Math.max(0, 2 * (1 - y) * raster.height);
  return [x + dx, clamp01(y + dy)];
}

/** Measure roundtrips on ALL source grid nodes; inverse may be a runtime field. */
export function measureRoundTrip(map, inverse = map.inverse) {
  const errors = new Float64Array((map.width + 1) * (map.height + 1));
  let index = 0;
  for (let y = 0; y <= map.height; y += 1)
    for (let x = 0; x <= map.width; x += 1) {
      const p = [x / map.width, y / map.height];
      errors[index++] = angularDistanceDegrees(
        p,
        inverse(...map.forward(...p)),
      );
    }
  errors.sort();
  return {
    samples: errors.length,
    p999Degrees: errors[Math.ceil(errors.length * 0.999) - 1],
    maxDegrees: errors[errors.length - 1],
  };
}

export function validateCartogram(
  map,
  {
    unitIds,
    targetAreas,
    shares,
    minimumShare = 1e-4,
    inverse = map.inverse,
  } = {},
) {
  const orientation = measureTriangleOrientation(map);
  const roundTrip = measureRoundTrip(map, inverse);
  const areaErrors =
    unitIds && targetAreas
      ? summarizeAreaErrors(computeUnitAreas(map, unitIds), targetAreas, {
          shares,
          minimumShare,
        })
      : null;
  const passes =
    orientation.positive &&
    orientation.totalAreaRelativeError < 1e-6 &&
    roundTrip.p999Degrees < 0.05 &&
    roundTrip.maxDegrees < 0.5 &&
    (!areaErrors || (areaErrors.median < 0.05 && areaErrors.p90 < 0.15));
  return { passes, orientation, roundTrip, areaErrors };
}

export function applyForwardMap(map, point) {
  return map.forward(point[0], point[1]);
}
export function applyInverseMap(map, point) {
  return map.inverse(point[0], point[1]);
}
export function validatePositiveJacobian(map) {
  return measureTriangleOrientation(map);
}
export function mapGridPoints(map, points, direction = 'forward') {
  return Array.from(points, (point) => map[direction](point[0], point[1]));
}
export function polygonSignedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    area += points[i][0] * next[1] - next[0] * points[i][1];
  }
  return area / 2;
}
export function areaRelativeError(actual, target) {
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return Infinity;
  return Math.abs(actual - target) / Math.max(Math.abs(target), EPSILON);
}
export function jacobianAt(map, x, y) {
  return map.jacobian(x, y);
}

export function summarizeAreaErrors(actualByUnit, targetByUnit, options = {}) {
  const errors = [];
  const entries =
    targetByUnit instanceof Map
      ? targetByUnit.entries()
      : Object.entries(targetByUnit ?? {});
  const getActual =
    actualByUnit instanceof Map
      ? (id) => actualByUnit.get(id)
      : (id) => actualByUnit?.[id];
  const getShare =
    options.shares instanceof Map
      ? (id) => options.shares.get(id)
      : (id) => options.shares?.[id];
  for (const [id, target] of entries) {
    if (Number(getShare(id) ?? 1) < (options.minimumShare ?? 0)) continue;
    const actual = getActual(id);
    if (target == null) continue;
    if (actual == null) {
      errors.push(Infinity);
      continue;
    }
    errors.push(areaRelativeError(Number(actual), Number(target)));
  }
  errors.sort((a, b) => a - b);
  const percentile = (p) =>
    errors.length
      ? errors[
          Math.min(
            errors.length - 1,
            Math.max(0, Math.ceil(p * errors.length) - 1),
          )
        ]
      : 0;
  return {
    count: errors.length,
    median: percentile(0.5),
    p90: percentile(0.9),
    max: errors.length ? errors[errors.length - 1] : 0,
  };
}

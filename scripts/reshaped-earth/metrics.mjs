import { readLabelStripes } from './units.mjs';

const WORLD = [-180, -90, 180, 90];
const RADIUS_SQUARED = 6371.0088 ** 2;
const DEG = Math.PI / 180;
const CONFIG = {
  population: { year: 2020, unit: 'persons', oceanRadius: 2 },
  gdp: { year: 2020, unit: '2021 international dollars (PPP)', oceanRadius: 0 },
  co2: { year: 2020, unit: 't CO2 / year', oceanRadius: 0 },
  lights: { year: 2020, unit: 'relative DN index', oceanRadius: 0 },
};

function checkGrid(width, height, bounds, allowPixelOverhang = false) {
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    !Number.isInteger(height) ||
    height < 1
  )
    throw new RangeError('raster dimensions must be positive integers');
  if (
    !bounds ||
    bounds.length !== 4 ||
    !Array.from(bounds).every(Number.isFinite)
  )
    throw new RangeError('raster bounds must be [west, south, east, north]');
  const [west, south, east, north] = bounds;
  // Some published geographic rasters include endpoint samples at -180 and
  // +180. Their pixel edges extend up to one pixel beyond the globe; preserve the
  // signed affine coordinates and wrap their centres during aggregation.
  const padX = allowPixelOverhang ? ((east - west) / width) * 1.05 : 0;
  const padY = allowPixelOverhang ? ((north - south) / height) * 1.05 : 0;
  if (
    !(west < east) ||
    !(south < north) ||
    west < -180 - padX - 1e-7 ||
    east > 180 + padX + 1e-7 ||
    south < -90 - padY - 1e-7 ||
    north > 90 + padY + 1e-7
  )
    throw new RangeError('raster bounds exceed geographic coordinates');
  return {
    width,
    height,
    bounds: Array.from(bounds),
    west,
    south,
    east,
    north,
    dx: (east - west) / width,
    dy: (north - south) / height,
    periodicX: Math.abs(east - west - 360) < 1e-8,
  };
}

function compensatedAdd(sums, corrections, index, amount) {
  const corrected = amount - corrections[index];
  const next = sums[index] + corrected;
  corrections[index] = next - sums[index] - corrected;
  sums[index] = next;
}

function scalarSum() {
  let sum = 0;
  let correction = 0;
  return {
    add(value) {
      const y = value - correction;
      const next = sum + y;
      correction = next - sum - y;
      sum = next;
    },
    get value() {
      return sum;
    },
  };
}

function metadataDescription(metadata) {
  return String(
    metadata?.DESCRIPTION ??
      metadata?.Description ??
      metadata?.description ??
      metadata?.BAND_DESCRIPTION ??
      metadata?.band_description ??
      '',
  ).trim();
}

/** Match a YEAR TOKEN in a band's own description, never an unverified index. */
export function selectYearBand(descriptions, year = 2020) {
  const token = new RegExp(`(^|[^0-9])${year}([^0-9]|$)`);
  const matches = descriptions.flatMap((description, sample) =>
    token.test(String(description)) ? [sample] : [],
  );
  if (matches.length !== 1)
    throw new Error(
      `GDP requires exactly one band description for ${year}; found ${matches.length}`,
    );
  return matches[0];
}

/** Preserve the signed affine axes; geotiff's transform helper negates Y. */
export function geographicGridFromTags({
  width,
  height,
  transformation,
  tiepoint,
  pixelScale,
  rasterPixelIsPoint = false,
} = {}) {
  let rx;
  let ry;
  let x0;
  let y0;
  if (transformation) {
    if (
      transformation.length !== 16 ||
      transformation[1] !== 0 ||
      transformation[4] !== 0 ||
      transformation[12] !== 0 ||
      transformation[13] !== 0 ||
      transformation[15] !== 1
    )
      throw new Error(
        'Rotated/non-affine GeoTIFF requires explicit geographic reprojection',
      );
    rx = transformation[0];
    ry = transformation[5];
    x0 = transformation[3];
    y0 = transformation[7];
  } else if (tiepoint?.length >= 6 && pixelScale?.length >= 2) {
    rx = pixelScale[0];
    ry = -pixelScale[1];
    x0 = tiepoint[3] - tiepoint[0] * rx;
    y0 = tiepoint[4] - tiepoint[1] * ry;
  } else throw new Error('Metric GeoTIFF has no usable affine pixel scale');
  if (
    !Number.isFinite(rx) ||
    !Number.isFinite(ry) ||
    !Number.isFinite(x0) ||
    !Number.isFinite(y0) ||
    rx === 0 ||
    ry === 0
  )
    throw new Error('Metric GeoTIFF has no usable affine pixel scale');
  if (rasterPixelIsPoint) {
    x0 -= rx / 2;
    y0 -= ry / 2;
  }
  const grid = checkGrid(
    width,
    height,
    [
      Math.min(x0, x0 + width * rx),
      Math.min(y0, y0 + height * ry),
      Math.max(x0, x0 + width * rx),
      Math.max(y0, y0 + height * ry),
    ],
    true,
  );
  return { ...grid, rx, ry, x0, y0, affine: [x0, rx, 0, y0, 0, ry] };
}

/**
 * geotiff 3.x reader: one IFD may contain all 35 GDP samples. Inspect GDAL
 * sample descriptions, select 2020, then decode ONE sample in row stripes.
 * Reversed affine axes are normalized. Rotated/projected inputs fail visibly.
 */
export async function openGeoTiffReader(path, { key, stripeRows } = {}) {
  if (!['population', 'gdp', 'lights'].includes(key))
    throw new Error(`No approved GeoTIFF reader for ${key}`);
  if (!path) throw new TypeError('GeoTIFF path is required');
  if (
    stripeRows !== undefined &&
    (!Number.isInteger(stripeRows) || stripeRows < 1)
  )
    throw new RangeError('stripeRows must be a positive integer');
  const { fromFile } = await import('geotiff');
  const tiff = await fromFile(path);
  try {
    const image = await tiff.getImage(0);
    const width = image.getWidth();
    const height = image.getHeight();
    // Read each compressed tile once. A 256-row float64 population stripe
    // occupies about 84 MiB, instead of repeatedly decoding a tile 16 times.
    stripeRows ??= image.isTiled ? Math.min(256, image.getTileHeight()) : 16;
    const samples = image.getSamplesPerPixel();
    const geoKeys = image.getGeoKeys();
    if (
      geoKeys.ProjectedCSTypeGeoKey ||
      (geoKeys.GeographicTypeGeoKey && geoKeys.GeographicTypeGeoKey !== 4326)
    )
      throw new Error('Metric GeoTIFF must use geographic WGS84 coordinates');
    const point = geoKeys.GTRasterTypeGeoKey === 2;
    const { bounds, rx, ry, affine } = geographicGridFromTags({
      width,
      height,
      transformation: image.fileDirectory.getValue('ModelTransformation'),
      tiepoint: image.fileDirectory.getValue('ModelTiepoint'),
      pixelScale: image.fileDirectory.getValue('ModelPixelScale'),
      rasterPixelIsPoint: point,
    });
    const datasetMetadata = (await image.getGDALMetadata()) ?? {};
    const bandMetadata = [];
    for (let sample = 0; sample < samples; sample += 1)
      bandMetadata.push((await image.getGDALMetadata(sample)) ?? {});
    const descriptions = bandMetadata.map(metadataDescription);
    const sample = key === 'gdp' ? selectYearBand(descriptions, 2020) : 0;
    if (key !== 'gdp' && samples !== 1)
      throw new Error(
        `${key} must have one reviewed count/DN sample; found ${samples}`,
      );
    const chosen = bandMetadata[sample];
    const scale = Number(chosen.SCALE ?? chosen.scale ?? 1);
    const offset = Number(chosen.OFFSET ?? chosen.offset ?? 0);
    if (!Number.isFinite(scale) || !Number.isFinite(offset))
      throw new Error('Invalid GeoTIFF band scale/offset');
    const metadata = {
      ...CONFIG[key],
      key,
      width,
      height,
      bounds,
      imageIndex: 0,
      sampleIndex: sample,
      bandDescription: descriptions[sample],
      allBandDescriptions: descriptions,
      nodata: image.getGDALNoData(),
      scale,
      offset,
      rasterPixelIsPoint: point,
      affine,
      stripeRows,
      datasetMetadata,
      bandMetadata: chosen,
    };
    return {
      width,
      height,
      bounds,
      metadata,
      close: () => tiff.close(),
      async *rows() {
        for (let first = 0; first < height; first += stripeRows) {
          const count = Math.min(stripeRows, height - first);
          const top = ry < 0 ? first : height - first - count;
          const raster = await image.readRasters({
            window: [0, top, width, top + count],
            samples: [sample],
            interleave: true,
          });
          for (let i = 0; i < count; i += 1) {
            const local = ry < 0 ? i : count - 1 - i;
            const original = raster.subarray(
              local * width,
              (local + 1) * width,
            );
            const values =
              rx > 0 ? original : Float64Array.from(original).reverse();
            yield { row: first + i, values };
          }
          // No persistent tile cache or worker pool: rows/stripes are released
          // before the next window. Decoding stays on one CPU worker.
        }
      },
    };
  } catch (error) {
    await tiff.close();
    throw error;
  }
}

/**
 * GridFED v2025.1 is a netCDF4/HDF5 file. Read only the reviewed fossil and
 * cement-calcination groups, summing twelve kg/month samples into tonnes/year
 * while yielding north-to-south 0.1-degree stripes. Bunkers and carbonation
 * remain deliberately excluded by the variable allow-list.
 */
export async function openGridFedReader(path, { stripeRows = 8 } = {}) {
  if (!path) throw new TypeError('GridFED path is required');
  if (!Number.isInteger(stripeRows) || stripeRows < 1)
    throw new RangeError('stripeRows must be a positive integer');
  const h5 = await import('h5wasm/node');
  await h5.ready;
  const file = new h5.File(path, 'r');
  const expected = ['OIL', 'GAS', 'COAL', 'CEMENT'];
  try {
    const lat = file.get('lat');
    const lon = file.get('lon');
    const time = file.get('time');
    if (
      !lat ||
      !lon ||
      !time ||
      lat.shape?.[0] !== 1800 ||
      lon.shape?.[0] !== 3600 ||
      time.shape?.[0] !== 12
    )
      throw new Error('GridFED dimensions are not 12×1800×3600');
    const latUnits = lat.attrs?.units?.value;
    const timeUnits = time.attrs?.units?.value;
    const latValues = lat.value ?? lat.slice();
    const lonValues = lon.value ?? lon.slice();
    const timeValues = time.value ?? time.slice();
    const closeTo = (actual, expected, tolerance = 2e-5) =>
      Number.isFinite(actual) &&
      Math.abs(Number(actual) - expected) <= tolerance;
    if (
      latUnits !== 'Degrees_N' ||
      timeUnits !== 'days since 2020-01-01' ||
      !closeTo(latValues[0], -89.95) ||
      !closeTo(latValues[1799], 89.95) ||
      !closeTo(lonValues[0], -179.95) ||
      !closeTo(lonValues[3599], 179.95) ||
      !closeTo(timeValues[0], 0) ||
      !closeTo(timeValues[11], 335) ||
      Array.from(latValues).some(
        (value, i) => !closeTo(value, -89.95 + i * 0.1),
      ) ||
      Array.from(lonValues).some(
        (value, i) => !closeTo(value, -179.95 + i * 0.1),
      ) ||
      Array.from(timeValues).some(
        (value, i) =>
          value !== [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335][i],
      )
    )
      throw new Error('GridFED coordinate metadata mismatch');
    const datasets = expected.map((name) => file.get(`CO2/${name}`));
    for (const [name, dataset] of expected.map((name, i) => [
      name,
      datasets[i],
    ])) {
      const units = dataset?.attrs?.units?.value;
      if (
        !dataset ||
        JSON.stringify(dataset.shape) !== '[12,1800,3600]' ||
        units !== 'kg CO2 cell-1 month-1'
      )
        throw new Error(`GridFED ${name} metadata mismatch`);
    }
    const metadata = {
      ...CONFIG.co2,
      key: 'co2',
      width: 3600,
      height: 1800,
      bounds: [-180, -90, 180, 90],
      variables: expected,
      sourceUnits: 'kg CO2 cell-1 month-1',
      excludedVariables: [
        'BUNKER_AVIATION',
        'BUNKER_SHIPPING',
        'CEMENT_CARBONATION',
      ],
      conversion:
        'sum 12 months and OIL/GAS/COAL/CEMENT then divide kg by 1000',
      stripeRows,
    };
    return {
      width: 3600,
      height: 1800,
      bounds: [-180, -90, 180, 90],
      metadata,
      close: () => file.close(),
      async *rows() {
        for (let northRow = 0; northRow < 1800; northRow += stripeRows) {
          const count = Math.min(stripeRows, 1800 - northRow);
          const latStart = 1800 - northRow - count;
          const latEnd = 1800 - northRow;
          const sum = new Float64Array(count * 3600);
          for (const dataset of datasets) {
            const values = dataset.slice([[0, 12], [latStart, latEnd], []]);
            if (values.length !== 12 * count * 3600)
              throw new Error('GridFED slice length mismatch');
            const partial = sumMonthlyCo2Slice({
              slices: [values],
              width: 3600,
              rows: count,
            });
            for (let i = 0; i < sum.length; i += 1) sum[i] += partial[i];
          }
          // GridFED stores latitude south→north. The aggregation contract is
          // north→south so that row indices align with GeoTIFF readers and the
          // 30″ classification raster.
          for (let row = 0; row < count; row += 1)
            yield {
              row: northRow + row,
              values: sum.subarray(row * 3600, (row + 1) * 3600),
            };
        }
      },
    };
  } catch (error) {
    file.close();
    throw error;
  }
}

/** Sum GridFED monthly kg values into tonnes, reversing south→north rows. */
export function sumMonthlyCo2Slice({ slices, width, rows, months = 12 } = {}) {
  if (
    !Array.isArray(slices) ||
    slices.length === 0 ||
    !Number.isInteger(width) ||
    width < 1 ||
    !Number.isInteger(rows) ||
    rows < 1 ||
    !Number.isInteger(months) ||
    months < 1
  )
    throw new RangeError('CO2 slice dimensions are invalid');
  const result = new Float64Array(width * rows);
  for (const values of slices) {
    if (!values || values.length !== months * rows * width)
      throw new Error('CO2 slice length mismatch');
    for (let month = 0; month < months; month += 1)
      for (let southRow = 0; southRow < rows; southRow += 1) {
        const northRow = rows - 1 - southRow;
        const source = (month * rows + southRow) * width;
        const target = northRow * width;
        for (let x = 0; x < width; x += 1) {
          const value = Number(values[source + x]);
          if (!Number.isFinite(value) || value < 0)
            throw new Error(`Invalid CO2 value ${value}`);
          result[target + x] += value / 1000;
        }
      }
  }
  return result;
}

async function* sourceRows(reader, grid) {
  let row = 0;
  if (typeof reader.rows === 'function') {
    for await (const supplied of reader.rows()) {
      const values = supplied.values ?? supplied;
      const index = supplied.row ?? row;
      if (index !== row || values.length !== grid.width)
        throw new Error(
          `Source row ${index} is out of order or has incorrect width`,
        );
      yield { row, values };
      row += 1;
    }
  } else if (typeof reader.readWindow === 'function') {
    for (; row < grid.height; row += 1) {
      const values = await reader.readWindow({
        left: 0,
        top: row,
        right: grid.width,
        bottom: row + 1,
      });
      if (values.length !== grid.width)
        throw new Error('Source window has incorrect width');
      yield { row, values };
    }
  } else throw new TypeError('reader must supply rows() or readWindow()');
  if (row !== grid.height)
    throw new Error(`Reader yielded ${row} rows; expected ${grid.height}`);
}

/** Sliding stripe window: labels in RAM never grow with world height. */
async function labelWindow(labelPath, grid) {
  const iterator = readLabelStripes(labelPath, {
    width: grid.width,
    height: grid.height,
    stripeRows: 32,
  })[Symbol.asyncIterator]();
  const rows = new Map();
  let next = await iterator.next();
  let nextLocal = 0;
  return {
    rows,
    async ensure(first, last) {
      first = Math.max(0, first);
      last = Math.min(grid.height - 1, last);
      for (const row of rows.keys()) if (row < first) rows.delete(row);
      while (!next.done) {
        const stripe = next.value;
        const row = stripe.startRow + nextLocal;
        if (row > last) break;
        if (row >= first)
          rows.set(
            row,
            stripe.labels.subarray(
              nextLocal * grid.width,
              (nextLocal + 1) * grid.width,
            ),
          );
        nextLocal += 1;
        if (nextLocal === stripe.rowCount) {
          next = await iterator.next();
          nextLocal = 0;
        }
      }
    },
    close: () => iterator.return(),
  };
}

function closestLabel(rows, x, y, grid, radius) {
  let label = 0;
  let best = Infinity;
  for (let dy = -radius; dy <= radius; dy += 1) {
    const row = rows.get(y + dy);
    if (!row) continue;
    for (let dx = -radius; dx <= radius; dx += 1) {
      const distance = dx * dx + dy * dy;
      if (!distance || distance > radius * radius) continue;
      let col = x + dx;
      if (grid.periodicX) col = (col + grid.width) % grid.width;
      if (col < 0 || col >= grid.width) continue;
      const candidate = row[col];
      if (
        candidate &&
        (distance < best || (distance === best && candidate < label))
      ) {
        best = distance;
        label = candidate;
      }
    }
  }
  return label;
}

function gridAlignment(source, target) {
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  const factorX = source.dx / target.dx;
  const factorY = source.dy / target.dy;
  const offsetX = (source.west - target.west) / target.dx;
  const offsetY = (target.north - source.north) / target.dy;
  return {
    factorX,
    factorY,
    offsetX,
    offsetY,
    aligned:
      close(factorX, Math.round(factorX)) &&
      close(factorY, Math.round(factorY)) &&
      close(offsetX, Math.round(offsetX)) &&
      close(offsetY, Math.round(offsetY)),
    fine: close(factorX, 1) && close(factorY, 1),
  };
}

/**
 * Population/lights samples map by geographic pixel CENTRE. GDP coarse cells
 * apportion their full count over labelled subpixel spherical intersections;
 * ocean carries no weight. All coarse cells with no label are unassigned.
 * Arrays are indexed by paletteIndex, with null at slot 0. Country totals are
 * formed AFTER aggregation solely by summing admin1 children.
 */
export async function aggregateMetric({
  key,
  path,
  labelPath,
  width,
  height,
  units,
  countries,
  adminToCountryIndex,
  bounds = WORLD,
  reader,
  sourceWidth,
  sourceHeight,
  sourceBounds,
  metadata = {},
  nodata,
  scale,
  offset,
  oceanRadius = CONFIG[key]?.oceanRadius ?? 0,
  stripeRows,
  onProgress,
  enforcePopulationChecks = false,
  enforceCo2Checks = false,
} = {}) {
  if (!CONFIG[key]) throw new Error(`No approved reader for ${key}`);
  if (!labelPath) throw new TypeError('aggregateMetric requires labelPath');
  const target = checkGrid(width, height, bounds);
  if (!Number.isInteger(oceanRadius) || oceanRadius < 0 || oceanRadius > 2)
    throw new RangeError('coastal search radius must be 0–2 pixels');
  const supplied = Boolean(reader);
  reader ??= await (key === 'co2'
    ? openGridFedReader(path, { stripeRows })
    : openGeoTiffReader(path, { key, stripeRows }));
  let window;
  try {
    const source = checkGrid(
      sourceWidth ?? reader.width,
      sourceHeight ?? reader.height,
      sourceBounds ?? reader.bounds ?? bounds,
      true,
    );
    const alignment = gridAlignment(source, target);
    if (key === 'population' && !alignment.fine)
      throw new Error(
        'Population source must match classification pixel resolution; shifted grids map by pixel centres',
      );
    const adminUnits = (units ?? []).filter((unit) => unit.level === 'admin1');
    const countryRows =
      countries ?? (units ?? []).filter((unit) => unit.level === 'country');
    const maxLabel = Math.max(
      0,
      ...adminUnits.map((unit) => unit.paletteIndex),
    );
    const maxCountry = Math.max(
      0,
      ...countryRows.map((unit) => unit.paletteIndex),
    );
    if (!maxLabel || !maxCountry)
      throw new Error(
        'Admin1 and country inventories must provide positive palette indices',
      );
    const sums = new Float64Array(maxLabel + 1);
    const corrections = new Float64Array(maxLabel + 1);
    const seen = new Uint8Array(maxLabel + 1);
    const excluded = new Uint8Array(maxLabel + 1);
    const present = new Uint8Array(maxLabel + 1);
    const countryPresent = new Uint8Array(maxCountry + 1);
    for (const country of countryRows) {
      if (
        !Number.isInteger(country.paletteIndex) ||
        country.paletteIndex < 1 ||
        countryPresent[country.paletteIndex]
      )
        throw new Error(
          `Invalid/duplicate country paletteIndex ${country.paletteIndex}`,
        );
      countryPresent[country.paletteIndex] = 1;
    }
    for (const unit of adminUnits) {
      if (
        !Number.isInteger(unit.paletteIndex) ||
        unit.paletteIndex < 1 ||
        present[unit.paletteIndex]
      )
        throw new Error(
          `Invalid/duplicate admin paletteIndex ${unit.paletteIndex}`,
        );
      present[unit.paletteIndex] = 1;
      excluded[unit.paletteIndex] = Number(Boolean(unit.excluded));
    }
    const parent =
      adminToCountryIndex ??
      Uint16Array.from({ length: maxLabel + 1 }, (_, label) => {
        const unit = adminUnits.find((row) => row.paletteIndex === label);
        return (
          countryRows.find((country) => country.id === unit?.parentCountryId)
            ?.paletteIndex ?? 0
        );
      });
    for (const unit of adminUnits)
      if (!(
        parent[unit.paletteIndex] > 0 &&
        parent[unit.paletteIndex] <= maxCountry &&
        countryPresent[parent[unit.paletteIndex]]
      ))
        throw new Error(
          `Admin unit ${unit.id} lacks a parent country palette mapping`,
        );
    const sourceMetadata = { ...reader.metadata, ...metadata };
    const convertScale = scale ?? Number(sourceMetadata.scale ?? 1);
    const convertOffset = offset ?? Number(sourceMetadata.offset ?? 0);
    if (!Number.isFinite(convertScale) || !Number.isFinite(convertOffset))
      throw new Error('Invalid source scale/offset');
    const sourceNodata = sourceMetadata.nodata;
    const noData = (raw, index) =>
      raw == null ||
      Number.isNaN(raw) ||
      (sourceNodata != null && raw === Number(sourceNodata)) ||
      (typeof nodata === 'function'
        ? Boolean(nodata(raw, index))
        : nodata != null && raw === nodata);
    const total = scalarSum();
    const unassigned = scalarSum();
    const excludedTotal = scalarSum();
    const diagnostics = {
      validCells: 0,
      nodataCells: 0,
      sourceCells: 0,
      coastalAssignedCells: 0,
      excludedAssignedCells: 0,
      maximumLabelRowsBuffered: 0,
    };
    function assign(label, value) {
      if (!label) {
        unassigned.add(value);
        return;
      }
      if (label > maxLabel || !present[label])
        throw new Error(`Label raster references unknown admin label ${label}`);
      if (excluded[label]) {
        excludedTotal.add(value);
        unassigned.add(value);
        diagnostics.excludedAssignedCells += 1;
        return;
      }
      compensatedAdd(sums, corrections, label, value);
      seen[label] = 1;
    }
    window = await labelWindow(labelPath, target);
    const direct = key === 'population' || key === 'lights';
    const mapColumns = direct
      ? Int32Array.from({ length: source.width }, (_, x) => {
          const longitude = source.west + (x + 0.5) * source.dx;
          return Math.floor((longitude - target.west) / target.dx + 1e-9);
        })
      : null;
    for await (const { row, values: samples } of sourceRows(reader, source)) {
      const high = source.north - row * source.dy;
      const low = high - source.dy;
      const mappedRow = Math.floor(
        (target.north - (high + low) / 2) / target.dy + 1e-9,
      );
      const first = direct
        ? mappedRow - oceanRadius
        : Math.floor((target.north - high) / target.dy + 1e-9);
      const last = direct
        ? mappedRow + oceanRadius
        : Math.ceil((target.north - low) / target.dy - 1e-9) - 1;
      await window.ensure(first, last);
      diagnostics.maximumLabelRowsBuffered = Math.max(
        diagnostics.maximumLabelRowsBuffered,
        window.rows.size,
      );
      // Each latitude intersection's area factor is reused for every source x.
      const latitudeWeights = direct
        ? []
        : Array.from({ length: Math.max(0, last - first + 1) }, (_, j) => {
            const y = first + j;
            const overlapHigh = Math.min(high, target.north - y * target.dy);
            const overlapLow = Math.max(
              low,
              target.north - (y + 1) * target.dy,
            );
            return Math.max(
              0,
              RADIUS_SQUARED *
                (Math.sin(overlapHigh * DEG) - Math.sin(overlapLow * DEG)) *
                DEG,
            );
          });
      for (let x = 0; x < source.width; x += 1) {
        diagnostics.sourceCells += 1;
        const raw = samples[x];
        if (noData(raw, row * source.width + x)) {
          diagnostics.nodataCells += 1;
          continue;
        }
        const value = raw * convertScale + convertOffset;
        if (
          !Number.isFinite(value) ||
          value < 0 ||
          (key === 'lights' && value > 63)
        )
          throw new Error(
            `Invalid ${key} value ${value} at source (${x}, ${row})`,
          );
        diagnostics.validCells += 1;
        total.add(value);
        if (direct) {
          let col = mapColumns[x];
          if (target.periodicX) col = ((col % width) + width) % width;
          let label =
            col >= 0 && col < width
              ? (window.rows.get(mappedRow)?.[col] ?? 0)
              : 0;
          if (
            !label &&
            oceanRadius &&
            mappedRow >= 0 &&
            mappedRow < height &&
            col >= 0 &&
            col < width
          ) {
            label = closestLabel(
              window.rows,
              col,
              mappedRow,
              target,
              oceanRadius,
            );
            if (label) diagnostics.coastalAssignedCells += 1;
          }
          assign(label, value);
          continue;
        }
        const west = source.west + x * source.dx;
        const east = west + source.dx;
        const startX = Math.max(
          0,
          Math.floor((west - target.west) / target.dx + 1e-9),
        );
        const endX = Math.min(
          width - 1,
          Math.ceil((east - target.west) / target.dx - 1e-9) - 1,
        );
        const areas = new Map();
        let area = 0;
        for (let y = first; y <= last; y += 1) {
          const labels = window.rows.get(y);
          if (!labels) continue;
          const latitudeFactor = latitudeWeights[y - first];
          for (let col = startX; col <= endX; col += 1) {
            const label = labels[col];
            if (!label) continue;
            const overlapWidth = Math.max(
              0,
              Math.min(east, target.west + (col + 1) * target.dx) -
                Math.max(west, target.west + col * target.dx),
            );
            const weight = overlapWidth * latitudeFactor;
            areas.set(label, (areas.get(label) ?? 0) + weight);
            area += weight;
          }
        }
        if (!(area > 0)) unassigned.add(value);
        else
          for (const [label, weight] of areas)
            assign(label, (value * weight) / area);
      }
      if (row % 128 === 0) onProgress?.({ key, row, height: source.height });
    }
    const values = Array.from(sums, (value, index) =>
      seen[index] ? value : null,
    );
    const countrySums = new Float64Array(maxCountry + 1);
    const countryCorrections = new Float64Array(maxCountry + 1);
    const countrySeen = new Uint8Array(maxCountry + 1);
    for (const unit of adminUnits) {
      const label = unit.paletteIndex;
      if (values[label] == null) continue;
      compensatedAdd(
        countrySums,
        countryCorrections,
        parent[label],
        values[label],
      );
      countrySeen[parent[label]] = 1;
    }
    const countryValues = Array.from(countrySums, (value, index) =>
      countrySeen[index] ? value : null,
    );
    const assigned = scalarSum();
    for (const value of values) if (value != null) assigned.add(value);
    const difference = assigned.value + unassigned.value - total.value;
    const relativeError = total.value
      ? Math.abs(difference) / Math.abs(total.value)
      : difference === 0
        ? 0
        : Infinity;
    Object.assign(diagnostics, {
      validTotal: total.value,
      assignedTotal: assigned.value,
      unassigned: unassigned.value,
      excludedTotal: excludedTotal.value,
      difference,
      relativeError,
      unassignedFraction: total.value ? unassigned.value / total.value : 0,
      missingUnitCount: adminUnits.filter(
        (unit) => values[unit.paletteIndex] == null && !unit.excluded,
      ).length,
    });
    if (!(relativeError < 1e-9))
      throw new Error(
        `Metric ${key} conservation error ${relativeError} exceeds 1e-9`,
      );
    if (enforcePopulationChecks && key === 'population') {
      if (!(diagnostics.unassignedFraction < 0.005))
        throw new Error(
          `Population unassigned fraction ${diagnostics.unassignedFraction} exceeds 0.5%`,
        );
      if (!(Math.abs(total.value / 7.8e9 - 1) <= 0.02))
        throw new Error(
          `Population global total ${total.value} differs from official 2020 scale by more than 2%`,
        );
    }
    if (
      enforceCo2Checks &&
      key === 'co2' &&
      !(Math.abs(total.value / 34.3e9 - 1) <= 0.05)
    )
      throw new Error(
        `CO2 global total ${total.value} differs from 2020 fossil-emission scale by more than 5%`,
      );
    return {
      values,
      countryValues,
      diagnostics,
      metadata: {
        ...sourceMetadata,
        ...CONFIG[key],
        key,
        sourceWidth: source.width,
        sourceHeight: source.height,
        sourceBounds: source.bounds,
        labelWidth: width,
        labelHeight: height,
        labelBounds: target.bounds,
        alignment: alignment.aligned
          ? 'aligned-cell-edges'
          : direct
            ? 'pixel-centre-map'
            : 'spherical-intersection',
        resolutionFactors: [alignment.factorX, alignment.factorY],
        sourceScale: convertScale,
        sourceOffset: convertOffset,
        sourceNodata: sourceNodata ?? null,
        coastalRadius: direct ? oceanRadius : 0,
        countryAggregation: 'sum-of-admin1-children',
      },
    };
  } finally {
    try {
      if (window) await window.close();
    } finally {
      if (!supplied) await reader.close();
    }
  }
}

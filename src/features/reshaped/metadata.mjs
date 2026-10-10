export const AREA_RATIO_LOG2_SCALE = 1024;
export const AREA_RATIO_MAX_RELATIVE_ERROR =
  2 ** (0.5 / AREA_RATIO_LOG2_SCALE) - 1;

/** Undo byte shuffling without depending on platform endianness. */
export function decodeNumericColumn(encoded, count, bytes, kind) {
  if (typeof encoded !== 'string') throw new Error('Invalid numeric column');
  const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  if (raw.length !== count * bytes)
    throw new Error('Numeric column length mismatch');
  const data = new Uint8Array(raw.length);
  for (let byte = 0; byte < bytes; byte += 1)
    for (let i = 0; i < count; i += 1)
      data[i * bytes + byte] = raw[byte * count + i];
  const view = new DataView(data.buffer);
  return Array.from({ length: count }, (_, i) => view[kind](i * bytes, true));
}

export function decodeUnits(asset) {
  if (
    asset?.formatVersion !== 1 ||
    asset.encoding !== 'columns-shuffled-le' ||
    asset.year !== 2020 ||
    asset.codeEncoding !== 'prefix-base36'
  )
    throw new Error('Invalid Reshaped Earth units format');
  const { countries, parent, en, zh, countryNames } = asset;
  const codes = decodeCodes(asset.codes);
  if (
    ![countries, parent, en, zh, countryNames?.en, countryNames?.zh].every(
      Array.isArray,
    ) ||
    parent.length !== codes.length ||
    en.length !== codes.length ||
    zh.length !== codes.length ||
    countryNames.en.length !== countries.length ||
    countryNames.zh.length !== countries.length
  )
    throw new Error('Invalid Reshaped Earth unit columns');
  const count = codes.length + countries.length;
  const areas = decodeNumericColumn(asset.areaKm2, count, 8, 'getFloat64');
  const points = decodeNumericColumn(asset.pointPixels, count, 4, 'getUint32');
  const excluded = new Set(asset.excluded);
  return Array.from({ length: count }, (_, i) => {
    const admin = i < codes.length;
    const countryId = admin
      ? countries[parent[i]]
      : countries[i - codes.length];
    if (typeof countryId !== 'string' || !(areas[i] >= 0))
      throw new Error('Invalid Reshaped Earth unit');
    const name = admin
      ? { en: en[i], zh: zh[i] }
      : {
          en: countryNames.en[i - codes.length],
          zh: countryNames.zh[i - codes.length],
        };
    if (
      typeof name.en !== 'string' ||
      !name.en.trim() ||
      (name.zh !== null && (typeof name.zh !== 'string' || !name.zh.trim()))
    )
      throw new Error('Invalid Reshaped Earth display name');
    const pixel = points[i];
    if (pixel !== 0xffffffff && pixel >= 43200 * 21600)
      throw new Error('Invalid representative pixel');
    return {
      id: admin ? `${countryId}:${codes[i]}` : countryId,
      level: admin ? 'admin1' : 'country',
      parentCountryId: countryId,
      name,
      areaKm2: areas[i],
      representativePoint:
        pixel === 0xffffffff
          ? null
          : {
              longitude: -180 + ((pixel % 43200) + 0.5) / 120,
              latitude: 90 - (Math.floor(pixel / 43200) + 0.5) / 120,
            },
      paletteIndex: admin ? i + 1 : i - codes.length + 1,
      rasterId: admin ? i + 1 : i - codes.length + 1,
      excluded: excluded.has(i),
    };
  });
}

function decodeCodes(encoded) {
  if (!Array.isArray(encoded))
    throw new Error('Invalid Reshaped Earth code column');
  let previous = '';
  return encoded.map((value) => {
    if (typeof value !== 'string' || !/^[0-9a-z]+:/.test(value))
      throw new Error('Invalid Reshaped Earth prefix code');
    const separator = value.indexOf(':');
    const prefix = Number.parseInt(value.slice(0, separator), 36);
    if (!Number.isSafeInteger(prefix) || prefix > previous.length)
      throw new Error('Invalid Reshaped Earth code prefix length');
    const code = previous.slice(0, prefix) + value.slice(separator + 1);
    if (!code) throw new Error('Empty Reshaped Earth unit code');
    previous = code;
    return code;
  });
}

export function decodeValues(asset, units) {
  if (
    asset?.formatVersion !== 1 ||
    asset.encoding !== 'columns-shuffled-le' ||
    asset.year !== 2020 ||
    !Array.isArray(asset.metrics)
  )
    throw new Error('Invalid Reshaped Earth values format');
  const admins = units.filter((u) => u.level === 'admin1');
  const rows = units.map((u) => ({
    id: u.id,
    level: u.level,
    values: {},
    worldShare: {},
    areaRatio: {},
    year: asset.year,
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const key of asset.metrics) {
    const values = decodeNumericColumn(
      asset.values[key],
      admins.length,
      8,
      'getFloat64',
    );
    const ratios = decodeNumericColumn(
      asset.areaRatio[key],
      units.length,
      2,
      'getUint16',
    );
    const total = asset.totals[key];
    if (!(total > 0)) throw new Error('Invalid Reshaped Earth metric total');
    const sums = new Map();
    for (let i = 0; i < admins.length; i += 1) {
      const raw = values[i];
      if (!Number.isNaN(raw) && !(raw >= 0 && Number.isFinite(raw)))
        throw new Error('Invalid Reshaped Earth value');
      const value = Number.isNaN(raw) ? null : raw;
      byId.get(admins[i].id).values[key] = value;
      if (value !== null) {
        const id = admins[i].parentCountryId;
        const pair = sums.get(id) ?? [0, 0];
        const adjusted = value - pair[1],
          next = pair[0] + adjusted;
        pair[1] = next - pair[0] - adjusted;
        pair[0] = next;
        sums.set(id, pair);
      }
    }
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.level === 'country')
        row.values[key] = sums.get(row.id)?.[0] ?? null;
      row.worldShare[key] =
        row.values[key] === null ? null : row.values[key] / total;
      row.areaRatio[key] =
        ratios[i] === 0
          ? null
          : 2 ** ((ratios[i] - 32768) / AREA_RATIO_LOG2_SCALE);
    }
  }
  return rows;
}

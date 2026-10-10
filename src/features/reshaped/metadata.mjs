const METRICS = ['population', 'gdp', 'co2', 'lights'];
export function decodeUnits(asset) {
  if (
    asset?.formatVersion !== 4 ||
    asset.encoding !== 'country-json' ||
    asset.year !== 2020 ||
    !Array.isArray(asset.units) ||
    !asset.units.length ||
    asset.units.length > 255
  )
    throw new Error('Invalid Reshaped Earth units format');
  const ids = new Set();
  for (const [i, u] of asset.units.entries()) {
    if (
      typeof u.id !== 'string' ||
      !u.id ||
      ids.has(u.id) ||
      u.paletteIndex !== i + 1 ||
      u.rasterId !== i + 1 ||
      !Number.isFinite(u.areaKm2) ||
      u.areaKm2 < 0 ||
      typeof u.excluded !== 'boolean' ||
      !['en', 'zh'].every(
        (locale) =>
          typeof u.name?.[locale] === 'string' && u.name[locale].trim(),
      ) ||
      u.level !== undefined ||
      u.parentCountryId !== undefined
    )
      throw new Error('Invalid Reshaped Earth country');
    const p = u.representativePoint;
    if (
      p !== null &&
      (!p ||
        !Number.isFinite(p.longitude) ||
        Math.abs(p.longitude) > 180 ||
        !Number.isFinite(p.latitude) ||
        Math.abs(p.latitude) > 90)
    )
      throw new Error('Invalid representative point');
    ids.add(u.id);
  }
  return asset.units;
}
export function decodeValues(asset, units) {
  if (
    asset?.formatVersion !== 4 ||
    asset.encoding !== 'country-json' ||
    asset.year !== 2020 ||
    !Array.isArray(asset.metrics) ||
    ![3, 4].includes(asset.metrics.length) ||
    JSON.stringify(asset.metrics) !==
      JSON.stringify(
        METRICS.filter((key) => key !== 'gdp' || asset.metrics.includes('gdp')),
      ) ||
    !Array.isArray(asset.rows) ||
    asset.rows.length !== units.length
  )
    throw new Error('Invalid Reshaped Earth values format');
  for (const key of asset.metrics)
    if (
      !(asset.totals?.[key] > 0) ||
      !Number.isFinite(asset.totals[key]) ||
      typeof asset.sourceIds?.[key] !== 'string'
    )
      throw new Error('Invalid Reshaped Earth metric metadata');
  for (const [i, row] of asset.rows.entries()) {
    if (row.id !== units[i].id || row.year !== 2020 || row.level !== undefined)
      throw new Error('Invalid Reshaped Earth value row');
    for (const field of ['values', 'worldShare', 'areaRatio', 'padding'])
      if (
        !row[field] ||
        JSON.stringify(Object.keys(row[field]).sort()) !==
          JSON.stringify([...asset.metrics].sort())
      )
        throw new Error('Reshaped Earth row metrics differ from publication');
    for (const key of asset.metrics) {
      const value = row.values?.[key],
        share = row.worldShare?.[key],
        ratio = row.areaRatio?.[key];
      if (value !== null && (!Number.isFinite(value) || value < 0))
        throw new Error('Invalid Reshaped Earth value');
      if (value === null || units[i].excluded) {
        if (share !== null || ratio !== null)
          throw new Error('Missing or excluded country has a result');
      } else if (
        !Number.isFinite(share) ||
        Math.abs(share - value / asset.totals[key]) > 1e-12 ||
        !Number.isFinite(ratio) ||
        ratio <= 0
      )
        throw new Error('Invalid Reshaped Earth result');
      const padding = row.padding[key];
      if (padding !== null) {
        if (
          !padding ||
          padding.id !== row.id ||
          padding.paletteIndex !== units[i].paletteIndex ||
          ![
            'actualArea',
            'targetArea',
            'coreArea',
            'paddingArea',
            'rasterActualArea',
          ].every(
            (name) => Number.isFinite(padding[name]) && padding[name] > 0,
          ) ||
          !(padding.paddingFraction > 0 && padding.paddingFraction <= 1) ||
          !Number.isFinite(padding.onePixelRelativeError) ||
          padding.onePixelRelativeError < 0 ||
          Math.abs(
            padding.paddingFraction - padding.paddingArea / padding.actualArea,
          ) > 1e-10 ||
          Math.abs(padding.coreArea - padding.targetArea) / padding.targetArea >
            padding.onePixelRelativeError + 1e-10 ||
          value === null ||
          units[i].excluded
        )
          throw new Error('Invalid Reshaped Earth padding result');
      }
    }
  }
  return asset.rows;
}

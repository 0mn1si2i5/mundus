import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { sha256 } from './friction.mjs';

export async function resolveCityNames(cities, root) {
  const [
    { matchNames },
    { ISOLATION_NAME_OVERRIDES },
    { ISOLATION_COUNTRY_NAMES },
    { decodeGeoNamesCityIndex },
    { haversineKm },
  ] = await Promise.all([
    import('../build-urban-isolation.mjs'),
    import('../../src/features/isolation/isolationNameOverrides.ts'),
    import('../../src/features/isolation/isolationCountryNames.ts'),
    import('../../src/features/antipodes/geonamesCities.ts'),
    import('../../src/features/isolation/isolationMetric.ts'),
  ]);
  const bytes = await readFile(
    resolve(root, 'src/data/generated/geonames-major-cities.json'),
  );
  const manifest = JSON.parse(
    await readFile(
      resolve(root, 'src/data/manifests/geonames-major-cities.json'),
      'utf8',
    ),
  );
  if (sha256(bytes) !== manifest.derivedAsset.sha256)
    throw new Error('GeoNames naming snapshot SHA-256 mismatch');
  const geoNames = decodeGeoNamesCityIndex(JSON.parse(bytes.toString('utf8')));
  const rows = [];
  for (const city of cities) {
    const override = ISOLATION_NAME_OVERRIDES[String(city.id)];
    const nameEn = override?.nameEn?.trim() || city.sourceName;
    const candidates = geoNames.map((candidate) => ({
      id: String(candidate.id),
      nameEn: candidate.name.en,
      nameZh: candidate.name.zh,
      nameZhFallback: candidate.nameZhFallback,
      population: candidate.population,
      distanceKm: haversineKm(city.point, candidate.point),
    }));
    const match = matchNames(
      { id: String(city.id), name: nameEn },
      candidates,
      ISOLATION_NAME_OVERRIDES,
    );
    rows.push({
      id: city.id,
      name: { en: nameEn, zh: match.nameZh },
      country: {
        en: city.countryName,
        zh: ISOLATION_COUNTRY_NAMES[city.countryName] ?? null,
      },
      ghslName: city.sourceName,
      matchType: match.nameZh ? match.matchType : 'none',
      proximityCandidate: match.candidateNameZh ?? null,
      proximityDistanceKm:
        match.matchType === 'proximity' ? match.matchDistanceKm : null,
      hasOverride: Boolean(override),
    });
  }
  return rows;
}

export function summarizeNameReview(names, requiredIds) {
  const required = new Set(requiredIds);
  const matchCounts = { override: 0, exact: 0, none: 0 };
  let missingChineseCityCount = 0;
  let requiredMissingChineseCityCount = 0;
  for (const city of names) {
    const missingChinese = !city.name.zh?.trim();
    if (missingChinese) {
      missingChineseCityCount += 1;
      if (required.has(city.id)) requiredMissingChineseCityCount += 1;
    }
    const matchType =
      city.matchType ??
      city.nameMatchType ??
      (missingChinese ? 'none' : city.hasOverride ? 'override' : 'exact');
    if (!Object.hasOwn(matchCounts, matchType))
      throw new Error(`Invalid name provenance for city ${city.id}`);
    matchCounts[matchType] += 1;
  }
  return {
    requiredCityCount: required.size,
    missingChineseCityCount,
    requiredMissingChineseCityCount,
    matchCounts,
  };
}

export async function requireReviewedNames(names, requiredIds, reportPath) {
  const required = new Set(requiredIds);
  const missingRequiredEnglishNames = names.filter(
    (city) => required.has(city.id) && !city.name.en?.trim(),
  );
  const missingCountryNames = names.filter(
    (city) => !city.country.en?.trim() || !city.country.zh?.trim(),
  );
  const missing = names.filter(
    (city) =>
      (required.has(city.id) && !city.name.en?.trim()) ||
      !city.country.en?.trim() ||
      !city.country.zh?.trim(),
  );
  const seen = new Map();
  const duplicates = [];
  for (const city of names.filter((city) => city.name.zh?.trim())) {
    const prior = seen.get(city.name.zh);
    if (
      prior &&
      prior.id !== city.id &&
      !(
        prior.hasOverride &&
        prior.matchType === 'override' &&
        city.hasOverride &&
        city.matchType === 'override'
      )
    )
      duplicates.push({ nameZh: city.name.zh, ids: [prior.id, city.id] });
    seen.set(city.name.zh, city);
  }
  const audit = {
    requiredCities: required.size,
    nameReview: summarizeNameReview(names, required),
    missingCount: missing.length,
    missing,
    missingRequiredEnglishNames,
    missingCountryNames,
    missingChineseCities: names.filter((city) => !city.name.zh?.trim()),
    duplicateChineseNames: duplicates,
    cities: names.map(({ hasOverride, ...city }) => ({
      ...city,
      required: required.has(city.id),
    })),
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(audit, null, 2)}\n`);
  if (missing.length || duplicates.length) {
    throw new Error(
      `City reach name review required: ${missingRequiredEnglishNames.length} required cities lack English display names; ${missingCountryNames.length} asset cities lack reviewed country names; ${duplicates.length} conflicting Chinese names. Review ${reportPath}; no production assets were published.`,
    );
  }
  return audit;
}

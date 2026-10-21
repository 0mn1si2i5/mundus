import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  COUNTRY_NAMES,
  GEONAMES_COUNTRY_AREAS,
  GHSL_COUNTRY_AREAS,
  REGION_NAMES,
  areaNameZh,
  geonamesCountryNameZh,
} from '../src/features/globe/countryNames.ts';

const HAN = /\p{Script=Han}/u;
const LATIN = /\p{Script=Latin}/u;

/**
 * Every country the interface can show must have a reviewed Chinese name in
 * the shared Mundus country table. Returns the number of names checked.
 */
export async function verifyCountryNames(root = process.cwd()) {
  const json = async (path) =>
    JSON.parse(await readFile(resolve(root, path), 'utf8'));
  const [countries, geonames, isolation, reach, reshapedManifest] =
    await Promise.all([
      json('src/data/generated/mundus-countries-50m.json'),
      json('src/data/generated/geonames-major-cities.json'),
      json('src/data/generated/urban-isolation.json'),
      json('src/data/generated/city-reach.json'),
      json('src/data/manifests/reshaped-earth.json'),
    ]);

  for (const [key, name] of [
    ...Object.entries(COUNTRY_NAMES),
    ...Object.entries(REGION_NAMES),
  ])
    assert.ok(
      HAN.test(name.zh) && !LATIN.test(name.zh),
      `Country table entry ${key} needs a Chinese name: ${name.zh}`,
    );
  for (const [key, region] of Object.entries(REGION_NAMES))
    assert.ok(
      COUNTRY_NAMES[region.countryId],
      `Region ${key} belongs to unknown country ${region.countryId}`,
    );
  for (const [source, areas] of [
    ['GeoNames', GEONAMES_COUNTRY_AREAS],
    ['GHSL', GHSL_COUNTRY_AREAS],
  ])
    for (const [key, area] of Object.entries(areas))
      assert.ok(areaNameZh(area), `${source} ${key} maps to unknown ${area}`);

  const units = countries.objects.countries.geometries.map(
    (geometry) => geometry.properties,
  );
  assert.deepEqual(
    units.map((unit) => unit.countryId).sort(),
    Object.keys(COUNTRY_NAMES).sort(),
    'The country table must cover exactly the Mundus country units',
  );
  for (const unit of units)
    assert.equal(
      COUNTRY_NAMES[unit.countryId].en,
      unit.name,
      `Country table English name differs for ${unit.countryId}`,
    );

  const reshapedUnits = await json(
    `${reshapedManifest.derivedAssets['units.json'].path}`,
  );
  for (const unit of reshapedUnits.units)
    assert.equal(
      COUNTRY_NAMES[unit.id]?.en,
      unit.name.en,
      `Reshaped Earth unit ${unit.id} is not in the country table`,
    );

  const strings = geonames.strings;
  for (const row of geonames.rows) {
    const code = strings[row[5]];
    assert.equal(
      strings[row[9]],
      geonamesCountryNameZh(code),
      `GeoNames city ${row[0]} does not use the reviewed name for ${code}`,
    );
  }

  const ghslNames = new Set([
    ...isolation.cities.map((row) => isolation.strings[row[6]]),
    ...reach.cities.map((city) => city.country.en),
  ]);
  for (const name of ghslNames)
    assert.ok(
      GHSL_COUNTRY_AREAS[name],
      `GHSL country ${name} has no reviewed Chinese name`,
    );
  return Object.keys(COUNTRY_NAMES).length + Object.keys(REGION_NAMES).length;
}

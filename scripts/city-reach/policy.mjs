const VERIFIED_AT = '2026-10-11';
const schengen =
  'AUT BEL BGR HRV CZE DNK EST FIN FRA DEU GRC HUN ISL ITA LVA LIE LTU LUX MLT NLD NOR POL PRT ROU SVK SVN ESP SWE CHE'.split(
    ' ',
  );

export const OPEN_BORDER_RULES = Object.freeze([
  {
    countries: schengen,
    basis: 'Schengen participants; transparent model omits checkpoint delays',
    sourceUrl:
      'https://home-affairs.ec.europa.eu/policies/schengen/schengen-area_en',
    verifiedAt: VERIFIED_AT,
  },
  {
    countries: [...schengen, 'MCO', 'SMR', 'VAT', 'AND', 'ALD'],
    basis:
      'Owner-reviewed v0 extension to neighbouring microstates and Åland; this is a model rule, not a claim that all are Schengen members',
    sourceUrl:
      'https://home-affairs.ec.europa.eu/policies/schengen/schengen-area_en',
    verifiedAt: VERIFIED_AT,
  },
  {
    countries: ['GBR', 'IRL', 'IMN'],
    basis:
      'Common Travel Area; water remains impassable and ferries are excluded',
    sourceUrl:
      'https://www.gov.uk/government/publications/common-travel-area-guidance',
    verifiedAt: VERIFIED_AT,
  },
  {
    countries: ['IND', 'NPL'],
    basis: 'Owner-reviewed open-border scenario',
    sourceUrl:
      'https://www.mea.gov.in/Portal/ForeignRelation/India-Nepal_Bilateral_Brief.pdf',
    verifiedAt: VERIFIED_AT,
  },
  {
    countries: ['IND', 'BTN'],
    basis: 'Owner-reviewed India–Bhutan model scenario',
    sourceUrl:
      'https://www.mea.gov.in/Portal/ForeignRelation/Bhutan_Jan_2016.pdf',
    verifiedAt: VERIFIED_AT,
  },
  {
    countries: ['CHN', 'HKG', 'MAC'],
    basis:
      'Owner-reviewed within-sovereignty projection scenario; checkpoint delays omitted',
    sourceUrl:
      'https://www.gov.hk/en/nonresidents/visitinghk/entryinquiry/index.htm',
    verifiedAt: VERIFIED_AT,
  },
  {
    countries: ['CYP', 'WSB'],
    basis: 'Owner-reviewed Cyprus and Akrotiri routing scenario',
    sourceUrl: 'https://www.sbaadministration.org/',
    verifiedAt: VERIFIED_AT,
  },
  {
    countries: ['CYP', 'ESB'],
    basis: 'Owner-reviewed Cyprus and Dhekelia routing scenario',
    sourceUrl: 'https://www.sbaadministration.org/',
    verifiedAt: VERIFIED_AT,
  },
  {
    countries: ['FRA', 'MAF'],
    basis: 'Owner-reviewed French Saint Martin routing scenario',
    sourceUrl: 'https://www.com-saint-martin.fr/',
    verifiedAt: VERIFIED_AT,
  },
  {
    countries: ['MAF', 'SXM'],
    basis: 'Owner-reviewed Saint Martin/Sint Maarten land-border scenario',
    sourceUrl: 'https://www.com-saint-martin.fr/',
    verifiedAt: VERIFIED_AT,
  },
]);

export const ROUTE_MERGES = Object.freeze({
  KAS: 'IND',
  KAB: 'KAZ',
  SAH: 'MAR',
});
export const ROUTE_UNKNOWN = Object.freeze([
  'CNM',
  'BRT',
  'BJN',
  'SER',
  'SCR',
  'SPI',
  'PGA',
  'ATA',
]);
export const ALWAYS_DISPUTED = Object.freeze(['KAS', 'SAH']);

export function openCountryPairs(countryCodes) {
  const indices = new Map(countryCodes.map((code, index) => [code, index]));
  const pairs = new Set();
  for (const rule of OPEN_BORDER_RULES) {
    for (let a = 0; a < rule.countries.length; a += 1) {
      for (let b = a + 1; b < rule.countries.length; b += 1) {
        const left = indices.get(rule.countries[a]);
        const right = indices.get(rule.countries[b]);
        if (left !== undefined && right !== undefined)
          pairs.add(
            Math.min(left, right) * countryCodes.length + Math.max(left, right),
          );
      }
    }
  }
  return pairs;
}

export function borderAllowed(left, right, countryCount, openPairs) {
  return (
    left === right ||
    left === 0 ||
    right === 0 ||
    openPairs.has(Math.min(left, right) * countryCount + Math.max(left, right))
  );
}

export function normalizeRouting(raw, codes) {
  const indices = new Map(codes.map((code, index) => [code, index]));
  const table = new Uint16Array(codes.length);
  for (let index = 1; index < codes.length; index += 1) {
    const code = codes[index];
    if (ROUTE_UNKNOWN.includes(code)) continue;
    const target = ROUTE_MERGES[code] ?? code;
    const routed = indices.get(target);
    if (routed === undefined)
      throw new Error(`Missing routing merge target ${target}`);
    table[index] = routed;
  }
  return Uint16Array.from(raw, (value) => table[value]);
}

// Exact squared Euclidean distance transform, without dateline wrapping.
// Two linear passes replace an all-country scan for every unknown land cell.
export function fillUnknownCountries(route, land, width, height) {
  if (route.length !== width * height || land.length !== route.length)
    throw new Error('Country grid dimensions disagree');
  if (!route.some((value) => value > 0))
    throw new Error('No known country cell for nearest-country assignment');
  const size = route.length;
  const distances = new Float64Array(size);
  const sources = new Int32Array(size);
  const maximum = Math.max(width, height);
  const input = new Float64Array(maximum);
  const output = new Float64Array(maximum);
  const arg = new Int32Array(maximum);
  const vertices = new Int32Array(maximum);
  const boundaries = new Float64Array(maximum + 1);
  const transform = (length) => {
    let last = -1;
    for (let q = 0; q < length; q += 1) {
      if (!Number.isFinite(input[q])) continue;
      let crossing = -Infinity;
      while (last >= 0) {
        const previous = vertices[last];
        crossing =
          (input[q] + q * q - (input[previous] + previous * previous)) /
          (2 * (q - previous));
        if (crossing > boundaries[last]) break;
        last -= 1;
      }
      last += 1;
      vertices[last] = q;
      boundaries[last] = last === 0 ? -Infinity : crossing;
      boundaries[last + 1] = Infinity;
    }
    if (last < 0) {
      output.fill(Infinity, 0, length);
      arg.fill(-1, 0, length);
      return;
    }
    let candidate = 0;
    for (let q = 0; q < length; q += 1) {
      while (boundaries[candidate + 1] < q) candidate += 1;
      const source = vertices[candidate];
      output[q] = (q - source) ** 2 + input[source];
      arg[q] = source;
    }
  };
  for (let column = 0; column < width; column += 1) {
    for (let row = 0; row < height; row += 1)
      input[row] = route[row * width + column] ? 0 : Infinity;
    transform(height);
    for (let row = 0; row < height; row += 1) {
      const index = row * width + column;
      distances[index] = output[row];
      sources[index] = arg[row] < 0 ? -1 : arg[row] * width + column;
    }
  }
  const result = route.slice();
  let filled = 0;
  for (let row = 0; row < height; row += 1) {
    input.set(distances.subarray(row * width, (row + 1) * width));
    transform(width);
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      if (!land[index] || result[index]) continue;
      result[index] = route[sources[row * width + arg[column]]];
      filled += 1;
    }
  }
  return { route: result, filled };
}

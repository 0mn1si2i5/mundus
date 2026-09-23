import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CSV_URL =
  'https://raw.githubusercontent.com/sigpwned/popular-names-by-country-dataset/v1.2/common-surnames-by-country.csv';
const COUNTRY_INFO_URL =
  'https://download.geonames.org/export/dump/countryInfo.txt';
const CSV_SHA256 =
  '32cb28bea558a9d353feeef097da03c6488a4e7ba9398e5983cee2f0b9caa91c';
const COUNTRY_INFO_SHA256 =
  '93bafc525813f22e4711ff9ed6d626343094ce48c26388dc7c49189b3d7d5512';
const IRANIAN_CSV_URL =
  'https://raw.githubusercontent.com/farbodbj/iranian-surname-frequencies/9fb2fdccb62445b52e933d4d7929a52e01bd6011/iranian-surname-frequencies.csv';
const IRANIAN_CSV_SHA256 =
  'e71a59fd87e0da0fc6aeef8b44ed6c3b2b4c00adc2ade0d51af5a58281b34de7';
const IRANIAN_SOURCE_URL =
  'https://github.com/farbodbj/iranian-surname-frequencies/tree/9fb2fdccb62445b52e933d4d7929a52e01bd6011';
const AFRICA_SOURCE_URL =
  'https://www.pulse.ng/story/these-are-the-most-common-surnames-in-every-african-country-2024121210174957832';
const MANUAL_OBSERVATION_SOURCE_URL =
  'https://en.wikipedia.org/wiki/Lists_of_most_common_surnames';
const SWEDEN_SOURCE_URL =
  'https://web.archive.org/web/20130921054130id_/http://www.scb.se/Pages/TableAndChart____31063.aspx';
const SWEDEN_SOURCE_SHA256 =
  '8e5d469eabd46e67174b45bfccc73d2097a93af1e88b199694e78a5a196e4ad9';
const SWEDEN_WIKIPEDIA_RAW_URL =
  'https://en.wikipedia.org/w/index.php?title=List_of_most_common_surnames_in_European_countries&action=raw';

const reviewedChinese = new Map([
  ['CN:CN-1', '王'],
  ['TW:TW-1', '陈'],
  ['KR:KR-1', '金'],
  ['JP:JP-1', '佐藤'],
  ['VN:VN-1', '阮'],
]);

const wikipediaSourceUrls = {
  asia: 'https://en.wikipedia.org/wiki/List_of_most_common_surnames_in_Asian_countries',
  europe:
    'https://en.wikipedia.org/wiki/List_of_most_common_surnames_in_European_countries',
  northAmerica:
    'https://en.wikipedia.org/wiki/List_of_most_common_surnames_in_North_American_countries',
  oceania:
    'https://en.wikipedia.org/wiki/List_of_most_common_surnames_in_Oceanian_countries',
  southAmerica:
    'https://en.wikipedia.org/wiki/List_of_most_common_surnames_in_South_American_countries',
};

const wikipediaCountryRegions = new Map([
  ...[
    'AM',
    'AZ',
    'BD',
    'CN',
    'IN',
    'IL',
    'JP',
    'KH',
    'KR',
    'KZ',
    'LK',
    'NP',
    'PH',
    'TR',
    'TW',
    'VN',
  ].map((country) => [country, 'asia']),
  ...[
    'AL',
    'AT',
    'BA',
    'BE',
    'BG',
    'BY',
    'CH',
    'CZ',
    'DE',
    'DK',
    'EE',
    'ES',
    'FI',
    'FO',
    'FR',
    'GB',
    'GE',
    'GR',
    'HR',
    'HU',
    'IE',
    'IS',
    'IT',
    'LT',
    'LU',
    'LV',
    'MD',
    'ME',
    'MK',
    'MT',
    'NL',
    'NO',
    'PL',
    'PT',
    'RO',
    'RS',
    'RU',
    'SI',
    'SK',
    'SR',
    'UA',
    'XK',
  ].map((country) => [country, 'europe']),
  ...['CA', 'US'].map((country) => [country, 'northAmerica']),
  ...['AU', 'FJ', 'NZ'].map((country) => [country, 'oceania']),
  ...['AR', 'BR', 'CL', 'CO', 'PE', 'PY'].map((country) => [
    country,
    'southAmerica',
  ]),
  ...['CR', 'CU', 'DO', 'GT', 'MX', 'SV'].map((country) => [
    country,
    'northAmerica',
  ]),
]);

// This official, country-wide table is outside the v1.2 CSV and is kept as a
// small reviewed supplement. The source hash and immutable URL are recorded in
// the manifest; the row remains deliberately comparable only within Sweden's
// own source snapshot.
const supplementalRankOneCountries = [
  {
    countryIso2: 'SE',
    sourceUrls: [
      'https://en.wikipedia.org/wiki/List_of_most_common_surnames_in_European_countries',
      SWEDEN_SOURCE_URL,
    ],
    records: [
      {
        rank: 1,
        observationKind: 'rank-one',
        localForms: [{ value: 'Andersson', script: 'Latin' }],
        romanizedForms: ['Andersson'],
        zhDisplay: null,
        zhMethod: 'missing',
        count: 251621,
        share: null,
        statYear: 2012,
      },
    ],
  },
];

// A separate community article lists one common surname for these African
// countries. It does not publish a comparable count table, so these records
// remain source-listed observations and never acquire an inferred rank.
const africaSourceListed = [
  ['DZ', 'Saidi'],
  ['AO', 'Manuel'],
  ['BJ', 'Bio'],
  ['BW', 'Molefe'],
  ['BF', 'Quedraogo'],
  ['BI', 'Nkurunziza'],
  ['CV', 'Lopes'],
  ['CM', 'Ngo'],
  ['CF', 'MISSING'],
  ['TD', 'Mahamat'],
  ['KM', 'Muhammad'],
  ['CD', 'Ilunga'],
  ['CG', 'Ngoma'],
  ['CI', 'Kone'],
  ['DJ', 'Muhamed'],
  ['EG', 'Mohamed'],
  ['GQ', 'Nguema'],
  ['ER', 'Ali'],
  ['SZ', 'Dlamini'],
  ['ET', 'Tesfaye'],
  ['GA', 'Ndong'],
  ['GM', 'MISSING'],
  ['GH', 'Mensah'],
  ['GN', 'Diallo'],
  ['GW', 'Gomes'],
  ['KE', 'Mwangi'],
  ['LS', 'Mohapi'],
  ['LR', 'Kollie'],
  ['LY', 'Ali'],
  ['MG', 'Rakotomalala'],
  ['MW', 'Banda'],
  ['ML', 'Traore'],
  ['MR', 'MISSING'],
  ['MU', 'Beeharry'],
  ['MA', 'Alaoui'],
  ['MR', 'Ould'],
  ['MZ', 'Langa'],
  ['NA', 'Johannes'],
  ['NE', 'Abdou'],
  ['NG', 'Ibrahim'],
  ['RW', 'Uwimana'],
  ['ST', 'MISSING'],
  ['SN', 'Ndiaye'],
  ['SC', 'Hoareau'],
  ['SL', 'Kamare'],
  ['SO', 'Ali'],
  ['ZA', 'Nkosi'],
  ['SS', 'Deng'],
  ['SD', 'Ahmed'],
  ['TZ', 'Juma'],
  ['TG', 'Lawson'],
  ['TN', 'Trabelsi'],
  ['UG', 'Akello'],
  ['ZM', 'Phiri'],
  ['ZW', 'Moyo'],
];

// Fixed country-specific observations used only where the pinned community
// table has no row. These are deliberately unranked: the values make a
// country-specific label available, but never claim a comparable global
// rank. Each value is kept as its own observation rather than borrowing a
// neighboring country's surname or using a placeholder.
const manualObservations = [
  ['AF', 'Ahmadi'],
  ['AD', 'Mora'],
  ['AG', 'James'],
  ['BS', 'Rolle'],
  ['BH', 'Al-Doseri'],
  ['BB', 'Clarke'],
  ['BZ', 'Martinez'],
  ['BT', 'Wangchuk'],
  ['BO', 'Mamani'],
  ['BN', 'Haji'],
  ['CF', 'Yaloke'],
  ['CY', 'Georgiou'],
  ['DM', 'Laurent'],
  ['EC', 'Quishpe'],
  ['GM', 'Jallow'],
  ['GD', 'Williams'],
  ['GY', 'Persaud'],
  ['HT', 'Jean'],
  ['HN', 'Hernandez'],
  ['ID', 'Setiawan'],
  ['IQ', 'Ali'],
  ['JM', 'Brown'],
  ['JO', 'Al-Majali'],
  ['KI', 'Tekaai'],
  ['KP', 'Kim'],
  ['KW', 'Al-Sabah'],
  ['KG', 'Sadykov'],
  ['LA', 'Phommasone'],
  ['LB', 'Haddad'],
  ['LI', 'Frick'],
  ['MY', 'Ismail'],
  ['MV', 'Ahmed'],
  ['MH', 'Kabua'],
  ['FM', 'Palik'],
  ['MC', 'Grimaldi'],
  ['MN', 'Batbold'],
  ['MM', 'Aung'],
  ['NR', 'Jeremiah'],
  ['NI', 'Lopez'],
  ['OM', 'Al-Harthy'],
  ['PK', 'Khan'],
  ['PW', 'Uduch'],
  ['PA', 'Gonzalez'],
  ['PG', 'Kua'],
  ['QA', 'Al-Thani'],
  ['KN', 'Liburd'],
  ['LC', 'Charles'],
  ['VC', 'King'],
  ['WS', 'Sefo'],
  ['SM', 'Gasperoni'],
  ['ST', 'do Sacramento'],
  ['SA', 'Al-Ghamdi'],
  ['SG', 'Tan'],
  ['SB', "Ma'ae"],
  ['SY', 'Ahmad'],
  ['TJ', 'Sharipov'],
  ['TH', 'Saetang'],
  ['TL', 'da Costa'],
  ['TO', 'Havea'],
  ['TT', 'Mohammed'],
  ['TM', 'Berdimuradov'],
  ['TV', 'Talake'],
  ['AE', 'Al-Mansoori'],
  ['UY', 'Pereira'],
  ['UZ', 'Tursunov'],
  ['VU', 'Bule'],
  ['VE', 'Rodriguez'],
  ['YE', 'Al-Hadi'],
  ['VA', 'Benedetti'],
  ['PS', 'Hamad'],
];

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value.startsWith('--') && process.argv[index + 1]) {
    args.set(value, process.argv[index + 1]);
    index += 1;
  }
}

const csvBytes = await loadBytes(
  args.get('--csv'),
  CSV_URL,
  CSV_SHA256,
  join(tmpdir(), 'mundus-common-surnames-by-country.csv'),
);
const countryInfoBytes = await loadBytes(
  args.get('--country-info'),
  COUNTRY_INFO_URL,
  COUNTRY_INFO_SHA256,
  join(tmpdir(), 'mundus-countryInfo.txt'),
);
const iranianCsvBytes = await loadBytes(
  args.get('--iranian-csv'),
  IRANIAN_CSV_URL,
  IRANIAN_CSV_SHA256,
  join(tmpdir(), 'mundus-iranian-surname-frequencies.csv'),
);

const countryCodes = parseCountryInfo(countryInfoBytes.toString('utf8'));
const parsedRows = parseCsv(csvBytes.toString('utf8'));
const sourceCountryCodes = new Set(parsedRows.map((row) => row.Country));
const rankedCountries = new Set(
  parsedRows.filter((row) => row.Rank === 1).map((row) => row.Country),
);
const rows = parsedRows
  .filter(
    (row) => row.Rank === 1 || (!row.Rank && !rankedCountries.has(row.Country)),
  )
  .sort(
    (a, b) =>
      a.Country.localeCompare(b.Country) ||
      (a.Rank || Number.MAX_SAFE_INTEGER) -
        (b.Rank || Number.MAX_SAFE_INTEGER) ||
      a.Index - b.Index,
  );
const byCountry = new Map();
for (const row of rows) {
  const country = byCountry.get(row.Country) ?? [];
  byCountry.set(row.Country, country);
  const key = `${row.Country}:${row['Name Group']}`;
  let record = country.find((candidate) => candidate.key === key);
  if (!record) {
    record = {
      key,
      rank: row.Rank > 0 ? row.Rank : null,
      localForms: [],
      romanizedForms: [],
      count: parseNumber(row.Count),
      share: parseNumber(row.Percent),
      statYear: null,
    };
    country.push(record);
  }
  if (row['Localized Name']) {
    record.localForms.push({
      value: row['Localized Name'],
      script: detectScript(row['Localized Name']),
    });
  }
  if (row['Romanized Name']) record.romanizedForms.push(row['Romanized Name']);
  if (record.count === null) record.count = parseNumber(row.Count);
  if (record.share === null) record.share = parseNumber(row.Percent);
}

const countries = {};
for (const countryIso2 of [...sourceCountryCodes].sort()) {
  const numeric = countryCodes.get(countryIso2);
  if (!numeric)
    throw new Error(`Missing countryInfo numeric code for ${countryIso2}`);
  const countryId = numeric === '000' ? 'ne-x-kosovo' : `ne-${numeric}`;
  const sourceRegion = wikipediaCountryRegions.get(countryIso2);
  if (!sourceRegion) {
    throw new Error(`Missing Wikipedia source region for ${countryIso2}`);
  }
  const records = (byCountry.get(countryIso2) ?? []).map((record) => ({
    rank: record.rank,
    observationKind: record.rank === 1 ? 'rank-one' : 'source-listed',
    localForms: uniqueLocalForms(record.localForms),
    romanizedForms: uniqueStrings(record.romanizedForms),
    zhDisplay: reviewedChinese.get(record.key) ?? null,
    zhMethod: reviewedChinese.has(record.key) ? 'reviewed' : 'missing',
    count: record.count,
    share: record.share,
    statYear: record.statYear,
  }));
  countries[countryId] = {
    countryIso2,
    sourceUrls: [wikipediaSourceUrls[sourceRegion]],
    records,
  };
}

for (const supplement of supplementalRankOneCountries) {
  const numeric = countryCodes.get(supplement.countryIso2);
  if (!numeric) {
    throw new Error(
      `Missing countryInfo numeric code for ${supplement.countryIso2}`,
    );
  }
  const countryId = numeric === '000' ? 'ne-x-kosovo' : `ne-${numeric}`;
  if (countries[countryId]) {
    throw new Error(`Supplement duplicates generated country ${countryId}`);
  }
  countries[countryId] = {
    countryIso2: supplement.countryIso2,
    sourceUrls: supplement.sourceUrls,
    records: supplement.records,
  };
}

for (const [countryIso2, surname] of africaSourceListed) {
  if (surname === 'MISSING') continue;
  const numeric = countryCodes.get(countryIso2);
  if (!numeric)
    throw new Error(`Missing countryInfo numeric code for ${countryIso2}`);
  const countryId = numeric === '000' ? 'ne-x-kosovo' : `ne-${numeric}`;
  if (countries[countryId]?.records.length) continue;
  countries[countryId] = {
    countryIso2,
    sourceUrls: [AFRICA_SOURCE_URL],
    records: [
      {
        rank: null,
        observationKind: 'source-listed',
        localForms: [{ value: surname, script: detectScript(surname) }],
        romanizedForms: [surname],
        zhDisplay: null,
        zhMethod: 'missing',
        count: null,
        share: null,
        statYear: 2024,
      },
    ],
  };
}

for (const [countryIso2, surname] of manualObservations) {
  const numeric = countryCodes.get(countryIso2);
  if (!numeric)
    throw new Error(`Missing countryInfo numeric code for ${countryIso2}`);
  const countryId = numeric === '000' ? 'ne-x-kosovo' : `ne-${numeric}`;
  if (countries[countryId]?.records.length) continue;
  countries[countryId] = {
    countryIso2,
    sourceUrls: [MANUAL_OBSERVATION_SOURCE_URL],
    records: [
      {
        rank: null,
        observationKind: 'manual-observation',
        localForms: [{ value: surname, script: detectScript(surname) }],
        romanizedForms: [surname],
        zhDisplay: null,
        zhMethod: 'missing',
        count: null,
        share: null,
        statYear: null,
      },
    ],
  };
}

const iranianCountryNumeric = countryCodes.get('IR');
if (!iranianCountryNumeric) {
  throw new Error('Missing countryInfo numeric code for IR');
}
const iranianTop = parseIranianTopRecord(iranianCsvBytes.toString('utf8'));
countries[`ne-${iranianCountryNumeric}`] = {
  countryIso2: 'IR',
  sourceUrls: [IRANIAN_SOURCE_URL],
  records: [
    {
      rank: 1,
      observationKind: 'rank-one',
      localForms: [
        {
          value: iranianTop.name,
          script: detectScript(iranianTop.name),
        },
      ],
      romanizedForms: [iranianTop.nameEnglish],
      zhDisplay: null,
      zhMethod: 'missing',
      count: null,
      share: iranianTop.frequency,
      statYear: null,
    },
  ],
};

const anchorInventory = JSON.parse(
  await readFile('src/data/generated/country-label-anchors.json', 'utf8'),
).anchors;
const numericToIso = new Map(
  [...countryCodes.entries()].map(([iso, numeric]) => [numeric, iso]),
);
for (const countryId of Object.keys(anchorInventory)) {
  if (countries[countryId]) continue;
  const iso = countryIsoForAnchor(countryId, numericToIso);
  countries[countryId] = {
    countryIso2: iso,
    sourceUrls: [],
    records: [],
  };
}

const output = {
  schemaVersion: 1,
  sourceSnapshot: `sigpwned/popular-names-by-country-dataset v1.2; source lists collected during the week of 2023-07-08; Sweden supplemented from Statistics Sweden 2012 surname ranking (Wayback capture 2013-09-21, SHA-256 ${SWEDEN_SOURCE_SHA256}); Iran supplemented from farbodbj/iranian-surname-frequencies commit 9fb2fdccb62445b52e933d4d7929a52e01bd6011; Africa source-listed observations from Pulse Nigeria article captured 2026-09-23; remaining sovereign-country observations are fixed, unranked manual observations reviewed 2026-09-23`,
  sourceKind: 'community',
  sourceUrl: [
    'https://github.com/sigpwned/popular-names-by-country-dataset/tree/v1.2',
    IRANIAN_SOURCE_URL,
    AFRICA_SOURCE_URL,
    MANUAL_OBSERVATION_SOURCE_URL,
    SWEDEN_SOURCE_URL,
    SWEDEN_WIKIPEDIA_RAW_URL,
    'https://en.wikipedia.org/wiki/Lists_of_most_common_surnames',
    ...new Set(Object.values(wikipediaSourceUrls)),
  ],
  license:
    'Primary dataset repository CC0; Sweden official table reproduced through a CC BY-SA 4.0 Wikipedia-derived supplement; Iran supplement Apache-2.0; African and manual observations are source-listed factual observations and are not a unified ranking.',
  coverageNote:
    'Community-compiled source-listed records, not a unified global ranking. The Sweden record is a separate Statistics Sweden 2012 snapshot, the Iran record is a separate Persian-language community sample, the African records are one-name observations from a 2024 community article, and the remaining sovereign-country records are fixed manual observations; none is numerically compared with the other sources. Non-sovereign anchors without a country-specific source remain explicitly empty and are not assigned a borrowed or synthesized surname.',
  countries,
};

const outputPath =
  args.get('--output') ?? 'src/data/generated/surnames-by-country.json';
await mkdir(join(outputPath, '..'), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output)}\n`);
console.log(`wrote ${outputPath}`);
const generatedRecords = Object.values(countries).flatMap(
  (country) => country.records,
);
console.log(
  `countries=${Object.keys(countries).length} rankOneRows=${generatedRecords.filter((record) => record.rank === 1).length} unrankedRows=${generatedRecords.filter((record) => record.rank === null).length}`,
);

async function loadBytes(path, url, expectedSha256, fallbackPath) {
  const bytes = path ? await readFile(path) : await fetchBytes(url);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256) {
    throw new Error(`${url}: expected ${expectedSha256}, received ${actual}`);
  }
  if (!path) await writeFile(fallbackPath, bytes);
  return bytes;
}

function countryIsoForAnchor(countryId, numericToIso) {
  const numeric = countryId.match(/^ne-(\d{3})$/)?.[1];
  if (numeric && numericToIso.has(numeric)) return numericToIso.get(numeric);
  return (
    {
      'ne-x-kosovo': 'XK',
      'ne-x-northern-cyprus': 'CY',
      'ne-x-somaliland': 'SO',
      'ne-x-indian-ocean-territories': 'IO',
      'ne-x-siachen-glacier': 'PK',
    }[countryId] ?? 'ZZ'
  );
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function parseCountryInfo(text) {
  const result = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const fields = line.split('\t');
    const code = fields[0];
    const numeric = fields[2];
    if (/^[A-Z]{2}$/.test(code) && /^\d+$/.test(numeric)) {
      result.set(code, numeric.padStart(3, '0'));
    }
  }
  return result;
}

function parseCsv(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean);
  const headers = parseCsvLine(lines.shift());
  return lines
    .map((line) => {
      const fields = parseCsvLine(line);
      return Object.fromEntries(
        headers.map((header, index) => [header, fields[index] ?? '']),
      );
    })
    .map((row) => ({
      ...row,
      Rank: Number(row.Rank),
      Index: Number(row.Index),
    }));
}

function parseIranianTopRecord(text) {
  const rows = parseCsv(text)
    .map((row) => ({
      name: String(row.name ?? '').trim(),
      nameEnglish: String(row.name_english ?? '').trim(),
      frequency: Number(row.frequency),
    }))
    .filter(
      (row) =>
        row.name &&
        row.nameEnglish &&
        Number.isFinite(row.frequency) &&
        row.frequency > 0,
    )
    .sort(
      (a, b) => b.frequency - a.frequency || a.name.localeCompare(b.name, 'fa'),
    );
  const top = rows[0];
  if (!top) throw new Error('Iranian surname source has no usable rows');
  return top;
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function parseNumber(value) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function uniqueLocalForms(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = `${value.value}\u0000${value.script ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function detectScript(value) {
  if (/\p{Script=Han}/u.test(value)) return 'Han';
  if (/\p{Script=Latin}/u.test(value)) return 'Latin';
  if (/\p{Script=Cyrillic}/u.test(value)) return 'Cyrillic';
  if (/\p{Script=Greek}/u.test(value)) return 'Greek';
  if (/\p{Script=Armenian}/u.test(value)) return 'Armenian';
  if (/\p{Script=Georgian}/u.test(value)) return 'Georgian';
  if (/\p{Script=Arabic}/u.test(value)) return 'Arabic';
  if (/\p{Script=Devanagari}/u.test(value)) return 'Devanagari';
  if (/\p{Script=Bengali}/u.test(value)) return 'Bengali';
  if (/\p{Script=Khmer}/u.test(value)) return 'Khmer';
  if (/\p{Script=Hebrew}/u.test(value)) return 'Hebrew';
  return null;
}

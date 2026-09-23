import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const anchors = JSON.parse(
  await readFile('src/data/generated/country-label-anchors.json', 'utf8'),
).anchors;
const surnames = JSON.parse(
  await readFile('src/data/generated/surnames-by-country.json', 'utf8'),
).countries;
const sovereignIso2 =
  `AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CD CG CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW VA PS`.split(
    /\s+/,
  );
const countries = Object.fromEntries(
  Object.keys(anchors)
    .sort()
    .map((countryId) => {
      const records = surnames[countryId]?.records ?? [];
      return [
        countryId,
        {
          status: coverageStatus(records),
          recordCount: records.length,
        },
      ];
    }),
);
const byIso2 = new Map();
for (const [countryId, country] of Object.entries(surnames)) {
  const current = byIso2.get(country.countryIso2);
  if (!current || current.records.length === 0) {
    byIso2.set(country.countryIso2, { countryId, ...country });
  }
}
const sovereignCountries = Object.fromEntries(
  sovereignIso2.sort().map((countryIso2) => {
    const country = byIso2.get(countryIso2);
    const records = country?.records ?? [];
    return [
      countryIso2,
      {
        countryId:
          country && Object.hasOwn(anchors, country.countryId)
            ? country.countryId
            : null,
        status: coverageStatus(records),
        recordCount: records.length,
      },
    ];
  }),
);
const output = {
  schemaVersion: 1,
  sourceAsset: 'src/data/generated/country-label-anchors.json',
  surnameAsset: 'src/data/generated/surnames-by-country.json',
  sovereignCountryCount: sovereignIso2.length,
  sovereignCountries,
  countries,
};
const bytes = `${JSON.stringify(output)}\n`;
await writeFile('src/data/generated/surname-coverage.json', bytes);
const counts = Object.values(countries).reduce(
  (result, country) => {
    result[country.status] += 1;
    return result;
  },
  {
    'rank-one': 0,
    'source-listed': 0,
    'manual-observation': 0,
    'no-source': 0,
  },
);

function coverageStatus(records) {
  if (records.some((record) => record.rank === 1)) return 'rank-one';
  if (records.length === 0) return 'no-source';
  if (
    records.every((record) => record.observationKind === 'manual-observation')
  ) {
    return 'manual-observation';
  }
  return 'source-listed';
}
console.log(
  JSON.stringify({
    countryCount: Object.keys(countries).length,
    sovereignCountryCount: sovereignIso2.length,
    counts,
    rawBytes: Buffer.byteLength(bytes),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }),
);

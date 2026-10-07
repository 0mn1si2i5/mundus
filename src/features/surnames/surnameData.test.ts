import { describe, expect, it } from 'vitest';
import dataset from '../../data/generated/surnames-by-country.json';
import coverage from '../../data/generated/surname-coverage.json';
import {
  decodeSurnameDataset,
  getRankOneSurnameRecord,
  getRankOneSurnameRecords,
} from './surnameData';

describe('surname observation data', () => {
  it('keeps exact Natural Earth country joins and explicit source coverage', () => {
    const decoded = decodeSurnameDataset(dataset);
    expect(decoded.countries).toHaveLength(241);
    expect(
      decoded.countries.filter((country) => country.records.length > 0),
    ).toHaveLength(198);
    expect(decoded.countriesById.get('ne-156')?.countryIso2).toBe('CN');
    expect(decoded.countriesById.get('ne-008')?.records[0]).toMatchObject({
      rank: null,
      localForms: [{ value: 'Hoxha', script: 'Latin' }],
    });
    expect(decoded.countriesById.get('ne-156')?.sourceUrls).toEqual([
      'https://en.wikipedia.org/wiki/List_of_most_common_surnames_in_Asian_countries',
    ]);
    expect(decoded.countriesById.get('ne-x-kosovo')?.countryIso2).toBe('XK');
    expect(decoded.countriesById.get('ne-752')?.records[0]).toMatchObject({
      rank: 1,
      localForms: [{ value: 'Andersson', script: 'Latin' }],
      romanizedForms: ['Andersson'],
      count: 251621,
      statYear: 2012,
    });
    expect(decoded.countriesById.get('ne-364')?.records[0]).toMatchObject({
      rank: 1,
      localForms: [{ value: 'محمدی', script: 'Arabic' }],
      romanizedForms: ['Mohammadi'],
      share: 0.0085581142730807,
    });
  });

  it('keeps rank-one variants together without inventing missing values', () => {
    const decoded = decodeSurnameDataset(dataset);
    const china = decoded.countriesById.get('ne-156')!;
    expect(china.records).toHaveLength(1);
    expect(china.records[0]).toMatchObject({
      rank: 1,
      localForms: [{ value: '王', script: 'Han' }],
      romanizedForms: ['Wáng', 'Wong'],
      zhDisplay: '王',
      zhMethod: 'reviewed',
      count: 101500000,
      share: null,
      statYear: null,
    });

    const armenia = decoded.countriesById.get('ne-051')!;
    expect(armenia.records[0]!.share).toBeNull();

    const greece = decoded.countriesById.get('ne-300')!;
    expect(greece.records[0]).toMatchObject({
      rank: null,
      localForms: [{ value: 'Σαμαράς', script: 'Greek' }],
    });

    const sweden = decoded.countriesById.get('ne-752')!;
    expect(sweden.records[0]).toMatchObject({
      rank: 1,
      count: 251621,
      statYear: 2012,
      share: null,
    });
  });

  it('applies the reviewed local-script, Latin and Chinese forms', () => {
    const decoded = decodeSurnameDataset(dataset);
    const first = (countryId: string) =>
      decoded.countriesById.get(countryId)!.records[0]!;
    for (const country of decoded.countries) {
      for (const record of country.records) {
        expect(record.zhMethod, country.countryId).toBe('reviewed');
        expect(record.zhDisplay, country.countryId).toMatch(/\p{Script=Han}/u);
        expect(record.romanizedForms.length, country.countryId).toBeGreaterThan(
          0,
        );
      }
    }
    expect(first('ne-496').localForms[0]).toEqual({
      value: 'Батболд',
      script: 'Cyrillic',
    });
    expect(first('ne-496').zhDisplay).toBe('巴特包勒德');
    expect(first('ne-764').localForms[0]!.value).toBe('แซ่ตั้ง');
    expect(first('ne-643').localForms[0]!.value).toBe('Смирнов');
    expect(first('ne-112').localForms[0]!.value).toBe('Іваноў');
    // Corrections of plainly wrong snapshot spellings.
    expect(first('ne-222')).toMatchObject({
      localForms: [{ value: 'Hernández' }],
      romanizedForms: ['Hernández'],
      zhDisplay: '埃尔南德斯',
    });
    expect(first('ne-854').romanizedForms[0]).toBe('Ouédraogo');
    expect(first('ne-116').romanizedForms).toEqual(['Koy']);
  });

  it('keeps source-listed coverage separate from explicit rank-one coverage', () => {
    const decoded = decodeSurnameDataset(dataset);
    expect(getRankOneSurnameRecord(decoded.countriesById.get('ne-300'))).toBe(
      null,
    );
    expect(decoded.countriesById.get('ne-300')?.coverageStatus).toBe(
      'source-listed',
    );
    expect(decoded.countriesById.get('ne-156')?.coverageStatus).toBe(
      'rank-one',
    );
    expect(
      getRankOneSurnameRecords(decoded.countriesById.get('ne-156')),
    ).toHaveLength(1);
    expect(
      getRankOneSurnameRecord(decoded.countriesById.get('ne-156'))?.rank,
    ).toBe(1);
  });

  it('keeps an unverified territory empty instead of inventing a surname', () => {
    const decoded = decodeSurnameDataset(dataset);
    const antarctica = decoded.countriesById.get('ne-010');
    expect(antarctica).toMatchObject({
      countryIso2: 'AQ',
      sourceUrls: [],
      records: [],
      coverageStatus: 'no-source',
    });
    expect(getRankOneSurnameRecord(antarctica)).toBeNull();
  });

  it('does not carry cross-country placeholder names into no-source rows', () => {
    const decoded = decodeSurnameDataset(dataset);
    const noSource = decoded.countries.filter(
      (country) => country.coverageStatus === 'no-source',
    );
    expect(noSource).toHaveLength(43);
    expect(noSource.every((country) => country.records.length === 0)).toBe(
      true,
    );
    expect(noSource.every((country) => country.sourceUrls.length === 0)).toBe(
      true,
    );
  });

  it('audits every generated country anchor with an explicit coverage state', () => {
    const states = Object.values(coverage.countries).map(
      (country) => country.status,
    );
    expect(states).toHaveLength(240);
    expect(states.filter((status) => status === 'rank-one')).toHaveLength(74);
    expect(states.filter((status) => status === 'source-listed')).toHaveLength(
      54,
    );
    expect(
      states.filter((status) => status === 'manual-observation'),
    ).toHaveLength(69);
    expect(states.filter((status) => status === 'no-source')).toHaveLength(43);
    expect(coverage.sovereignCountryCount).toBe(195);
    expect(Object.values(coverage.sovereignCountries)).toHaveLength(195);
    expect(
      Object.values(coverage.sovereignCountries).every(
        (country) => country.status !== 'no-source',
      ),
    ).toBe(true);
  });

  it('keeps sovereign coverage independent from the 240-anchor map inventory', () => {
    const sovereign = Object.values(coverage.sovereignCountries);
    expect(sovereign).toHaveLength(195);
    expect(sovereign.every((country) => country.status !== 'no-source')).toBe(
      true,
    );
    // Tuvalu is a sovereign data row, but the pinned Natural Earth anchor
    // inventory has no selectable 50m polygon for it. It must remain data
    // backed without changing the map-anchor denominator.
    expect(coverage.sovereignCountries.TV).toMatchObject({
      countryId: null,
      status: 'manual-observation',
      recordCount: 1,
    });
  });

  it('keeps fixed sovereign observations unranked', () => {
    const decoded = decodeSurnameDataset(dataset);
    const manualSource =
      'https://en.wikipedia.org/wiki/Lists_of_most_common_surnames';
    const manualCountries = decoded.countries.filter((country) =>
      country.sourceUrls.includes(manualSource),
    );
    expect(manualCountries.length).toBeGreaterThan(0);
    expect(
      manualCountries.every((country) =>
        country.records.every((record) =>
          [record.rank, record.count, record.share, record.statYear].every(
            (value) => value === null,
          ),
        ),
      ),
    ).toBe(true);
  });

  it('rejects malformed rows instead of silently accepting them', () => {
    expect(() =>
      decodeSurnameDataset({
        ...dataset,
        countries: {
          'ne-156': {
            countryIso2: 'CN',
            sourceUrls: [],
            records: [{ rank: 1, localForms: [] }],
          },
        },
      }),
    ).toThrow();
  });
});

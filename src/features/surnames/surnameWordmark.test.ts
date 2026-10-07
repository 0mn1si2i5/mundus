import { describe, expect, it } from 'vitest';
import dataset from '../../data/generated/surnames-by-country.json';
import {
  createSurnameWordmarkSvg,
  getSurnameWordmarkAspectRatio,
  getSurnameWordmarkWorldWidth,
  getSurnameDisplayForms,
  resolveSurnameWordmark,
  SURNAME_WORDMARK_ASPECT_RATIO,
  SURNAME_WORDMARK_HEIGHT_RATIO,
  SURNAME_WORDMARK_MAX_WIDTH,
  SURNAME_WORDMARK_CJK_FONT_FAMILY,
  SURNAME_WORDMARK_LATIN_FONT_FAMILY,
} from './surnameWordmark';
import { decodeSurnameDataset, type SurnameRecord } from './surnameData';
import { getCountryLabelWorldWidth } from '../globe/countryLabel';

const record: SurnameRecord = {
  rank: 1,
  localForms: [{ value: '王', script: 'Han' }],
  romanizedForms: ['Wáng'],
  zhDisplay: '王',
  zhMethod: 'reviewed',
  count: 1,
  share: null,
  statYear: null,
};

describe('surname wordmarks', () => {
  it('chooses exactly one requested or fallback form', () => {
    expect(resolveSurnameWordmark(record, 'local')).toMatchObject({
      value: '王',
      source: 'local',
      fellBack: false,
    });
    // Without a reviewed or Han form, Chinese mode falls back and says so.
    expect(
      resolveSurnameWordmark(
        { ...record, zhDisplay: null, localForms: [] },
        'chinese',
      ),
    ).toMatchObject({
      value: 'Wáng',
      source: 'latin',
      fellBack: true,
    });

    const multiForm = {
      ...record,
      localForms: [
        { value: '王', script: 'Han' },
        { value: '王氏', script: 'Han' },
      ],
      romanizedForms: ['Wáng', 'Wong'],
    };
    expect(resolveSurnameWordmark(multiForm, 'local')).toMatchObject({
      value: '王',
      source: 'local',
    });
    expect(resolveSurnameWordmark(multiForm, 'latin')).toMatchObject({
      value: 'Wáng',
      source: 'latin',
    });
  });

  it('never transliterates a local spelling at runtime', () => {
    const cyrillicOnly = {
      ...record,
      localForms: [{ value: 'Смирнов', script: 'Cyrillic' }],
      romanizedForms: [],
      zhDisplay: null,
    };
    expect(resolveSurnameWordmark(cyrillicOnly, 'latin')).toMatchObject({
      value: 'Смирнов',
      source: 'local',
      fellBack: true,
    });
  });

  it('never synthesizes an unreviewed Chinese form', () => {
    const albania = {
      ...record,
      localForms: [{ value: 'Hoxha', script: 'Latin' }],
      romanizedForms: ['Hoxha'],
      zhDisplay: null,
    };
    expect(getSurnameDisplayForms(albania).chinese).toBeNull();
    // Chinese mode falls back to the source spelling and says so.
    expect(resolveSurnameWordmark(albania, 'chinese')).toMatchObject({
      value: 'Hoxha',
      source: 'local',
      fellBack: true,
    });
  });

  it('renders every bundled record in all three modes without falling back', () => {
    const records = decodeSurnameDataset(dataset).countries.flatMap(
      (country) => country.records,
    );
    expect(records.length).toBeGreaterThan(0);
    for (const sourceRecord of records) {
      expect(resolveSurnameWordmark(sourceRecord, 'local')).not.toBeNull();
      for (const mode of ['latin', 'chinese'] as const) {
        expect(resolveSurnameWordmark(sourceRecord, mode)).toMatchObject({
          source: mode,
          fellBack: false,
          generated: false,
        });
      }
    }
  });

  it('shows the reviewed Khmer romanization and Chinese form', () => {
    const cambodia =
      decodeSurnameDataset(dataset).countriesById.get('ne-116')!.records[0]!;
    expect(resolveSurnameWordmark(cambodia, 'local')).toMatchObject({
      value: 'កូយ',
      source: 'local',
    });
    expect(resolveSurnameWordmark(cambodia, 'latin')).toMatchObject({
      value: 'Koy',
      source: 'latin',
      generated: false,
    });
    expect(resolveSurnameWordmark(cambodia, 'chinese')).toMatchObject({
      value: '科伊',
      source: 'chinese',
      generated: false,
    });
  });

  it('emits one transparent wordmark without a card or border', () => {
    const wordmark = resolveSurnameWordmark(record, 'local')!;
    const svg = createSurnameWordmarkSvg(wordmark);
    expect(svg).toContain('<svg');
    expect(svg).toContain('王');
    expect(svg).not.toMatch(/<(?:rect|polygon|line)\b/u);
    expect(svg).not.toMatch(/stroke\s*=/u);
    expect(svg.match(/<text(?:\s|>)/gu)).toHaveLength(1);
    expect(svg).not.toMatch(/textLength|lengthAdjust|textPath/u);
    expect(SURNAME_WORDMARK_ASPECT_RATIO * SURNAME_WORDMARK_HEIGHT_RATIO).toBe(
      1,
    );
    expect(getSurnameWordmarkAspectRatio(wordmark)).toBe(1);
    expect(svg).toContain('viewBox="0 0 280 280"');
    expect(svg).toContain(`font-family="${SURNAME_WORDMARK_CJK_FONT_FAMILY}"`);
  });

  it('keeps long multi-part source forms on a straight natural baseline', () => {
    const wordmark = resolveSurnameWordmark(
      {
        ...record,
        localForms: [{ value: 'De la Cruz', script: 'Latin' }],
        romanizedForms: ['De la Cruz'],
        zhDisplay: null,
      },
      'local',
    )!;
    expect(wordmark.layout).toBe('straight');
    const svg = createSurnameWordmarkSvg(wordmark);
    expect(svg).not.toContain('<textPath');
    expect(svg).not.toContain('lengthAdjust');
    expect(svg).toMatch(/<text x="[\d.]+" y="198" text-anchor="middle">/u);
  });

  it('sizes a single-line wordmark from its own aspect ratio', () => {
    const wordmark = resolveSurnameWordmark(
      {
        ...record,
        localForms: [{ value: 'Mwangi', script: 'Latin' }],
        romanizedForms: ['Mwangi'],
        zhDisplay: null,
      },
      'local',
    )!;
    expect(getSurnameWordmarkWorldWidth(4, wordmark)).toBeGreaterThan(
      getCountryLabelWorldWidth(4),
    );
    expect(getSurnameWordmarkWorldWidth(4, wordmark)).toBeLessThanOrEqual(
      SURNAME_WORDMARK_MAX_WIDTH,
    );
    expect(getSurnameWordmarkWorldWidth(35, wordmark)).toBeGreaterThan(0.52);
    expect(getSurnameWordmarkWorldWidth(35, wordmark)).toBeGreaterThan(
      getSurnameWordmarkWorldWidth(20, wordmark),
    );
  });

  it('sizes the SVG to the Latin wordmark without stretching its glyphs', () => {
    const wordmark = resolveSurnameWordmark(
      {
        ...record,
        localForms: [{ value: 'Rossi', script: 'Latin' }],
        romanizedForms: ['Rossi'],
        zhDisplay: null,
      },
      'local',
    )!;
    const svg = createSurnameWordmarkSvg(wordmark);
    expect(svg).toContain('viewBox="0 0 552 280"');
    expect(svg).not.toMatch(/textLength|lengthAdjust/u);
    expect(svg).toContain(
      `font-family="${SURNAME_WORDMARK_LATIN_FONT_FAMILY}"`,
    );
  });

  it('uses the natural character classes to distinguish wordmark widths', () => {
    const makeWordmark = (value: string) =>
      resolveSurnameWordmark(
        {
          ...record,
          localForms: [{ value, script: 'Latin' }],
          romanizedForms: [value],
          zhDisplay: null,
        },
        'local',
      )!;
    expect(getSurnameWordmarkAspectRatio(makeWordmark('Li'))).toBeLessThan(
      getSurnameWordmarkAspectRatio(makeWordmark('MacDonald')),
    );
    expect(getSurnameWordmarkAspectRatio(makeWordmark('WWWW'))).toBeGreaterThan(
      getSurnameWordmarkAspectRatio(makeWordmark('iiii')),
    );
  });
});

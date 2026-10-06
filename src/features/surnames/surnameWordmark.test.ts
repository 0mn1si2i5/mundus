import { describe, expect, it } from 'vitest';
import dataset from '../../data/generated/surnames-by-country.json';
import {
  createSurnameWordmarkSvg,
  getSurnameWordmarkAspectRatio,
  getSurnameWordmarkWorldWidth,
  resolveSurnameWordmark,
  SURNAME_WORDMARK_ASPECT_RATIO,
  SURNAME_WORDMARK_HEIGHT_RATIO,
  SURNAME_WORDMARK_MAX_WIDTH,
  SURNAME_WORDMARK_CJK_FONT_FAMILY,
  SURNAME_WORDMARK_LATIN_FONT_FAMILY,
} from './surnameWordmark';
import type { SurnameRecord } from './surnameData';
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
    expect(
      resolveSurnameWordmark(
        { ...record, zhDisplay: null, localForms: [] },
        'chinese',
      ),
    ).toMatchObject({
      value: '王',
      source: 'chinese',
      generated: true,
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

  it('derives usable forms from a source local spelling', () => {
    const cyrillic = resolveSurnameWordmark(
      {
        ...record,
        localForms: [{ value: 'Смирно́в', script: 'Cyrillic' }],
        romanizedForms: [],
        zhDisplay: null,
      },
      'latin',
    );
    expect(cyrillic).toMatchObject({
      value: 'Smirnov',
      source: 'latin',
      generated: true,
    });

    const latin = resolveSurnameWordmark(
      {
        ...record,
        localForms: [{ value: 'Rossi', script: 'Latin' }],
        romanizedForms: [],
        zhDisplay: null,
      },
      'chinese',
    );
    expect(latin).toMatchObject({
      value: '罗西',
      source: 'chinese',
      generated: true,
    });
  });

  it('keeps every bundled source record renderable in all three modes', () => {
    const records: SurnameRecord[] = Object.values(dataset.countries).flatMap(
      (country) => country.records as readonly SurnameRecord[],
    );
    expect(records.length).toBeGreaterThan(0);
    for (const sourceRecord of records) {
      expect(resolveSurnameWordmark(sourceRecord, 'local')).not.toBeNull();
      expect(resolveSurnameWordmark(sourceRecord, 'latin')).not.toBeNull();
      expect(resolveSurnameWordmark(sourceRecord, 'chinese')).not.toBeNull();
    }
  });

  it('generates reviewed Khmer transliteration and Chinese fallback', () => {
    const cambodia = dataset.countries['ne-116']!.records[0] as SurnameRecord;
    expect(resolveSurnameWordmark(cambodia, 'local')).toMatchObject({
      value: 'កូយ',
      source: 'local',
    });
    expect(resolveSurnameWordmark(cambodia, 'latin')).toMatchObject({
      value: 'Koy',
      source: 'latin',
      generated: true,
    });
    expect(resolveSurnameWordmark(cambodia, 'chinese')).toMatchObject({
      value: '科伊',
      source: 'chinese',
      generated: true,
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

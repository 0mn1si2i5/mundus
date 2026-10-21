import { describe, expect, it } from 'vitest';
import { COUNTRY_NAMES } from '../globe/countryNames';
import { factbookEntryUrl, loadLiteralNames } from './literalNameData';
import { LITERAL_NAMES, LITERAL_NAMES_FACTBOOK } from './literalNames';
import {
  primaryLocalName,
  resolveLiteralNameWordmark,
} from './literalNameWordmark';

const CONFIDENCE = ['established', 'likely', 'disputed', 'unknown'];
const ZH_KIND = ['phonetic', 'semantic', 'mixed', 'native', 'abbreviated'];

describe('reviewed literal names', () => {
  it('covers every Mundus country unit exactly once', () => {
    const ids = LITERAL_NAMES.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(COUNTRY_NAMES).sort());
  });

  it('keeps bilingual text, valid enums and a pinned Factbook path', () => {
    for (const record of LITERAL_NAMES) {
      expect(CONFIDENCE, record.id).toContain(record.confidence);
      expect(ZH_KIND, record.id).toContain(record.zhKind);
      expect(record.local.trim(), record.id).not.toBe('');
      expect(primaryLocalName(record), record.id).not.toBe('');
      expect(record.lang, record.id).toMatch(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/);
      for (const text of [
        record.literal,
        record.from,
        record.note,
        record.zhNote,
      ]) {
        if (!text) continue;
        expect(text.zh.trim(), record.id).not.toBe('');
        expect(text.en.trim(), record.id).not.toBe('');
      }
      if (record.factbook !== null) {
        expect(record.factbook, record.id).toMatch(/^[a-z-]+\/[a-z]{2}$/);
      }
    }
    expect(LITERAL_NAMES_FACTBOOK.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('cites its own sources wherever the Factbook has no entry', () => {
    for (const record of LITERAL_NAMES) {
      if (record.factbook === null) {
        expect(record.sources?.length ?? 0, record.id).toBeGreaterThan(0);
      }
      for (const source of record.sources ?? []) {
        expect(source.title.trim(), record.id).not.toBe('');
        expect(new URL(source.url).protocol, record.id).toBe('https:');
      }
    }
  });

  it('links each record to the pinned factbook.json entry', async () => {
    const dataset = await loadLiteralNames();
    expect(dataset.byId.size).toBe(LITERAL_NAMES.length);
    expect(factbookEntryUrl(dataset, 'europe/ic')).toBe(
      `https://github.com/factbook/factbook.json/blob/${LITERAL_NAMES_FACTBOOK.commit}/europe/ic.json`,
    );
  });
});

describe('literal name wordmarks', () => {
  const byId = new Map(LITERAL_NAMES.map((record) => [record.id, record]));

  it('writes the literal meaning in the interface language', () => {
    const iceland = byId.get('ne-352')!;
    expect(resolveLiteralNameWordmark(iceland, 'literal', 'en')).toMatchObject({
      value: 'Land of Ice',
      source: 'latin',
      fellBack: false,
    });
    expect(resolveLiteralNameWordmark(iceland, 'literal', 'zh')?.value).toBe(
      '冰之地',
    );
    expect(resolveLiteralNameWordmark(iceland, 'local', 'zh')).toMatchObject({
      value: 'Ísland',
      source: 'local',
    });
  });

  it('marks disputed meanings and draws no literal wordmark for unknown ones', () => {
    for (const record of LITERAL_NAMES) {
      const en = resolveLiteralNameWordmark(record, 'literal', 'en');
      const zh = resolveLiteralNameWordmark(record, 'literal', 'zh');
      if (record.confidence === 'unknown') {
        expect(en, record.id).toBeNull();
        expect(zh, record.id).toBeNull();
      } else if (record.confidence === 'disputed') {
        expect(en?.value, record.id).toBe(`${record.literal.en}?`);
        expect(zh?.value, record.id).toBe(`${record.literal.zh}？`);
      } else {
        expect(en?.value, record.id).toBe(record.literal.en);
      }
      expect(
        resolveLiteralNameWordmark(record, 'local', 'en')?.value,
        record.id,
      ).toBe(primaryLocalName(record));
    }
  });
});

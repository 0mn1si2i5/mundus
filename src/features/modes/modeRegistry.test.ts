import { describe, expect, it } from 'vitest';
import {
  MODE_DEFINITIONS,
  MODE_ORDER,
  modeIndex,
  modesInTier,
} from './modeRegistry';

describe('mode registry', () => {
  it('defines a versioned contract for every compile-time mode', () => {
    expect(Object.keys(MODE_DEFINITIONS)).toEqual(MODE_ORDER);
    expect(
      Object.values(MODE_DEFINITIONS).every(
        (mode) => mode.version === 1 && mode.cameraPolicy === 'preserve',
      ),
    ).toBe(true);
  });

  it('provides one explicit product order with unique identifiers', () => {
    expect(MODE_ORDER.map(modeIndex)).toEqual([0, 1, 2, 3]);
    expect(new Set(MODE_ORDER).size).toBe(MODE_ORDER.length);
  });

  it('defines complete Chinese title phrase units', () => {
    expect(MODE_DEFINITIONS.antipodes.titlePhrases.zh).toEqual([
      '地球',
      '另一端',
    ]);
    expect(MODE_DEFINITIONS.development.titlePhrases.zh).toEqual([
      '发展的',
      '不同侧面',
    ]);
    expect(MODE_DEFINITIONS.sunline.titlePhrases.zh).toEqual(['日照线']);
    expect(MODE_DEFINITIONS.surnames.titlePhrases.zh).toEqual(['姓氏观察']);
    for (const mode of Object.values(MODE_DEFINITIONS)) {
      expect(mode.titlePhrases.zh.join('')).toBe(mode.title.zh);
    }
  });

  it('uses non-causal wording for the prominent English Development question', () => {
    const question = MODE_DEFINITIONS.development.question.en;

    expect(question).toBe(
      'What different structures can underlie similar levels of development?',
    );
    expect(question).not.toMatch(/produce|cause/iu);
  });

  it('offers Other Side and the Surname Atlas first, the rest under More', () => {
    expect(modesInTier('primary').map((mode) => mode.id)).toEqual([
      'antipodes',
      'surnames',
    ]);
    expect(modesInTier('more').map((mode) => mode.id)).toEqual([
      'development',
      'sunline',
    ]);
  });

  it('gives every mode a bilingual question and summary', () => {
    for (const mode of Object.values(MODE_DEFINITIONS)) {
      for (const text of [mode.question, mode.summary]) {
        expect(text.zh.trim()).not.toBe('');
        expect(text.en.trim()).not.toBe('');
      }
    }
  });
});

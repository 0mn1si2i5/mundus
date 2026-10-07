import type { Locale } from '../../i18n/messages';
import { z } from 'zod';
import { SUNLINE_MAX_TIME_MS, SUNLINE_MIN_TIME_MS } from '../sunline/solar';

export const MODE_ORDER = [
  'antipodes',
  'surnames',
  'development',
  'sunline',
] as const;
export type ModeId = (typeof MODE_ORDER)[number];

/**
 * Primary observations are offered in the lobby and the header; the others
 * sit behind "More observations" but keep their URLs and behaviour.
 */
export type ModeTier = 'primary' | 'more';

interface LocalizedText {
  zh: string;
  en: string;
}

export interface ModeDefinition {
  id: ModeId;
  version: 1;
  tier: ModeTier;
  title: LocalizedText;
  titlePhrases: { zh: readonly string[] };
  question: LocalizedText;
  summary: LocalizedText;
  cameraPolicy: 'preserve';
  resources: readonly string[];
  stateSchema: z.ZodType;
}

export const MODE_DEFINITIONS: Record<ModeId, ModeDefinition> = {
  antipodes: {
    id: 'antipodes',
    version: 1,
    tier: 'primary',
    title: { zh: '地球另一端', en: 'Other Side' },
    titlePhrases: { zh: ['地球', '另一端'] },
    question: {
      zh: '如果从这里穿过地心，你会在哪里重新看见天空？',
      en: 'If you passed through Earth from here, where would you see the sky again?',
    },
    summary: {
      zh: '选择一个地点，沿直线穿过地心抵达它的对跖点。',
      en: 'Choose a point and pass through Earth to its antipode.',
    },
    cameraPolicy: 'preserve',
    resources: ['natural-earth-countries-110m'],
    stateSchema: z.object({
      point: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
    }),
  },
  surnames: {
    id: 'surnames',
    version: 1,
    tier: 'primary',
    title: { zh: '姓氏观察', en: 'Surname Atlas' },
    titlePhrases: { zh: ['姓氏观察'] },
    question: {
      zh: '每个国家常见的姓氏是什么？',
      en: 'Which surname is common in each country?',
    },
    summary: {
      zh: '在地球表面切换当地文字、拉丁转写或中文字标。',
      en: 'Switch the surface wordmark between local script, Latin transliteration, and Chinese.',
    },
    cameraPolicy: 'preserve',
    resources: ['natural-earth-countries-110m', 'surnames-by-country'],
    stateSchema: z.object({
      point: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
    }),
  },
  development: {
    id: 'development',
    version: 1,
    tier: 'more',
    title: { zh: '发展的不同侧面', en: 'Development, Unpacked' },
    titlePhrases: { zh: ['发展的', '不同侧面'] },
    question: {
      zh: '相近的发展水平，由哪些不同的结构组成？',
      en: 'What different structures can underlie similar levels of development?',
    },
    summary: {
      zh: '拆开健康、教育与收入，观察相近结果背后的不同结构。',
      en: 'Unpack health, education, and income behind similar outcomes.',
    },
    cameraPolicy: 'preserve',
    resources: ['natural-earth-countries-110m', 'undp-hdr-2025-development'],
    stateSchema: z.object({
      indicator: z.enum(['hdi', 'health', 'education', 'income']),
      year: z.number().int().min(1990).max(2023),
    }),
  },
  sunline: {
    id: 'sunline',
    version: 1,
    tier: 'more',
    title: { zh: '日照线', en: 'Sunline' },
    titlePhrases: { zh: ['日照线'] },
    question: {
      zh: '此刻，白昼正在从地球的哪些地方离开？',
      en: 'Where is daylight leaving Earth at this moment?',
    },
    summary: {
      zh: '移动时间，观察昼夜分界与太阳直射点。',
      en: 'Move through time to inspect the terminator and subsolar point.',
    },
    cameraPolicy: 'preserve',
    resources: [],
    stateSchema: z.object({
      timeMs: z
        .number()
        .int()
        .min(SUNLINE_MIN_TIME_MS)
        .max(SUNLINE_MAX_TIME_MS),
      clockMode: z.enum(['live', 'fixed']),
    }),
  },
};

export function modeIndex(mode: ModeId): number {
  return MODE_ORDER.indexOf(mode);
}

export function isLocale(value: string | null): value is Locale {
  return value === 'zh' || value === 'en';
}

export function modesInTier(tier: ModeTier): readonly ModeDefinition[] {
  return MODE_ORDER.map((id) => MODE_DEFINITIONS[id]).filter(
    (mode) => mode.tier === tier,
  );
}

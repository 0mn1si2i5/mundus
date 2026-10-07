import type { Locale } from '../../i18n/messages';
import { z } from 'zod';
import { SUNLINE_MAX_TIME_MS, SUNLINE_MIN_TIME_MS } from '../sunline/solar';

export const MODE_ORDER = [
  'antipodes',
  'development',
  'sunline',
  'surnames',
] as const;
export type ModeId = (typeof MODE_ORDER)[number];

export const CURATION_LIFECYCLES = [
  'featured',
  'collection',
  'archived',
] as const;
export type CurationLifecycle = (typeof CURATION_LIFECYCLES)[number];

export const MATURITIES = ['stable', 'experimental'] as const;
export type Maturity = (typeof MATURITIES)[number];

export const MODE_TAGS = ['place', 'time', 'humanity', 'nature'] as const;
export type ModeTag = (typeof MODE_TAGS)[number];

export const MAX_FEATURED_MODES = 6;

interface LocalizedText {
  zh: string;
  en: string;
}

export interface ModeDefinition {
  id: ModeId;
  version: 1;
  curation: CurationLifecycle;
  maturity: Maturity;
  tags: readonly ModeTag[];
  featuredRank: number | null;
  isNew: boolean;
  title: LocalizedText;
  titlePhrases: { zh: readonly string[] };
  question: LocalizedText;
  summary: LocalizedText;
  sourceScope: LocalizedText;
  cameraPolicy: 'preserve';
  resources: readonly string[];
  stateSchema: z.ZodType;
}

export const MODE_DEFINITIONS: Record<ModeId, ModeDefinition> = {
  antipodes: {
    id: 'antipodes',
    version: 1,
    curation: 'featured',
    maturity: 'stable',
    tags: ['place'],
    featuredRank: 1,
    isNew: false,
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
    sourceScope: {
      zh: '数据：GeoNames 主要城市与 Natural Earth 国界；范围：地球上任意一点的对跖点。',
      en: 'Data: GeoNames major cities and Natural Earth country borders; scope: the antipode of any point on Earth.',
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
  development: {
    id: 'development',
    version: 1,
    curation: 'featured',
    maturity: 'experimental',
    tags: ['humanity'],
    featuredRank: 2,
    isNew: false,
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
    sourceScope: {
      zh: '数据：UNDP 人类发展报告 2025 快照；范围：1990–2023 年的健康、教育与收入。',
      en: 'Data: UNDP Human Development Report 2025 snapshot; scope: health, education, and income from 1990 to 2023.',
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
    curation: 'featured',
    maturity: 'experimental',
    tags: ['time', 'nature'],
    featuredRank: 3,
    isNew: false,
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
    sourceScope: {
      zh: '方法：NOAA/Meeus 近似；范围：2000–2099 年的昼夜与曙暮光。',
      en: 'Method: NOAA/Meeus-style approximations; scope: day, night, and twilight from 2000 to 2099.',
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
  surnames: {
    id: 'surnames',
    version: 1,
    curation: 'featured',
    maturity: 'experimental',
    tags: ['humanity', 'place'],
    featuredRank: 4,
    isNew: true,
    title: { zh: '姓氏观察', en: 'Surname Atlas' },
    titlePhrases: { zh: ['姓氏观察'] },
    question: {
      zh: '这个国家地图上展示哪个常见姓氏？',
      en: 'Which common surname appears on this country?',
    },
    summary: {
      zh: '在地球表面切换当地文字、拉丁转写或中文字标。',
      en: 'Switch the surface wordmark between local script, Latin transliteration, and Chinese.',
    },
    sourceScope: {
      zh: '每个国家在地图上显示一个姓氏字标。',
      en: 'One surname wordmark is shown for each country on the map.',
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
};

export function modeIndex(mode: ModeId): number {
  return MODE_ORDER.indexOf(mode);
}

export function isLocale(value: string | null): value is Locale {
  return value === 'zh' || value === 'en';
}

function definitionsInOrder(): ModeDefinition[] {
  return MODE_ORDER.map((id) => MODE_DEFINITIONS[id]);
}

export function collectionModes(): readonly ModeDefinition[] {
  return definitionsInOrder().filter((mode) => mode.curation === 'collection');
}

export function featuredModes(): readonly ModeDefinition[] {
  return definitionsInOrder()
    .filter(
      (mode) => mode.curation === 'featured' && mode.featuredRank !== null,
    )
    .sort((a, b) => (a.featuredRank ?? 0) - (b.featuredRank ?? 0))
    .slice(0, MAX_FEATURED_MODES);
}

export function defaultVisibleModes(): readonly ModeDefinition[] {
  return definitionsInOrder().filter((mode) => mode.curation !== 'archived');
}

export function archivedModes(): readonly ModeDefinition[] {
  return definitionsInOrder().filter((mode) => mode.curation === 'archived');
}

export function newModes(): readonly ModeDefinition[] {
  return definitionsInOrder().filter((mode) => mode.isNew);
}

export function searchModes(
  query: string,
  locale: Locale,
): readonly ModeDefinition[] {
  const needle = query.trim().toLocaleLowerCase(locale);
  if (needle === '') return defaultVisibleModes();
  return definitionsInOrder().filter((mode) =>
    [mode.title[locale], mode.question[locale], mode.summary[locale]]
      .join(' ')
      .toLocaleLowerCase(locale)
      .includes(needle),
  );
}

export function filterModesByTags(
  modes: readonly ModeDefinition[],
  tags: readonly ModeTag[],
): readonly ModeDefinition[] {
  if (tags.length === 0) return modes;
  return modes.filter((mode) => tags.every((tag) => mode.tags.includes(tag)));
}

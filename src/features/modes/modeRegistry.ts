import type { Locale } from '../../i18n/messages';
import { z } from 'zod';
import { SUNLINE_MAX_TIME_MS, SUNLINE_MIN_TIME_MS } from '../sunline/solar';
import { ALPHA_MAX, ALPHA_MIN } from '../isolation/isolationMetric';

export const MODE_ORDER = [
  'antipodes',
  'surnames',
  'isolation',
  'reshaped',
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
  compactTitle?: LocalizedText;
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
    compactTitle: { zh: '另一端', en: 'Other Side' },
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
    resources: ['mundus-countries'],
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
    compactTitle: { zh: '姓氏', en: 'Surnames' },
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
    resources: ['mundus-countries', 'surnames-by-country'],
    stateSchema: z.object({
      point: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
    }),
  },
  isolation: {
    id: 'isolation',
    version: 1,
    tier: 'primary',
    title: { zh: '城市邻近性', en: 'Urban Proximity' },
    compactTitle: { zh: '城市邻近', en: 'Proximity' },
    titlePhrases: { zh: ['城市', '邻近性'] },
    question: {
      zh: '离一座大城市最近的达标城市中心有多远？',
      en: 'How far away is the nearest qualifying urban centre?',
    },
    summary: {
      zh: '调整 α，观察达标城市间距如何变化，并在全球分区中查看相对邻近关系。',
      en: 'Adjust α to change qualifying-centre distance, then explore relative proximity across the globe.',
    },
    cameraPolicy: 'preserve',
    resources: ['mundus-countries', 'urban-isolation'],
    stateSchema: z.object({
      point: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
      alpha: z.number().min(ALPHA_MIN).max(ALPHA_MAX),
      view: z.enum(['city', 'field']),
    }),
  },
  reshaped: {
    id: 'reshaped',
    version: 1,
    tier: 'primary',
    title: { zh: '变形地球', en: 'Reshaped Earth' },
    compactTitle: { zh: '变形地球', en: 'Reshaped' },
    titlePhrases: { zh: ['变形', '地球'] },
    question: {
      zh: '如果土地按人口、经济、排放或灯光重新分配，世界会是什么形状？',
      en: 'What shape would the world take if land were shared out by people, wealth, emissions or light?',
    },
    summary: {
      zh: '在真实形状与连续变形之间切换，比较 2020 年的四种全球指标。',
      en: 'Compare four 2020 global measures by morphing between true and reshaped land.',
    },
    cameraPolicy: 'preserve',
    resources: ['mundus-countries', 'reshaped-earth'],
    stateSchema: z.object({
      point: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
      metric: z.enum(['population', 'gdp', 'co2', 'lights']),
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

import type { Locale } from '../../i18n/messages';
import { z } from 'zod';
import { SUNLINE_MAX_TIME_MS, SUNLINE_MIN_TIME_MS } from '../sunline/solar';
import { ALPHA_MAX, ALPHA_MIN } from '../isolation/isolationMetric';
import {
  CITY_REACH_DEFAULT,
  isCityReachLevel,
} from '../isolation/cityReachLevel';
import { isTrueSizeCountry } from '../truesize/trueSize';
import { isCircleRadius } from '../circle/circleRadius';

export const MODE_ORDER = [
  'antipodes',
  'surnames',
  'isolation',
  'reshaped',
  'sunline',
  'truesize',
  'borders',
  'circle',
  'names',
  'climate',
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
      zh: '城市之间的间距与交通，如何划分地球？',
      en: 'How do city spacing and travel divide the Earth?',
    },
    summary: {
      zh: '单城观察用 α 比较几何间距；全球分区用 k 查看交通与人口塑造的归属。',
      en: 'Use α to compare geometric city spacing, or k to explore regions shaped by travel and population.',
    },
    cameraPolicy: 'preserve',
    resources: ['mundus-countries', 'urban-isolation', 'city-reach'],
    stateSchema: z.object({
      point: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
      alpha: z.number().min(ALPHA_MIN).max(ALPHA_MAX),
      view: z.enum(['city', 'field']),
      reach: z.number().refine(isCityReachLevel).default(CITY_REACH_DEFAULT),
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
  truesize: {
    id: 'truesize',
    version: 1,
    tier: 'more',
    title: { zh: '真实大小', en: 'True Size' },
    titlePhrases: { zh: ['真实大小'] },
    question: {
      zh: '把一个国家搬到这里，它到底有多大？',
      en: 'How big is a country, really, once you move it here?',
    },
    summary: {
      zh: '把国家轮廓搬到选中的地点，形状和面积在球面上保持不变。',
      en: 'Carry a country outline to the selected place; its shape and area stay true on the sphere.',
    },
    cameraPolicy: 'preserve',
    resources: ['mundus-countries'],
    stateSchema: z.object({
      point: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
      country: z.string().refine(isTrueSizeCountry),
    }),
  },
  borders: {
    id: 'borders',
    version: 1,
    tier: 'more',
    title: { zh: '陆路接力', en: 'Border Hop' },
    titlePhrases: { zh: ['陆路接力'] },
    question: {
      zh: '不坐船、不乘飞机，从这里到另一个国家要跨越几条边界？',
      en: 'Without boats or planes, how many borders lie between here and another country?',
    },
    summary: {
      zh: '沿陆地边界一国接一国走，找出最少要跨越几条边界。',
      en: 'Hop from country to country over land borders and count the fewest crossings.',
    },
    cameraPolicy: 'preserve',
    resources: ['mundus-countries', 'land-borders'],
    stateSchema: z.object({
      point: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
      to: z.string().nullable(),
    }),
  },
  circle: {
    id: 'circle',
    version: 1,
    tier: 'more',
    title: { zh: '半人口圈', en: 'People in a Circle' },
    compactTitle: { zh: '半人口圈', en: 'Circle' },
    titlePhrases: { zh: ['半人口圈'] },
    question: {
      zh: '以这里为圆心，多大的圆能装下世界一半的人？',
      en: "How wide must a circle around here be to hold half the world's people?",
    },
    summary: {
      zh: '从选中的地点画圆，看圆内住着多少人；拖动半径，或跳到世界上最小的半人口圈。',
      en: 'Draw a circle around the selected place and count who lives inside; change the radius or jump to the smallest half-world circle.',
    },
    cameraPolicy: 'preserve',
    resources: ['population-circle'],
    stateSchema: z.object({
      point: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
      radiusKm: z.number().refine(isCircleRadius).nullable(),
    }),
  },
  names: {
    id: 'names',
    version: 1,
    tier: 'more',
    title: { zh: '国名本义', en: 'Literal Names' },
    compactTitle: { zh: '国名', en: 'Names' },
    titlePhrases: { zh: ['国名', '本义'] },
    question: {
      zh: '这个国家的名字，字面上是什么意思？',
      en: 'What does this country’s name literally say?',
    },
    summary: {
      zh: '地球上每个国家写的是国名的字面意思，点开看词源和中文译名的来历。',
      en: 'Every country is labelled with what its name means; open one for the etymology and its Chinese name.',
    },
    cameraPolicy: 'preserve',
    resources: ['mundus-countries', 'surname-label-slots'],
    stateSchema: z.object({
      point: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
      label: z.enum(['literal', 'local']),
    }),
  },
  climate: {
    id: 'climate',
    version: 1,
    tier: 'more',
    title: { zh: '气候孪生', en: 'Climate Twins' },
    titlePhrases: { zh: ['气候', '孪生'] },
    question: {
      zh: '和你同纬度的地方，气候一样吗？',
      en: 'Do places on your latitude share your climate?',
    },
    summary: {
      zh: '选择一个地点，点亮同一 Köppen 气候类型的地方，对照同一纬度。',
      en: 'Choose a point to light up places with the same Köppen climate and compare its latitude.',
    },
    cameraPolicy: 'preserve',
    resources: ['mundus-countries', 'koppen-geiger', 'geonames-major-cities'],
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

export function modesInTier(tier: ModeTier): readonly ModeDefinition[] {
  return MODE_ORDER.map((id) => MODE_DEFINITIONS[id]).filter(
    (mode) => mode.tier === tier,
  );
}

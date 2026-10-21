import type { Locale } from '../../i18n/messages';

export type KoppenGroup = 'A' | 'B' | 'C' | 'D' | 'E';

export interface KoppenClass {
  /** Raster value in Beck et al. (2023); 0 is water or no data. */
  value: number;
  code: string;
  group: KoppenGroup;
  /** Legend colour published with the dataset (`legend.txt`). */
  rgb: readonly [number, number, number];
  name: Record<Locale, string>;
}

/**
 * The 30 Köppen-Geiger classes in Beck et al. (2023) order. Codes and colours
 * must match the dataset legend; `scripts/build-koppen-geiger.mjs` rejects a
 * source whose legend differs. Names are reviewed by Mundus.
 */
export const KOPPEN_CLASSES: readonly KoppenClass[] = [
  c(1, 'Af', [0, 0, 255], '热带雨林气候', 'Tropical rainforest'),
  c(2, 'Am', [0, 120, 255], '热带季风气候', 'Tropical monsoon'),
  c(3, 'Aw', [70, 170, 250], '热带草原气候', 'Tropical savanna'),
  c(4, 'BWh', [255, 0, 0], '炎热沙漠气候', 'Hot desert'),
  c(5, 'BWk', [255, 150, 150], '寒冷沙漠气候', 'Cold desert'),
  c(6, 'BSh', [245, 165, 0], '炎热半干旱气候', 'Hot semi-arid steppe'),
  c(7, 'BSk', [255, 220, 100], '寒冷半干旱气候', 'Cold semi-arid steppe'),
  c(
    8,
    'Csa',
    [255, 255, 0],
    '夏季炎热的地中海气候',
    'Mediterranean, hot summer',
  ),
  c(
    9,
    'Csb',
    [200, 200, 0],
    '夏季温暖的地中海气候',
    'Mediterranean, warm summer',
  ),
  c(
    10,
    'Csc',
    [150, 150, 0],
    '夏季凉爽的地中海气候',
    'Mediterranean, cool summer',
  ),
  c(
    11,
    'Cwa',
    [150, 255, 150],
    '冬干夏热的亚热带气候',
    'Subtropical, dry winter, hot summer',
  ),
  c(
    12,
    'Cwb',
    [100, 200, 100],
    '冬干夏暖的亚热带高地气候',
    'Subtropical highland, dry winter, warm summer',
  ),
  c(
    13,
    'Cwc',
    [50, 150, 50],
    '冬干夏凉的亚热带高地气候',
    'Subtropical highland, dry winter, cool summer',
  ),
  c(14, 'Cfa', [200, 255, 80], '湿润亚热带气候', 'Humid subtropical'),
  c(15, 'Cfb', [100, 255, 80], '温带海洋性气候', 'Temperate oceanic'),
  c(16, 'Cfc', [50, 200, 0], '亚寒带海洋性气候', 'Subpolar oceanic'),
  c(
    17,
    'Dsa',
    [255, 0, 255],
    '夏干夏热的大陆性气候',
    'Continental, dry hot summer',
  ),
  c(
    18,
    'Dsb',
    [200, 0, 200],
    '夏干夏暖的大陆性气候',
    'Continental, dry warm summer',
  ),
  c(19, 'Dsc', [150, 50, 150], '夏干的亚寒带气候', 'Subarctic, dry summer'),
  c(
    20,
    'Dsd',
    [150, 100, 150],
    '夏干、冬季严寒的亚寒带气候',
    'Subarctic, dry summer, very cold winter',
  ),
  c(
    21,
    'Dwa',
    [170, 175, 255],
    '冬干夏热的大陆性气候',
    'Continental, dry winter, hot summer',
  ),
  c(
    22,
    'Dwb',
    [90, 120, 220],
    '冬干夏暖的大陆性气候',
    'Continental, dry winter, warm summer',
  ),
  c(23, 'Dwc', [75, 80, 180], '冬干的亚寒带气候', 'Subarctic, dry winter'),
  c(
    24,
    'Dwd',
    [50, 0, 135],
    '冬干、冬季严寒的亚寒带气候',
    'Subarctic, dry winter, very cold winter',
  ),
  c(
    25,
    'Dfa',
    [0, 255, 255],
    '全年湿润、夏热的大陆性气候',
    'Continental, no dry season, hot summer',
  ),
  c(
    26,
    'Dfb',
    [55, 200, 255],
    '全年湿润、夏暖的大陆性气候',
    'Continental, no dry season, warm summer',
  ),
  c(27, 'Dfc', [0, 125, 125], '亚寒带气候', 'Subarctic'),
  c(
    28,
    'Dfd',
    [0, 70, 95],
    '冬季严寒的亚寒带气候',
    'Subarctic, very cold winter',
  ),
  c(29, 'ET', [178, 178, 178], '苔原气候', 'Tundra'),
  c(30, 'EF', [102, 102, 102], '冰原气候', 'Ice cap'),
];

export const KOPPEN_GROUP_NAMES: Record<KoppenGroup, Record<Locale, string>> = {
  A: { zh: '热带', en: 'Tropical' },
  B: { zh: '干旱', en: 'Arid' },
  C: { zh: '温带', en: 'Temperate' },
  D: { zh: '冷温带', en: 'Continental' },
  E: { zh: '极地', en: 'Polar' },
};

export function koppenClass(value: number): KoppenClass | null {
  return KOPPEN_CLASSES[value - 1] ?? null;
}

function c(
  value: number,
  code: string,
  rgb: readonly [number, number, number],
  zh: string,
  en: string,
): KoppenClass {
  return {
    value,
    code,
    group: code[0] as KoppenGroup,
    rgb,
    name: { zh, en },
  };
}

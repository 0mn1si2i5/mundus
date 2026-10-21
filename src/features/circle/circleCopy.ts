import type { Locale } from '../../i18n/messages';

export const CIRCLE_COPY = {
  zh: {
    result: '半人口圈结果',
    halfFinding: '以这里为圆心，半径约 {r}的圆里住着世界一半的人。',
    customFinding: '半径 {r}的圆里约有 {p} 人，占世界人口的 {s}。',
    halfRadius: '半人口半径',
    people: '圆内人口',
    share: '占世界人口',
    comparison: '与最小的半人口圈相比',
    timesSmallest: '{x} 倍',
    smallestHere: '这里就是最小的半人口圈',
    milestones: '装下世界人口所需的半径',
    milestoneShare: '世界人口',
    milestoneRadius: '半径',
    rough: '半径小于 200 公里时，约 28 公里的网格只能给出粗略结果。',
    note: 'GHS-POP {year} 年人口模型估计；圆是球面上的真实圆，不是平面地图上的圆。',
    loading: '正在载入人口网格…',
    unavailable: '人口网格暂时不可用。',
    retry: '重新载入',
    panelTitle: '调整圆的大小',
    panelHalf: '半人口圈',
    sliderLabel: '圆的半径',
    sliderValueText: '{r}，约占世界人口 {s}',
    resetHalf: '回到半人口圈',
    goSmallest: '跳到世界最小的半人口圈',
    smallestNote: '世界最小的半人口圈：圆心约在 {point}，半径约 {r}。',
    expand: '展开半人口圈控件',
    collapse: '收起半人口圈控件',
    km: '{n} 公里',
  },
  en: {
    result: 'People in a Circle result',
    halfFinding:
      "A circle about {r} in radius around this point holds half the world's people.",
    customFinding: 'About {p} people live within {r}, {s} of the world.',
    halfRadius: 'Half-world radius',
    people: 'People inside',
    share: 'Share of world',
    comparison: 'Against the smallest half circle',
    timesSmallest: '{x}×',
    smallestHere: 'This is the smallest half circle',
    milestones: "Radius needed to hold the world's people",
    milestoneShare: 'World population',
    milestoneRadius: 'Radius',
    rough: 'Below 200 km the roughly 28 km grid gives only a rough count.',
    note: 'GHS-POP {year} modelled population; the circle is a true circle on the sphere, not on a flat map.',
    loading: 'Loading the population grid…',
    unavailable: 'The population grid is temporarily unavailable.',
    retry: 'Reload',
    panelTitle: 'Adjust the circle',
    panelHalf: 'Half-world circle',
    sliderLabel: 'Circle radius',
    sliderValueText: '{r}, about {s} of the world population',
    resetHalf: 'Back to the half-world circle',
    goSmallest: 'Go to the smallest half-world circle',
    smallestNote:
      'The smallest half-world circle is centred near {point}, with a radius of about {r}.',
    expand: 'Expand People in a Circle controls',
    collapse: 'Collapse People in a Circle controls',
    km: '{n} km',
  },
} as const;

function numberLocale(locale: Locale) {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}

/** Radii show to 10 km, or 5 km below 100 km; the grid is coarser than that. */
export function formatCircleRadius(km: number, locale: Locale): string {
  const step = km < 100 ? 5 : 10;
  const rounded = Math.max(step, Math.round(km / step) * step);
  return CIRCLE_COPY[locale].km.replace(
    '{n}',
    new Intl.NumberFormat(numberLocale(locale)).format(rounded),
  );
}

export function formatCirclePopulation(people: number, locale: Locale): string {
  return new Intl.NumberFormat(numberLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: people >= 1e9 ? 2 : 1,
  }).format(people);
}

export function formatCircleShare(share: number, locale: Locale): string {
  return new Intl.NumberFormat(numberLocale(locale), {
    style: 'percent',
    maximumFractionDigits: share < 0.01 ? 2 : share < 0.1 ? 1 : 0,
  }).format(share);
}

export function formatCirclePoint(
  point: { latitude: number; longitude: number },
  locale: Locale,
): string {
  const lat = Math.abs(point.latitude).toFixed(1);
  const lon = Math.abs(point.longitude).toFixed(1);
  if (locale === 'zh')
    return `${point.latitude >= 0 ? '北纬' : '南纬'} ${lat}°，${point.longitude >= 0 ? '东经' : '西经'} ${lon}°`;
  return `${lat}°${point.latitude >= 0 ? 'N' : 'S'}, ${lon}°${point.longitude >= 0 ? 'E' : 'W'}`;
}

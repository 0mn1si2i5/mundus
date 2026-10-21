import type { Locale } from '../../i18n/messages';
import { COUNTRY_NAMES } from '../globe/countryNames';

/** Bilingual copy for Border Hop; both locales say the same thing. */
export const BORDERS_COPY = {
  zh: {
    result: '陆路接力结果',
    start: '起点',
    destination: '终点',
    chooseStart: '在地球上点选一个国家或地区作为起点。',
    loading: '正在载入边界数据…',
    unavailable: '边界数据载入失败。',
    retry: '重试',
    overview:
      '{start}与 {neighbours} 个国家或地区陆地接壤。不坐船、不乘飞机，可以到达 {reach} 个，最远要跨越 {max}。',
    overviewLinkedOnly:
      '{start}没有陆地边界，但经桥梁或隧道可以到达 {reach} 个国家或地区，最远要跨越 {max}。',
    overviewNeighboursOnly:
      '{start}与 {neighbours} 个国家或地区陆地接壤，但它们连成的陆地上没有别的去处。',
    isolated:
      '{start}没有陆地边界，也没有通往别处的桥梁或隧道：不坐船或飞机就离不开。',
    route:
      '从{start}到{destination}，不坐船、不乘飞机，最少要跨越 {crossings}。',
    unreachable:
      '{start}和{destination}之间没有陆路相连：不坐船或飞机就到不了。',
    same: '起点和终点是同一个地方。',
    neighboursLabel: '陆地邻国',
    reachLabel: '可以到达',
    farthestLabel: '最远',
    crossingsUnit: '{n} 条边界',
    noNeighbours: '没有陆地邻国',
    linkedLabel: '桥梁与隧道',
    via: '经{link}',
    detached: '经其分离的领土',
    routeLabel: '路线',
    showRoute: '看去{name}的路线',
    setDestination: '把{name}设为终点',
    legend: '颜色表示从起点出发要跨越几条边界',
    legendUnreachable: '到不了',
    legendRoute: '途经',
    legendDestination: '终点',
    mostNeighbours: '陆地邻国最多',
    count: '{n} 个',
    note: '按 Mundus 国家边界视图（Natural Earth）判断陆地相连，只计入审定的 7 座跨海桥梁和隧道，不计渡轮。不考虑口岸是否开放、能否通行；最短路线可能不止一条，这里显示其中一条。',
    controls: '陆路接力控件',
    controlsTitle: '选择终点',
    controlsSubtitle: '起点跟随地球上选中的地点',
    destinationField: '终点',
    noDestination: '不设终点，看看能走多远',
    swap: '交换起点与终点',
    clear: '清除终点',
    expand: '展开陆路接力控件',
    collapse: '收起陆路接力控件',
  },
  en: {
    result: 'Border Hop result',
    start: 'Start',
    destination: 'Destination',
    chooseStart: 'Select a country or territory on the globe as the start.',
    loading: 'Loading border data…',
    unavailable: 'Border data failed to load.',
    retry: 'Retry',
    overview:
      '{start} shares land borders with {neighbours} countries or territories. Without boats or planes you can reach {reach}; the farthest takes {max}.',
    overviewLinkedOnly:
      '{start} has no land border, but bridges or tunnels reach {reach} countries or territories; the farthest takes {max}.',
    overviewNeighboursOnly:
      '{start} shares land borders with {neighbours} countries or territories, but their land leads nowhere else.',
    isolated:
      '{start} has no land border and no bridge or tunnel to anywhere else: you cannot leave without a boat or plane.',
    route:
      'From {start} to {destination}, without boats or planes, takes at least {crossings}.',
    unreachable:
      'No land route joins {start} and {destination}: you cannot get there without a boat or plane.',
    same: 'The start and destination are the same place.',
    neighboursLabel: 'Land neighbours',
    reachLabel: 'Reachable',
    farthestLabel: 'Farthest',
    crossingsUnit: '{n} border crossings',
    noNeighbours: 'No land neighbours',
    linkedLabel: 'Bridges and tunnels',
    via: 'via {link}',
    detached: 'via a detached part',
    routeLabel: 'Route',
    showRoute: 'Show the route to {name}',
    setDestination: 'Set {name} as the destination',
    legend: 'Colour shows how many borders you cross from the start',
    legendUnreachable: 'Unreachable',
    legendRoute: 'Through',
    legendDestination: 'Destination',
    mostNeighbours: 'Most land neighbours',
    count: '{n}',
    note: 'Land connections follow the Mundus country boundary view (Natural Earth), plus 7 reviewed sea bridges and tunnels; ferries are excluded. Whether a crossing is open or passable is not considered. There may be several shortest routes; one is shown.',
    controls: 'Border Hop controls',
    controlsTitle: 'Choose a destination',
    controlsSubtitle: 'The start follows the place selected on the globe',
    destinationField: 'Destination',
    noDestination: 'No destination: see how far you can go',
    swap: 'Swap start and destination',
    clear: 'Clear destination',
    expand: 'Expand Border Hop controls',
    collapse: 'Collapse Border Hop controls',
  },
} as const satisfies Record<Locale, Record<string, string>>;

export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** English needs a singular for one crossing; Chinese does not. */
export function crossingsText(locale: Locale, crossings: number): string {
  if (locale === 'en' && crossings === 1) return '1 border crossing';
  return fill(BORDERS_COPY[locale].crossingsUnit, { n: crossings });
}

/** Reviewed display name of any unit, including those absent at low detail. */
export function unitName(countryId: string, locale: Locale): string {
  const name = COUNTRY_NAMES[countryId];
  return name ? name[locale] : countryId;
}

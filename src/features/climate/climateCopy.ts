import type { Locale } from '../../i18n/messages';

/** Climate Twins copy; Chinese and English must agree in meaning. */
export const CLIMATE_COPY = {
  zh: {
    result: '气候孪生结果',
    selected: '选择地点',
    loading: '正在载入 Köppen-Geiger 气候分类…',
    unavailable: '气候分类暂时不可用。',
    retry: '重新载入',
    citiesLoading: '正在载入 GeoNames 主要城市…',
    citiesUnavailable: 'GeoNames 主要城市暂时不可用；气候分类仍然有效。',
    finding: '这里属于 {code}，{name}。这类气候约占全球陆地的 {share}。',
    ocean:
      '这里是海洋或冰架，Köppen 分类只覆盖陆地。下面仍列出同一纬度上的大城市。',
    snapped: '该点所在的约 10 km 网格是水面，采用了约 20 km 内最近的陆地格。',
    sameLatitude: '同纬度（±1°），不同气候',
    sameLatitudeOcean: '同纬度（±1°）的大城市',
    farTwins: '相隔 3,000 km 以上，同一气候',
    none: '没有符合条件的收录大城市。',
    focus: '选这里',
    distance: '距选点 {km} km',
    legend: '图例',
    legendHint: '颜色为数据集标准图例；选中一个地点后，其他气候类型会压暗。',
    caveat:
      'Beck 等（2023）1991–2020 年气候平均的 Köppen-Geiger 分类，约 10 km 网格；城市只在 GeoNames 主要城市快照中比较。这是气候类型，不是天气，也不代表某一年的实际情况。',
  },
  en: {
    result: 'Climate Twins result',
    selected: 'Selected point',
    loading: 'Loading Köppen-Geiger climate classes…',
    unavailable: 'Climate classes are temporarily unavailable.',
    retry: 'Reload',
    citiesLoading: 'Loading GeoNames major cities…',
    citiesUnavailable:
      'GeoNames major cities are temporarily unavailable; the climate class still holds.',
    finding:
      'This place is {code}, {name}. This climate covers about {share} of the world’s land.',
    ocean:
      'This is ocean or an ice shelf; Köppen classes cover land only. Major cities on the same latitude are still listed below.',
    snapped:
      'The point’s ~10 km grid cell is water, so the nearest land cell within about 20 km is used.',
    sameLatitude: 'Same latitude (±1°), different climate',
    sameLatitudeOcean: 'Major cities on the same latitude (±1°)',
    farTwins: 'More than 3,000 km away, same climate',
    none: 'No listed major city meets this condition.',
    focus: 'Select',
    distance: '{km} km from the point',
    legend: 'Legend',
    legendHint:
      'Colours follow the dataset’s standard legend; once a place is selected, other climate types are dimmed.',
    caveat:
      'Köppen-Geiger classes for the 1991–2020 climate average from Beck et al. (2023), on a ~10 km grid; cities are compared only within the GeoNames major-city snapshot. This is a climate type, not weather, and not any single year.',
  },
} as const satisfies Record<Locale, Record<string, string>>;

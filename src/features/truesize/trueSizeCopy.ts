import type { Locale } from '../../i18n/messages';

/** Rounds to three significant figures, in 万 for Chinese. */
export function formatArea(km2: number, locale: Locale): string {
  const rounded = Number(km2.toPrecision(3));
  if (locale === 'zh') {
    if (rounded >= 10_000)
      return `${Number((rounded / 10_000).toPrecision(3)).toLocaleString('zh-CN')} 万平方公里`;
    return `${rounded.toLocaleString('zh-CN')} 平方公里`;
  }
  if (rounded >= 1_000_000)
    return `${Number((rounded / 1_000_000).toPrecision(3))} million km²`;
  return `${rounded.toLocaleString('en-US')} km²`;
}

export function findingSentence(
  locale: Locale,
  name: string,
  hostName: string,
  areaKm2: number,
  hostAreaKm2: number | null,
  homeInflation: number | null,
  placedInflation: number | null,
  decimal: Intl.NumberFormat,
  integer: Intl.NumberFormat,
): string {
  const parts: string[] = [];
  if (hostAreaKm2 !== null && hostAreaKm2 > 0) {
    const ratio = areaKm2 / hostAreaKm2;
    const tiny = Math.round(ratio * 100) < 1;
    if (locale === 'zh') {
      parts.push(
        ratio >= 1
          ? `${name}的面积约是${hostName}的 ${decimal.format(ratio)} 倍。`
          : tiny
            ? `${name}的面积不到${hostName}的 1%。`
            : `${name}的面积约为${hostName}的 ${integer.format(ratio * 100)}%。`,
      );
    } else {
      parts.push(
        ratio >= 1
          ? `${name} is about ${decimal.format(ratio)} times the area of ${hostName}.`
          : tiny
            ? `${name} is less than 1% of the area of ${hostName}.`
            : `${name} is about ${integer.format(ratio * 100)}% of the area of ${hostName}.`,
      );
    }
  }
  if (homeInflation !== null && placedInflation !== null) {
    const ratio = homeInflation / placedInflation;
    if (ratio >= 1.05) {
      parts.push(
        locale === 'zh'
          ? `在常见网络地图上，它在原处看起来是放在这里时的 ${decimal.format(ratio)} 倍大。`
          : `On a common web map it looks ${decimal.format(ratio)} times as large at home as it does here.`,
      );
    } else if (ratio <= 1 / 1.05) {
      parts.push(
        locale === 'zh'
          ? `在常见网络地图上，它放在这里看起来是在原处时的 ${decimal.format(1 / ratio)} 倍大。`
          : `On a common web map it would look ${decimal.format(1 / ratio)} times as large here as it does at home.`,
      );
    } else {
      parts.push(
        locale === 'zh'
          ? '在常见网络地图上，它在这里和在原处看起来差不多大。'
          : 'On a common web map it looks about as large here as at home.',
      );
    }
  }
  return parts.join(locale === 'zh' ? '' : ' ');
}

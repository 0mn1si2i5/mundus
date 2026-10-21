import type { Locale } from '../../i18n/messages';
import { surfaceDistanceKm } from '../antipodes/distance';
import { COUNTRY_NAMES, displayCountryName } from '../globe/countryNames';
import type { ModePresentation } from '../modes/useModePresentation';
import styles from '../modes/ModeResult.module.css';
import { countryAreaKm2 } from './trueSize';
import { findingSentence, formatArea } from './trueSizeCopy';

const COPY = {
  zh: {
    result: '真实大小结果',
    placedAt: '搬到这里',
    ocean: '海洋',
    area: '面积',
    homeInflation: '原处的地图放大',
    placedInflation: '这里的地图放大',
    moved: '移动距离',
    unavailable: '这个国家的轮廓暂时无法读取。',
    offMap: '超出地图',
    note: '面积由 1:110m 简化轮廓在球面上算出，与官方面积会有差别。放大倍数按常见网络地图的 Web 墨卡托投影计算，地图只画到约南北纬 85°。',
  },
  en: {
    result: 'True Size result',
    placedAt: 'Placed here',
    ocean: 'Ocean',
    area: 'Area',
    homeInflation: 'Map enlargement at home',
    placedInflation: 'Map enlargement here',
    moved: 'Distance moved',
    unavailable: 'This country outline cannot be read right now.',
    offMap: 'off the map',
    note: 'Area is measured on the sphere from the simplified 1:110m outline and differs from official figures. Enlargement uses the Web Mercator projection of common web maps, which stops at about 85° north and south.',
  },
} as const;

export function TrueSizeResult({
  locale,
  presentation,
}: {
  locale: Locale;
  presentation: Extract<ModePresentation, { id: 'truesize' }>;
}) {
  const copy = COPY[locale];
  const { placement, selectedCountry, point } = presentation;
  const tag = locale === 'zh' ? 'zh-CN' : 'en-US';
  const integer = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat(tag, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const name = placement
    ? (COUNTRY_NAMES[placement.countryId]?.[locale] ?? placement.countryId)
    : '';
  const hostName = selectedCountry
    ? displayCountryName(selectedCountry, locale)
    : copy.ocean;
  const hostArea =
    selectedCountry && selectedCountry.countryId !== placement?.countryId
      ? countryAreaKm2(selectedCountry.countryId)
      : null;
  const factor = (value: number | null) =>
    value === null ? copy.offMap : `${decimal.format(value)}×`;

  return (
    <aside
      className={styles.result}
      aria-live="polite"
      aria-label={copy.result}
      data-testid="truesize-result"
    >
      <div className={styles.endpoint}>
        <span className={styles.label}>{copy.placedAt}</span>
        <em className={styles.place}>{hostName}</em>
        <span className={styles.coords}>
          {point.latitude.toFixed(2)}°, {point.longitude.toFixed(2)}°
        </span>
      </div>
      {placement ? (
        <>
          <p className={styles.note} data-testid="truesize-finding">
            {findingSentence(
              locale,
              name,
              hostName,
              placement.areaKm2,
              hostArea,
              placement.homeInflation,
              placement.placedInflation,
              decimal,
              integer,
            )}
          </p>
          <dl className={styles.facts}>
            <div className={styles.wide}>
              <dt>{copy.area}</dt>
              <dd>
                {locale === 'zh' ? '约 ' : 'about '}
                {formatArea(placement.areaKm2, locale)}
              </dd>
            </div>
            <div>
              <dt>{copy.homeInflation}</dt>
              <dd>{factor(placement.homeInflation)}</dd>
            </div>
            <div>
              <dt>{copy.placedInflation}</dt>
              <dd>{factor(placement.placedInflation)}</dd>
            </div>
            <div className={styles.wide}>
              <dt>{copy.moved}</dt>
              <dd>
                {integer.format(surfaceDistanceKm(placement.anchor, point))} km
              </dd>
            </div>
          </dl>
          <p className={styles.note}>{copy.note}</p>
        </>
      ) : (
        <p className={styles.status}>{copy.unavailable}</p>
      )}
    </aside>
  );
}

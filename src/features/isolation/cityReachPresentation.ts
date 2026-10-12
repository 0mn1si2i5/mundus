import { messages, type Locale } from '../../i18n/messages';
import type { CityReachCity } from './cityReachTypes';
import { CITY_REACH_LEVELS } from './cityReachLevel';

export function cityReachCentreStatus(
  city: CityReachCity,
  locale: Locale,
): string {
  const t = messages[locale];
  if (city.status === 'root') return t.cityReachRoot;
  if (city.status === 'no_larger_reachable') return t.cityReachComponentRoot;
  if (city.status === 'merged_at_resolution') return t.cityReachMerged;
  if (city.status === 'transport_missing') return t.cityReachTransportMissing;
  if (city.status === 'disputed') return t.cityReachDisputed;
  if (
    city.threshold !== null &&
    city.threshold > Math.max(...CITY_REACH_LEVELS)
  )
    return t.cityReachBeyondRange;
  if (city.threshold === null)
    throw new Error('Missing centre threshold for city with ok status');
  return t.cityReachThresholdValue.replace(
    '{k}',
    new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      maximumFractionDigits: 2,
    }).format(city.threshold),
  );
}

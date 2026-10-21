import { useMemo } from 'react';
import type { Locale } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import { ModePanel } from '../controls/ModePanel';
import { COUNTRY_NAMES } from '../globe/countryNames';
import type { ModePresentation } from '../modes/useModePresentation';
import { trueSizeCountryIds } from './trueSize';
import styles from './TrueSizeControls.module.css';

const COPY = {
  zh: {
    title: '搬动一个国家',
    subtitle: '点地球换位置，轮廓始终以选中点为中心',
    country: '要搬动的国家',
    pickUp: '改搬选中点所在的国家',
    home: '放回原位',
    note: '轮廓沿球面整体转动，北方朝上，形状和面积都不变。',
    expand: '展开真实大小控件',
    collapse: '收起真实大小控件',
  },
  en: {
    title: 'Carry a country',
    subtitle: 'Select a point on the globe; the outline stays centred on it',
    country: 'Country to carry',
    pickUp: 'Carry the country at the selected point',
    home: 'Put it back home',
    note: 'The outline turns as a whole over the sphere with north up, so its shape and area never change.',
    expand: 'Expand True Size controls',
    collapse: 'Collapse True Size controls',
  },
} as const;

export function TrueSizeControls({
  locale,
  presentation,
}: {
  locale: Locale;
  presentation: Extract<ModePresentation, { id: 'truesize' }>;
}) {
  const copy = COPY[locale];
  const countryId = useAppStore((state) => state.trueSizeCountry);
  const setCountry = useAppStore((state) => state.setTrueSizeCountry);
  const selectPoint = useAppStore((state) => state.selectPoint);
  const options = useMemo(() => {
    const collator = new Intl.Collator(locale === 'zh' ? 'zh-CN' : 'en');
    return [...trueSizeCountryIds()]
      .map((id) => ({ id, label: COUNTRY_NAMES[id]![locale] }))
      .sort((a, b) => collator.compare(a.label, b.label));
  }, [locale]);
  const hostId = presentation.selectedCountry?.countryId ?? null;
  const canPickUp =
    hostId !== null && hostId !== countryId && trueSizeCountryIds().has(hostId);
  const anchor = presentation.placement?.anchor ?? null;

  return (
    <ModePanel
      id="truesize-controls"
      title={copy.title}
      subtitle={copy.subtitle}
      expandLabel={copy.expand}
      collapseLabel={copy.collapse}
    >
      <div className={styles.controls}>
        <label className={styles.picker}>
          <span>{copy.country}</span>
          <select
            value={countryId}
            onChange={(event) => setCountry(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!canPickUp}
            onClick={() => {
              if (hostId) setCountry(hostId);
            }}
          >
            {copy.pickUp}
          </button>
          <button
            type="button"
            disabled={!anchor}
            onClick={() => {
              if (anchor)
                selectPoint({
                  latitude: Number(anchor.latitude.toFixed(4)),
                  longitude: Number(anchor.longitude.toFixed(4)),
                });
            }}
          >
            {copy.home}
          </button>
        </div>
        <p className={styles.note}>{copy.note}</p>
      </div>
    </ModePanel>
  );
}

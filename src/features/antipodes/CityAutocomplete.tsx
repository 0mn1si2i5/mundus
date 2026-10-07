import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { Locale } from '../../i18n/messages';
import { searchGeoNamesCities, type GeoNamesCity } from './geonamesCities';
import type { GeoNamesCityLoadState } from './useGeoNamesCityIndex';
import styles from './CityAutocomplete.module.css';

const COPY = {
  en: {
    label: 'Search major cities',
    placeholder: 'Search a city or country',
    loading: 'Loading major cities…',
    minimum: 'Type two letters or one Chinese character.',
    none: 'No matching cities.',
    count: (count: number) =>
      `${count} matching ${count === 1 ? 'city' : 'cities'}.`,
    error: 'City index is unavailable.',
    retry: 'Retry city index',
    zhFallback: '',
  },
  zh: {
    label: '搜索全球主要城市',
    placeholder: '搜索城市或国家',
    loading: '正在载入主要城市…',
    minimum: '请输入两个字母或一个汉字。',
    none: '没有匹配的城市。',
    count: (count: number) => `${count} 个匹配城市。`,
    error: '城市索引暂时不可用。',
    retry: '重试城市索引',
    zhFallback: 'GeoNames 原名（暂无中文名）',
  },
} as const;

export function CityAutocomplete({
  locale,
  loadState,
  onSelect,
}: {
  locale: Locale;
  loadState: GeoNamesCityLoadState;
  onSelect: (city: GeoNamesCity) => void;
}) {
  const listboxId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const copy = COPY[locale];
  const results =
    loadState.status === 'ready'
      ? searchGeoNamesCities(loadState.data, query, locale)
      : [];
  const visible = open && results.length > 0;
  const ambiguous = new Set<string>();
  if (visible) {
    const tuples = new Map<string, GeoNamesCity[]>();
    for (const city of results) {
      const key = [
        city.name[locale],
        city.admin1?.[locale],
        city.country[locale],
      ]
        .filter(Boolean)
        .join('\u0000');
      const matches = tuples.get(key) ?? [];
      matches.push(city);
      tuples.set(key, matches);
    }
    for (const matches of tuples.values()) {
      if (
        matches.length > 1 &&
        new Set(
          matches.map(
            (city) => `${city.point.latitude},${city.point.longitude}`,
          ),
        ).size > 1
      ) {
        for (const city of matches) ambiguous.add(String(city.id));
      }
    }
  }

  useEffect(() => {
    function closeForOutsidePointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setActive(-1);
      }
    }
    document.addEventListener('pointerdown', closeForOutsidePointer);
    return () =>
      document.removeEventListener('pointerdown', closeForOutsidePointer);
  }, []);

  function select(city: GeoNamesCity) {
    onSelect(city);
    setQuery('');
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!results.length) return;
      event.preventDefault();
      setOpen(true);
      setActive((current) => {
        if (event.key === 'ArrowDown')
          return current >= results.length - 1 ? 0 : current + 1;
        return current <= 0 ? results.length - 1 : current - 1;
      });
    } else if (event.key === 'Enter' && active >= 0 && results[active]) {
      event.preventDefault();
      select(results[active]);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false);
      setActive(-1);
    }
  }

  function pointerSelect(event: MouseEvent, city: GeoNamesCity) {
    event.preventDefault();
    select(city);
  }

  function closeForFocusLeave(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
      setActive(-1);
    }
  }

  // Stay quiet until the user starts typing.
  let status: string = query.trim() ? copy.minimum : '';
  if (loadState.status === 'loading') status = copy.loading;
  else if (loadState.status === 'ready' && query)
    status = results.length ? copy.count(results.length) : copy.none;

  return (
    <div
      className={styles.root}
      ref={root}
      onBlur={closeForFocusLeave}
      data-city-search-ms="0.000"
    >
      <label htmlFor={`${listboxId}-input`}>{copy.label}</label>
      <input
        id={`${listboxId}-input`}
        role="combobox"
        type="search"
        value={query}
        placeholder={copy.placeholder}
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={listboxId}
        aria-activedescendant={
          visible && active >= 0
            ? `city-option-${results[active]?.id}`
            : undefined
        }
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => {
          if (loadState.status === 'idle') loadState.load();
          if (results.length) setOpen(true);
        }}
        onChange={(event) => {
          if (loadState.status === 'ready') {
            const started = performance.now();
            searchGeoNamesCities(loadState.data, event.target.value, locale);
            root.current?.setAttribute(
              'data-city-search-ms',
              (performance.now() - started).toFixed(3),
            );
          }
          setQuery(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
      />
      {visible ? (
        <ul
          id={listboxId}
          role="listbox"
          className={styles.results}
          aria-label={copy.label}
        >
          {results.map((city, index) => (
            <li
              id={`city-option-${city.id}`}
              key={city.id}
              role="option"
              aria-label={optionLabel(
                city,
                locale,
                ambiguous.has(String(city.id)),
              )}
              aria-selected={index === active}
              onMouseDown={(event) => pointerSelect(event, city)}
            >
              <strong>{city.name[locale]}</strong>
              <span>
                {[city.admin1?.[locale], city.country[locale]]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {ambiguous.has(String(city.id)) ? (
                <small>{coordinateLabel(city, locale)}</small>
              ) : null}
              {locale === 'zh' && city.name.en !== city.name.zh ? (
                <small>{city.name.en}</small>
              ) : null}
              {locale === 'zh' && city.nameZhFallback ? (
                <small>{copy.zhFallback}</small>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className={styles.status} role="status" aria-live="polite">
        {status}
      </p>
      {loadState.status === 'error' ? (
        <div className={styles.error} role="alert">
          <span>{copy.error}</span>
          <button type="button" onClick={loadState.retry}>
            {copy.retry}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function formatCoordinate(value: number, positive: string, negative: string) {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(5)}° ${value >= 0 ? positive : negative}`;
}

function coordinateLabel(city: GeoNamesCity, locale: Locale) {
  const latitude = formatCoordinate(
    city.point.latitude,
    locale === 'en' ? 'N' : '北',
    locale === 'en' ? 'S' : '南',
  );
  const longitude = formatCoordinate(
    city.point.longitude,
    locale === 'en' ? 'E' : '东',
    locale === 'en' ? 'W' : '西',
  );
  return locale === 'en'
    ? `latitude ${latitude}; longitude ${longitude}`
    : `纬度 ${latitude}；经度 ${longitude}`;
}

function optionLabel(city: GeoNamesCity, locale: Locale, ambiguous: boolean) {
  const values = [
    city.name[locale],
    city.admin1?.[locale],
    city.country[locale],
  ].filter(Boolean);
  if (ambiguous) values.push(coordinateLabel(city, locale));
  if (locale === 'zh' && city.nameZhFallback) values.push(COPY.zh.zhFallback);
  if (locale === 'zh' && city.name.en !== city.name.zh) {
    values.push(`英文名 ${city.name.en}`);
  }
  return values.join(locale === 'en' ? '; ' : '；');
}

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CityReachResult } from './CityReachResult';
import { sortCityReachCities } from './cityReachData';
import { cityReachCentreStatus } from './cityReachPresentation';
import type { CityReachCity, CityReachMetadata } from './cityReachTypes';
import type { CityReachFieldState } from './useCityReachField';

const smaller: CityReachCity = {
  id: 1,
  ownerIndex: 1,
  name: { en: 'Small', zh: '小城' },
  country: { en: 'Chile', zh: '智利' },
  nameMatchType: 'override',
  population: 100_000,
  point: { latitude: 0, longitude: 0 },
  centrePoint: { latitude: 0, longitude: 0 },
  threshold: 2,
  parentId: 2,
  status: 'ok',
  mergedIntoId: null,
};
const larger: CityReachCity = {
  ...smaller,
  id: 2,
  ownerIndex: 2,
  name: { en: 'Large', zh: '大城' },
  population: 1_000_000,
  status: 'root',
  threshold: null,
  parentId: null,
};
const metadata = {
  cities: [smaller, larger],
  byId: new Map([
    [1, smaller],
    [2, larger],
  ]),
  inspectableCities: [smaller, larger],
} as unknown as CityReachMetadata;
function field(): CityReachFieldState {
  return {
    status: 'ready',
    metadata,
    frame: { level: 4 } as CityReachFieldState['frame'],
    pendingFrame: null,
    requestedLevel: 4,
    quality: 'low',
    error: null,
    retry: vi.fn(),
    commitFrame: vi.fn(),
    rejectFrame: vi.fn(),
  };
}

describe('city reach result meaning', () => {
  afterEach(cleanup);

  it.each([
    ['en', [5, 4, 6, 7, 3]],
    ['zh', [4, 7, 6, 5, 3]],
  ] as const)(
    'sorts leading catalog punctuation by the current language (%s)',
    (locale, expectedIds) => {
      const cities = [
        { ...smaller, id: 3, name: { en: "'Gamma", zh: "'西安" } },
        { ...smaller, id: 4, name: { en: '`Beta', zh: '`北京' } },
        { ...smaller, id: 5, name: { en: 'ʻAlpha', zh: 'ʻ上海' } },
        { ...smaller, id: 6, name: { en: 'ʿDelta', zh: 'ʿ广州' } },
        { ...smaller, id: 7, name: { en: 'Epsilon', zh: '成都' } },
      ];
      expect(
        sortCityReachCities(cities, locale).map((city) => city.id),
      ).toEqual(expectedIds);
      expect(cities[0]?.name).toEqual({ en: "'Gamma", zh: "'西安" });
    },
  );

  it('shows an English fallback for a required owner and parent with no reviewed Chinese name', () => {
    const owner = {
      ...smaller,
      name: { en: 'Small', zh: null },
      nameMatchType: 'none' as const,
    };
    const parent = {
      ...larger,
      name: { en: 'Large', zh: null },
      nameMatchType: 'none' as const,
    };
    const state = field();
    state.metadata = {
      ...metadata,
      cities: [owner, parent],
      byId: new Map([
        [1, owner],
        [2, parent],
      ]),
      inspectableCities: [owner, parent],
    };
    render(
      <CityReachResult
        locale="zh"
        field={state}
        selection={{
          status: 'owned',
          city: owner,
          ownerIndex: 1,
          row: 0,
          column: 0,
          density: 0,
        }}
      />,
    );
    expect(
      screen.getByRole('complementary').querySelector('em'),
    ).toHaveTextContent('Small');
    expect(screen.getByText('Large · 智利', { selector: 'dd' })).toBeVisible();
    expect(
      screen.getByRole('option', { name: 'Small · 智利' }),
    ).toBeInTheDocument();
  });
  it('keeps sampled point ownership while inspecting another city and includes the parent country', () => {
    render(
      <CityReachResult
        locale="zh"
        field={field()}
        selection={{
          status: 'owned',
          city: smaller,
          ownerIndex: 1,
          row: 0,
          column: 0,
          density: 0,
        }}
      />,
    );
    const result = screen.getByRole('complementary', {
      name: '城市邻近性结果',
    });
    expect(result).toHaveAttribute('data-city-reach-owner-id', '1');
    expect(screen.getByText('大城 · 智利', { selector: 'dd' })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    expect(result).toHaveAttribute('data-city-reach-owner-id', '1');
    expect(result.querySelector('em')).toHaveTextContent('小城');
    expect(screen.getByText('数据集中人口最大的城市')).toBeVisible();
    expect(screen.queryByText('阈值处接替的城市')).not.toBeInTheDocument();
  });
  it('shows a retained level and retry after a failed level change without claiming the requested level is displayed', () => {
    const state = {
      ...field(),
      status: 'error' as const,
      requestedLevel: 8 as const,
    };
    render(
      <CityReachResult
        locale="en"
        field={state}
        selection={{ status: 'unreachable', row: 0, column: 0, density: null }}
      />,
    );
    expect(
      screen.getByText('Owner of the selected point · k = 4'),
    ).toBeVisible();
    expect(screen.getByText(/Still showing k = 4/)).toBeVisible();
    expect(
      screen.getByText('No city reachable; ferries are excluded'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });
  it('distinguishes global and transport-component roots and never claims an unmeasured threshold', () => {
    expect(cityReachCentreStatus(larger, 'zh')).toBe('数据集中人口最大的城市');
    expect(
      cityReachCentreStatus({ ...larger, status: 'no_larger_reachable' }, 'zh'),
    ).toBe('所在陆块/岛屿（交通连通区域）中人口最大的城市');
    expect(cityReachCentreStatus({ ...smaller, threshold: 20 }, 'en')).toBe(
      'Centre keeps its own city at every exhibit level',
    );
    expect(
      cityReachCentreStatus(
        { ...smaller, status: 'transport_missing', threshold: null },
        'en',
      ),
    ).toBe('No usable city source in the transport grid');
    expect(
      cityReachCentreStatus(
        { ...smaller, status: 'merged_at_resolution', threshold: null },
        'zh',
      ),
    ).toBe('在当前分辨率下并入其他城市');
    expect(
      cityReachCentreStatus(
        { ...smaller, status: 'disputed', threshold: null },
        'zh',
      ),
    ).toBe('争议地区，不显示归属');
    expect(() =>
      cityReachCentreStatus({ ...smaller, threshold: null }, 'en'),
    ).toThrow('Missing centre threshold');
  });
});

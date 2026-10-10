import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import type { ModePresentation } from '../modes/useModePresentation';
import { ReshapedResult } from './ReshapedResult';
import type {
  ReshapedDataset,
  ReshapedUnit,
  ReshapedValueRow,
} from './reshapedData';

const initialState = useAppStore.getState();
const alpha: ReshapedUnit = {
  id: 'ne-156:alpha',
  rasterId: 1,
  paletteIndex: 1,
  level: 'admin1',
  parentCountryId: 'ne-156',
  name: { zh: '甲区', en: 'Alpha' },
  areaKm2: 100,
  representativePoint: { latitude: 20, longitude: 100 },
};
const beta: ReshapedUnit = {
  ...alpha,
  id: 'ne-156:beta',
  rasterId: 2,
  paletteIndex: 2,
  name: { zh: null, en: 'Beta' },
  representativePoint: null,
};
const antarctica: ReshapedUnit = {
  ...alpha,
  id: 'ne-010',
  level: 'country',
  parentCountryId: 'ne-010',
  name: { zh: '南极洲', en: 'Antarctica' },
  excluded: true,
};
const china: ReshapedUnit = {
  ...antarctica,
  id: 'ne-156',
  parentCountryId: 'ne-156',
  name: { zh: '中国', en: 'China' },
  excluded: false,
};
const singapore: ReshapedUnit = {
  ...china,
  id: 'ne-702',
  parentCountryId: 'ne-702',
  name: { zh: '新加坡', en: 'Singapore' },
};

function row(
  unit: ReshapedUnit,
  value: number | null,
  share: number | null,
  ratio: number | null,
): ReshapedValueRow {
  return {
    id: unit.id,
    level: unit.level,
    year: 2020,
    values: { population: value, gdp: value, co2: value, lights: value },
    worldShare: { population: share, gdp: share, co2: share, lights: share },
    areaRatio: { population: ratio, gdp: ratio, co2: ratio, lights: ratio },
  };
}
const alphaValue = row(alpha, 123456789, 0.18, 2.7);
const betaValue = row(beta, 0, 0, 0.01);
const dataset: ReshapedDataset = {
  units: [alpha, beta, antarctica, china, singapore],
  unitsById: new Map(
    [alpha, beta, antarctica, china, singapore].map((unit) => [unit.id, unit]),
  ),
  unitsByRasterId: new Map([
    [1, alpha],
    [2, beta],
  ]),
  values: new Map([
    [alpha.id, alphaValue],
    [beta.id, betaValue],
  ]),
  ids: null,
  inverse: null,
  graphicsUnavailable: false,
  metric: 'population',
  level: 'admin1',
};
type Presentation = Extract<ModePresentation, { id: 'reshaped' }>;
function presentation(overrides: Partial<Presentation> = {}): Presentation {
  return {
    id: 'reshaped',
    metric: 'population',
    level: 'admin1',
    point: { latitude: 20, longitude: 100 },
    selectedCountry: null,
    data: { status: 'ready', data: dataset, retry: vi.fn() },
    selectedUnit: alpha,
    selectedValue: alphaValue,
    ranking: [alphaValue, betaValue],
    ...overrides,
  };
}

describe('ReshapedResult', () => {
  beforeEach(() =>
    useAppStore.setState(
      {
        ...initialState,
        reshapedGraphicsUnavailable: false,
        reshapedMorphState: 'settled',
      },
      true,
    ),
  );
  afterEach(() => {
    cleanup();
    useAppStore.setState(initialState, true);
  });

  it.each(['zh', 'en'] as const)(
    'renders the finding, true area ratio, year and source in %s',
    (locale) => {
      render(<ReshapedResult locale={locale} presentation={presentation()} />);
      const result = screen.getByRole('complementary', {
        name: messages[locale].reshapedResult,
      });
      expect(result).toHaveTextContent(
        locale === 'zh' ? '甲区占世界人口的 18.0%' : 'Alpha holds 18.0%',
      );
      expect(result).toHaveTextContent('2.7');
      expect(result).toHaveTextContent(
        locale === 'zh' ? '1.2亿' : '123.5 million',
      );
      expect(result).toHaveTextContent('2020');
      expect(result).toHaveTextContent('GHS-POP R2023A');
      expect(result).toHaveTextContent(locale === 'zh' ? '中国' : 'China');
      expect(
        within(result).getByRole('button', { name: /Beta/ }),
      ).toBeDisabled();
    },
  );

  it.each(['zh', 'en'] as const)(
    'shows small-country names from complete metadata in %s',
    (locale) => {
      const value = row(singapore, 100, 0.1, 2);
      render(
        <ReshapedResult
          locale={locale}
          presentation={presentation({
            level: 'country',
            selectedUnit: singapore,
            selectedValue: value,
            ranking: [value],
          })}
        />,
      );
      expect(screen.getByRole('complementary')).toHaveTextContent(
        locale === 'zh' ? '新加坡' : 'Singapore',
      );
      expect(screen.queryByText(/ne-702/)).not.toBeInTheDocument();
    },
  );

  it.each(['zh', 'en'] as const)(
    'keeps missing, Antarctica and ocean distinct in %s',
    (locale) => {
      const t = messages[locale];
      const { rerender } = render(
        <ReshapedResult
          locale={locale}
          presentation={presentation({
            selectedValue: row(alpha, null, null, null),
          })}
        />,
      );
      expect(screen.getByText(t.reshapedMissingShape)).toBeVisible();
      expect(
        within(screen.getByRole('complementary')).getAllByText(
          locale === 'zh' ? '无数据' : 'No data',
          { exact: true },
        ),
      ).not.toHaveLength(0);
      rerender(
        <ReshapedResult
          locale={locale}
          presentation={presentation({
            selectedUnit: antarctica,
            selectedValue: row(antarctica, null, null, null),
          })}
        />,
      );
      expect(screen.getByText(t.reshapedExcluded)).toBeVisible();
      expect(
        screen.queryByText(t.reshapedMissingShape),
      ).not.toBeInTheDocument();
      rerender(
        <ReshapedResult
          locale={locale}
          presentation={presentation({
            selectedUnit: null,
            selectedValue: null,
            data: {
              status: 'ready',
              data: {
                ...dataset,
                ids: { width: 1, height: 1, ids: new Uint32Array([0]) },
              },
              retry: vi.fn(),
            },
          })}
        />,
      );
      expect(screen.getByText(t.reshapedOcean)).toBeVisible();
      expect(screen.queryByText(t.reshapedValue)).not.toBeInTheDocument();
      expect(screen.queryByText(t.reshapedExcluded)).not.toBeInTheDocument();
    },
  );

  it('renders a real zero as zero instead of a missing state', () => {
    render(
      <ReshapedResult
        locale="en"
        presentation={presentation({
          selectedUnit: beta,
          selectedValue: betaValue,
        })}
      />,
    );
    const result = screen.getByRole('complementary');
    expect(result).toHaveTextContent('Beta holds 0.0%');
    expect(within(result).getByText('0')).toBeVisible();
    expect(
      screen.queryByText(messages.en.reshapedMissingShape),
    ).not.toBeInTheDocument();
  });

  it('selects a ranked unit with its real representative point and current-state semantics', () => {
    render(<ReshapedResult locale="en" presentation={presentation()} />);
    const alphaButton = screen.getByRole('button', { name: 'Alpha · 18.0%' });
    expect(alphaButton).toHaveAttribute('aria-current', 'true');
    alphaButton.focus();
    expect(alphaButton).toHaveFocus();
    fireEvent.click(alphaButton);
    expect(useAppStore.getState()).toMatchObject({
      point: alpha.representativePoint,
      reshapedSelectedUnitId: alpha.id,
      cameraFocusIntent: { side: 'origin', target: alpha.representativePoint },
    });
  });

  it('supports loading, explicit retry and recovery without fabricated results', () => {
    const retry = vi.fn();
    const { rerender } = render(
      <ReshapedResult
        locale="en"
        presentation={presentation({ data: { status: 'loading', retry } })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.en.reshapedLoading,
    );
    expect(screen.queryByText('World share')).not.toBeInTheDocument();
    rerender(
      <ReshapedResult
        locale="en"
        presentation={presentation({ data: { status: 'error', retry } })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(retry).toHaveBeenCalledOnce();
    rerender(<ReshapedResult locale="en" presentation={presentation()} />);
    expect(screen.getByRole('complementary')).toHaveTextContent(
      'Alpha holds 18.0%',
    );
  });

  it('keeps values and ranking usable when graphics fail and states the lights caveat', () => {
    render(
      <ReshapedResult
        locale="en"
        presentation={presentation({
          metric: 'lights',
          data: {
            status: 'ready',
            data: { ...dataset, graphicsUnavailable: true },
            retry: vi.fn(),
          },
        })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.en.reshapedDeviceUnavailable,
    );
    expect(screen.getByText(messages.en.reshapedLightsCaveat)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Alpha · 18.0%' })).toBeEnabled();
    expect(
      screen.queryByText('Cartogram displayed for Night lights.'),
    ).not.toBeInTheDocument();
  });

  it.each(['zh', 'en'] as const)(
    'does not call an unresolved admin-1 place ocean when ID decoding is unavailable in %s',
    (locale) => {
      render(
        <ReshapedResult
          locale={locale}
          presentation={presentation({
            selectedUnit: null,
            selectedValue: null,
            data: {
              status: 'ready',
              data: { ...dataset, graphicsUnavailable: true },
              retry: vi.fn(),
            },
          })}
        />,
      );
      expect(
        screen.getByText(messages[locale].reshapedSelectionUnavailable),
      ).toBeVisible();
      expect(
        screen.queryByText(messages[locale].reshapedOcean),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: locale === 'zh' ? '甲区 · 18.0%' : 'Alpha · 18.0%',
        }),
      ).toBeEnabled();
    },
  );

  it('announces completion only after the morph settles', () => {
    useAppStore.setState({ reshapedMorphState: 'animating' });
    render(<ReshapedResult locale="en" presentation={presentation()} />);
    expect(
      screen.queryByText('Cartogram displayed for Population.'),
    ).not.toBeInTheDocument();
    act(() => useAppStore.getState().setReshapedMorphState('settled'));
    expect(
      screen.getByText('Cartogram displayed for Population.'),
    ).toHaveAttribute('aria-live', 'polite');
  });
});

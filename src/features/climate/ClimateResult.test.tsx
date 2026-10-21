import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModePresentation } from '../modes/useModePresentation';
import { ClimateResult } from './ClimateResult';
import type { ClimateDataset } from './climateMetrics';
import { KOPPEN_CLASSES } from './koppenClasses';

type Presentation = Extract<ModePresentation, { id: 'climate' }>;

const dataset: ClimateDataset = {
  grid: { width: 360, height: 180, west: -180, north: 90, step: 1 },
  classes: new Uint8Array(360 * 180),
  landShare: KOPPEN_CLASSES.map((type) => (type.code === 'Csa' ? 0.012 : 0)),
};

function presentation(overrides: Partial<Presentation>): Presentation {
  return {
    id: 'climate',
    point: { latitude: 41.9, longitude: 12.5 },
    selectedCountry: null,
    data: { status: 'ready', data: dataset },
    cities: { status: 'ready', data: [] },
    twins: { sample: null, sameLatitude: [], farTwins: [] },
    ...overrides,
  };
}

afterEach(cleanup);

describe('ClimateResult', () => {
  it('offers a retry when the class raster fails', () => {
    const retry = vi.fn();
    render(
      <ClimateResult
        locale="en"
        presentation={presentation({
          data: { status: 'error', data: null, retry },
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(retry).toHaveBeenCalled();
  });

  it('states the class, its land share and an explicit empty twin list', () => {
    render(
      <ClimateResult
        locale="zh"
        presentation={presentation({
          twins: {
            sample: { value: 8, snapped: true },
            sameLatitude: [],
            farTwins: [],
          },
        })}
      />,
    );
    expect(screen.getByTestId('climate-result')).toHaveAttribute(
      'data-climate-class',
      'Csa',
    );
    expect(
      screen.getByText(
        '这里属于 Csa，夏季炎热的地中海气候。这类气候约占全球陆地的 1.2%。',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/采用了约 20 km 内最近的陆地格/),
    ).toBeInTheDocument();
    expect(screen.getAllByText('没有符合条件的收录大城市。')).toHaveLength(2);
  });

  it('explains an ocean point and keeps cities pending while they load', () => {
    render(
      <ClimateResult
        locale="en"
        presentation={presentation({
          cities: { status: 'loading', data: null },
        })}
      />,
    );
    expect(screen.getByTestId('climate-result')).toHaveAttribute(
      'data-climate-class',
      'none',
    );
    expect(screen.getByText(/Köppen classes cover land only/)).toBeVisible();
    expect(screen.getByText('Loading GeoNames major cities…')).toBeVisible();
    expect(
      screen.queryByRole('region', {
        name: 'More than 3,000 km away, same climate',
      }),
    ).toBeNull();
  });
});

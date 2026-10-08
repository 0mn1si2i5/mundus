import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeIsolationDataset } from './isolationData';
import { IsolationResult } from './IsolationResult';
import type { ModePresentation } from '../modes/useModePresentation';

const dataset = decodeIsolationDataset({
  formatVersion: 1,
  strings: ['Alpha', 'Country', 'Beta'],
  cities: [
    ['a', 0, 0, 1000000, 0, null, 1, null, true],
    ['b', 0, 100000, 600000, 2, null, 1, null, false],
  ],
  holders: [[[1, 11]], null],
});

function presentation(
  selection: Extract<ModePresentation, { id: 'isolation' }>['selection'],
  datasetState: Extract<ModePresentation, { id: 'isolation' }>['dataset'] = {
    status: 'ready',
    data: dataset,
  },
): Extract<ModePresentation, { id: 'isolation' }> {
  return {
    id: 'isolation',
    alpha: 0.5,
    view: 'city',
    field: { status: 'idle', alpha: 0, sites: [], table: null, retry: vi.fn() },
    dataset: datasetState,
    selection,
    ranking: [],
  };
}

describe('IsolationResult', () => {
  afterEach(() => cleanup());

  it('renders the ready result and falls back to English when Chinese is missing', () => {
    render(
      <IsolationResult
        locale="zh"
        presentation={presentation({
          cityIndex: 0,
          distanceFromPointKm: 0,
          competitor: { index: 1, distanceKm: 11 },
          rank: { position: 1, total: 1 },
        })}
      />,
    );
    expect(screen.getByText('Alpha')).toBeVisible();
    expect(screen.getByText('Beta · Country')).toBeVisible();
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('0.50'),
    );
  });

  it('states explicitly when no competitor exists', () => {
    render(
      <IsolationResult
        locale="en"
        presentation={{
          ...presentation({
            cityIndex: 0,
            distanceFromPointKm: 0,
            competitor: null,
            rank: null,
          }),
          alpha: 1,
        }}
      />,
    );
    expect(screen.getByText(/no city in the dataset/i)).toBeVisible();
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('no proximity distance'),
    );
    expect(screen.getByRole('img')).not.toHaveAttribute(
      'aria-label',
      expect.stringContaining('0 km'),
    );
  });

  it('renders a retry action after a data error', () => {
    const retry = vi.fn();
    render(
      <IsolationResult
        locale="en"
        presentation={presentation(null, {
          status: 'error',
          data: null,
          retry,
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

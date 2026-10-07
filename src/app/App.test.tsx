import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { useAppStore } from '../state/appStore';

const failure = vi.hoisted(() => ({
  dataCalc: false as boolean,
  modeResultMode: null as string | null,
  modeControlsMode: null as string | null,
}));

vi.mock('../features/globe/GlobeViewport', () => ({
  GlobeViewport: ({ ariaLabel }: { ariaLabel?: string }) => (
    <canvas aria-label={ariaLabel} role="region" data-testid="globe-canvas" />
  ),
}));

vi.mock('../features/development/useDevelopmentDataset', () => ({
  useDevelopmentDataset: (enabled: boolean) =>
    enabled ? { status: 'ready', data: {} } : { status: 'idle', data: null },
}));

vi.mock('../features/antipodes/useGeoNamesCityIndex', () => ({
  useGeoNamesCityIndex: (enabled: boolean) =>
    enabled
      ? { status: 'ready', data: [] }
      : { status: 'idle', data: null, load: () => {} },
}));

vi.mock('../features/development/developmentData', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../features/development/developmentData')
    >();
  return {
    ...actual,
    valuesByCountryId: () => {
      if (failure.dataCalc)
        throw new Error('injected data calculation failure');
      return new Map();
    },
  };
});

vi.mock('../features/modes/ModeResult', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../features/modes/ModeResult')>();
  const RealResult = actual.ModeResult;
  function ModeResultMock(props: Parameters<typeof RealResult>[0]) {
    if (failure.modeResultMode === props.presentation.id) {
      throw new Error('injected ModeResult failure');
    }
    return <RealResult {...props} />;
  }
  return { ...actual, ModeResult: ModeResultMock };
});

vi.mock('../features/modes/ModeControls', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../features/modes/ModeControls')>();
  const RealControls = actual.ModeControls;
  function ModeControlsMock(props: Parameters<typeof RealControls>[0]) {
    if (failure.modeControlsMode === props.presentation.id) {
      throw new Error('injected ModeControls failure');
    }
    return <RealControls {...props} />;
  }
  return { ...actual, ModeControls: ModeControlsMock };
});

function resetStore() {
  useAppStore.setState({
    locale: 'zh',
    activeMode: null,
    navigationNotice: null,
    point: { latitude: 31.2304, longitude: 121.4737 },
    selectedCountry: null,
    antipodeCountry: null,
    hoveredCountry: null,
    hasInteracted: false,
    hasMeaningfulInteraction: false,
    sunlinePlaying: false,
  });
}

function enterMode(mode: 'development' | 'sunline') {
  act(() => {
    useAppStore.getState().selectMode(mode);
  });
}

function headerReturnButton() {
  return within(screen.getByRole('banner')).getByRole('link', {
    name: '回到 Mundus 展厅',
  });
}

describe('App mode failure isolation', () => {
  beforeEach(() => {
    failure.dataCalc = false;
    failure.modeResultMode = null;
    failure.modeControlsMode = null;
    window.localStorage.setItem('mundus:discovery-hint:v1', 'dismissed');
    resetStore();
  });

  afterEach(() => {
    cleanup();
    failure.dataCalc = false;
    failure.modeResultMode = null;
    failure.modeControlsMode = null;
  });

  it('contains a data-calculation failure while keeping the shell, canvas, and healthy modes', async () => {
    failure.dataCalc = true;
    render(<App />);
    enterMode('development');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(headerReturnButton()).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: '观察模式' })).getByRole(
        'button',
        { name: '地球另一端' },
      ),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: '分享' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '切换为英文' })).toBeEnabled();
    expect(await screen.findByTestId('globe-canvas')).toBeInTheDocument();

    fireEvent.click(headerReturnButton());
    expect(
      screen.getByRole('heading', { name: '选择一种观察' }),
    ).toBeInTheDocument();

    failure.dataCalc = false;
    enterMode('sunline');
    expect(screen.getByRole('heading', { name: '日照线' })).toBeInTheDocument();
    expect(await screen.findByTestId('globe-canvas')).toBeInTheDocument();
  });

  it('contains a ModeResult render failure while keeping the shell, canvas, and healthy modes', async () => {
    failure.modeResultMode = 'development';
    render(<App />);
    enterMode('development');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(headerReturnButton()).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: '观察模式' })).getByRole(
        'button',
        { name: '地球另一端' },
      ),
    ).toBeEnabled();
    expect(await screen.findByTestId('globe-canvas')).toBeInTheDocument();

    fireEvent.click(headerReturnButton());
    expect(
      screen.getByRole('heading', { name: '选择一种观察' }),
    ).toBeInTheDocument();

    failure.modeResultMode = null;
    enterMode('sunline');
    expect(screen.getByRole('heading', { name: '日照线' })).toBeInTheDocument();
    expect(await screen.findByTestId('globe-canvas')).toBeInTheDocument();
  });

  it('contains a ModeControls render failure while keeping the shell, canvas, and healthy modes', async () => {
    failure.modeControlsMode = 'development';
    render(<App />);
    enterMode('development');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(headerReturnButton()).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: '观察模式' })).getByRole(
        'button',
        { name: '地球另一端' },
      ),
    ).toBeEnabled();
    expect(await screen.findByTestId('globe-canvas')).toBeInTheDocument();

    fireEvent.click(headerReturnButton());
    expect(
      screen.getByRole('heading', { name: '选择一种观察' }),
    ).toBeInTheDocument();

    failure.modeControlsMode = null;
    enterMode('sunline');
    expect(screen.getByRole('heading', { name: '日照线' })).toBeInTheDocument();
    expect(await screen.findByTestId('globe-canvas')).toBeInTheDocument();
  });

  it('does not unmount the shared canvas when a mode fails', async () => {
    failure.modeResultMode = 'sunline';
    render(<App />);
    enterMode('sunline');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByTestId('globe-canvas')).toBeInTheDocument();
  });
});

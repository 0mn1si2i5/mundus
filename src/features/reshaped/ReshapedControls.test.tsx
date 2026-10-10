import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages, type Locale } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import type { ModePresentation } from '../modes/useModePresentation';
import { ReshapedControls } from './ReshapedControls';

const initialState = useAppStore.getState();

function BoundControls({ locale }: { locale: Locale }) {
  const metric = useAppStore((state) => state.reshapedMetric);
  const level = useAppStore((state) => state.reshapedLevel);
  const presentation: Extract<ModePresentation, { id: 'reshaped' }> = {
    id: 'reshaped',
    metric,
    level,
    point: { latitude: 10, longitude: 20 },
    selectedCountry: null,
    selectedUnit: null,
    selectedValue: null,
    ranking: [],
    data: { status: 'idle', retry: vi.fn() },
  };
  return <ReshapedControls locale={locale} presentation={presentation} />;
}

describe('ReshapedControls', () => {
  beforeEach(() =>
    useAppStore.setState(
      {
        ...initialState,
        reshapedMetric: 'population',
        reshapedLevel: 'country',
        reshapedShape: 'reshaped',
        point: { latitude: 10, longitude: 20 },
      },
      true,
    ),
  );
  afterEach(() => {
    cleanup();
    useAppStore.setState(initialState, true);
  });

  it.each(['zh', 'en'] as const)(
    'exposes labelled native radio groups in %s and preserves the place while switching',
    (locale) => {
      render(<BoundControls locale={locale} />);
      const t = messages[locale];
      const measures = within(
        screen.getByRole('radiogroup', { name: t.reshapedMetric }),
      );
      const levels = within(
        screen.getByRole('radiogroup', { name: t.reshapedLevel }),
      );
      const radios = measures.getAllByRole('radio');
      expect(radios).toHaveLength(4);
      expect(levels.getAllByRole('radio')).toHaveLength(2);
      expect(radios[0]).toBeChecked();
      expect(
        radios.every(
          (radio) =>
            radio.tagName === 'INPUT' &&
            radio.getAttribute('type') === 'radio' &&
            radio.getAttribute('name') === 'reshaped-metric',
        ),
      ).toBe(true);
      const gdp = measures.getByRole('radio', { name: 'GDP' });
      gdp.focus();
      expect(gdp).toHaveFocus();
      fireEvent.click(gdp);
      expect(gdp).toBeChecked();
      expect(radios[0]).not.toBeChecked();
      fireEvent.click(levels.getAllByRole('radio')[1]!);
      expect(levels.getAllByRole('radio')[1]).toBeChecked();
      expect(useAppStore.getState()).toMatchObject({
        reshapedMetric: 'gdp',
        reshapedLevel: 'admin1',
        point: { latitude: 10, longitude: 20 },
      });
    },
  );

  it('updates aria-pressed and replays from true shape without changing metric or point', () => {
    render(<BoundControls locale="en" />);
    const trueShape = screen.getByRole('button', { name: 'True shape' });
    const reshaped = screen.getByRole('button', {
      name: /^Reshaped$/u,
    });
    expect(trueShape).toHaveAttribute('aria-pressed', 'false');
    expect(reshaped).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(trueShape);
    expect(trueShape).toHaveAttribute('aria-pressed', 'true');
    expect(reshaped).toHaveAttribute('aria-pressed', 'false');
    const key = useAppStore.getState().reshapedReplayKey;
    const replay = screen.getByRole('button', { name: 'Replay morph' });
    replay.focus();
    expect(replay).toHaveFocus();
    fireEvent.click(replay);
    expect(reshaped).toHaveAttribute('aria-pressed', 'true');
    expect(useAppStore.getState()).toMatchObject({
      reshapedReplayKey: key + 1,
      reshapedMetric: 'population',
      point: { latitude: 10, longitude: 20 },
    });
  });
});

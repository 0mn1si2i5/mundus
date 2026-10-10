import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('./publishedMetrics');
  vi.resetModules();
});

it('keeps the lightweight runtime registry aligned with the accepted publication', async () => {
  const { default: manifest } =
    await import('../../data/manifests/reshaped-earth.json');
  const { RESHAPED_METRIC_IDS } = await import('./metrics');
  expect(RESHAPED_METRIC_IDS).toEqual(manifest.publishedMetrics);
});

it('uses three published measures without renumbering padding bits or exposing GDP URLs', async () => {
  vi.resetModules();
  vi.doMock('./publishedMetrics', () => ({
    RESHAPED_PUBLISHED_METRIC_IDS: ['population', 'co2', 'lights'],
  }));
  const metrics = await import('./metrics');
  expect(metrics.RESHAPED_METRIC_IDS).toEqual(['population', 'co2', 'lights']);
  expect(metrics.isReshapedMetric('gdp')).toBe(false);
  expect(metrics.RESHAPED_METRIC_BITS).toEqual({
    population: 0,
    gdp: 1,
    co2: 2,
    lights: 3,
  });
  const { parseUrlState, serializeUrlState } =
    await import('../../state/urlState');
  const state = parseUrlState('?v=2&mode=reshaped&metric=gdp');
  expect(state.reshapedMetric).toBe('population');
  expect(serializeUrlState(state)).not.toContain('metric=gdp');
});

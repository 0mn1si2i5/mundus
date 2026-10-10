import { expect, it } from 'vitest';
import { ReshapedThemeTransition } from './reshapedThemeTransition';
import { MORPH_DURATION_MS } from '../reshaped/reshapedMapping';

it('mixes theme tokens independently of shape and switches directly for reduced motion', () => {
  const theme = new ReshapedThemeTransition('gdp');
  theme.sync('lights', false, 100);
  expect(theme).toMatchObject({ from: 'gdp', to: 'lights', t: 0 });
  theme.tick(100 + MORPH_DURATION_MS / 2);
  expect(theme.t).toBe(0.5);
  theme.tick(100 + MORPH_DURATION_MS);
  expect(theme.active).toBe(false);
  theme.sync('population', true, 2000);
  expect(theme).toMatchObject({ from: 'lights', to: 'population', t: 1 });
});

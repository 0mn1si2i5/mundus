import { describe, expect, it } from 'vitest';
import {
  CIRCLE_RADIUS_MAX_KM,
  CIRCLE_RADIUS_MIN_KM,
  CIRCLE_SLIDER_STEPS,
  isCircleRadius,
  parseCircleRadiusParam,
  radiusToSlider,
  roundCircleRadius,
  sliderToRadius,
} from './circleRadius';

describe('circle radius', () => {
  it('accepts only whole kilometres within the slider range', () => {
    expect(parseCircleRadiusParam('50')).toBe(50);
    expect(parseCircleRadiusParam('20000')).toBe(20000);
    expect(parseCircleRadiusParam('3343')).toBe(3343);
    for (const raw of [null, '', '49', '20001', '1e3', '12.5', ' 100'])
      expect(parseCircleRadiusParam(raw)).toBeNull();
    expect(isCircleRadius(100.5)).toBe(false);
  });

  it('maps the logarithmic slider onto both ends of the range', () => {
    expect(sliderToRadius(0)).toBe(CIRCLE_RADIUS_MIN_KM);
    expect(sliderToRadius(CIRCLE_SLIDER_STEPS)).toBe(CIRCLE_RADIUS_MAX_KM);
    expect(radiusToSlider(CIRCLE_RADIUS_MIN_KM)).toBe(0);
    expect(radiusToSlider(CIRCLE_RADIUS_MAX_KM)).toBe(CIRCLE_SLIDER_STEPS);
    for (let position = 0; position <= CIRCLE_SLIDER_STEPS; position += 37) {
      const radius = sliderToRadius(position);
      expect(isCircleRadius(radius)).toBe(true);
      expect(Math.abs(radiusToSlider(radius) - position)).toBeLessThanOrEqual(
        4,
      );
    }
  });

  it('rounds to coarser steps as the circle grows', () => {
    expect(roundCircleRadius(123.4)).toBe(123);
    expect(roundCircleRadius(1234)).toBe(1235);
    expect(roundCircleRadius(3343)).toBe(3340);
    expect(roundCircleRadius(10)).toBe(CIRCLE_RADIUS_MIN_KM);
  });
});

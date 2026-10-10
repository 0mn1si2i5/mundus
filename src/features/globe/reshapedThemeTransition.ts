import { MORPH_DURATION_MS } from '../reshaped/reshapedMapping';
import type { ReshapedMetricId } from '../reshaped/metrics';

/** A true-shape measure change animates colour without animating geometry. */
export class ReshapedThemeTransition {
  from: ReshapedMetricId;
  to: ReshapedMetricId;
  t = 1;
  private startedAt = 0;

  constructor(metric: ReshapedMetricId) {
    this.from = metric;
    this.to = metric;
  }

  get active() {
    return this.t < 1;
  }

  sync(metric: ReshapedMetricId, reducedMotion: boolean, now: number) {
    if (metric !== this.to) {
      this.from = this.to;
      this.to = metric;
      this.startedAt = now;
      this.t = reducedMotion ? 1 : 0;
    } else if (reducedMotion) this.t = 1;
  }

  tick(now: number) {
    const elapsed = Math.max(
      0,
      Math.min(1, (now - this.startedAt) / MORPH_DURATION_MS),
    );
    this.t = elapsed * elapsed * (3 - 2 * elapsed);
  }
}

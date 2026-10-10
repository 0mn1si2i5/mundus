import type { InverseField } from '../reshaped/inverseFormat.mjs';
import {
  MORPH_DURATION_MS,
  type MorphMapping,
} from '../reshaped/reshapedMapping';

/** Own only the current field and, during a measure change, its predecessor. */
export class ReshapedTransition<Texture> {
  readonly mapping: MorphMapping = { from: null, to: null, t: 1 };
  private current: {
    field: InverseField;
    texture: Texture;
    metric: string;
  } | null = null;
  private previous: {
    field: InverseField;
    texture: Texture;
    metric: string;
  } | null = null;
  private configured = false;
  private requestedMetric = '';
  private shape: 'true' | 'reshaped' = 'reshaped';
  private replayKey = 0;
  private animation = { active: false, startedAt: 0, from: 0, to: 1 };

  constructor(
    private readonly createTexture: (field: InverseField) => Texture,
    private readonly disposeTexture: (texture: Texture) => void,
  ) {}

  get active() {
    return this.animation.active;
  }
  get fromMetric() {
    return this.mapping.from ? (this.previous?.metric ?? null) : null;
  }
  get toMetric() {
    return this.current?.metric ?? null;
  }

  textureFor(field: InverseField | null): Texture | null {
    if (!field) return null;
    if (this.current?.field === field) return this.current.texture;
    if (this.previous?.field === field) return this.previous.texture;
    return null;
  }

  sync(
    field: InverseField,
    shape: 'true' | 'reshaped',
    requestedMetric: string,
    replayKey: number,
    reducedMotion: boolean,
    now: number,
    fieldMetric = requestedMetric,
  ) {
    const changedField = this.current?.field !== field;
    const changedShape = this.configured && this.shape !== shape;
    const replay = this.configured && this.replayKey !== replayKey;
    if (this.configured && this.requestedMetric !== requestedMetric)
      this.settle(this.shape);

    if (changedField) {
      this.settle(this.shape);
      const old = this.current;
      this.current = {
        field,
        texture: this.createTexture(field),
        metric: fieldMetric,
      };
      if (old && shape === 'reshaped' && this.shape === 'reshaped')
        this.previous = old;
      else if (old) this.disposeTexture(old.texture);
      this.mapping.from = this.previous?.field ?? null;
      this.mapping.to = field;
      this.start(0, shape === 'reshaped' ? 1 : 0, reducedMotion, now, shape);
    } else if (changedShape || replay) {
      if (this.previous) this.settle(this.shape);
      this.mapping.from = null;
      this.mapping.to = field;
      this.start(
        replay ? 0 : this.mapping.t,
        shape === 'reshaped' ? 1 : 0,
        reducedMotion,
        now,
        shape,
      );
    } else if (reducedMotion && this.active) this.settle(shape);

    this.configured = true;
    this.requestedMetric = requestedMetric;
    this.shape = shape;
    this.replayKey = replayKey;
  }

  tick(now: number) {
    if (!this.active) return;
    const elapsed = Math.min(
      1,
      Math.max(0, (now - this.animation.startedAt) / MORPH_DURATION_MS),
    );
    const eased = elapsed * elapsed * (3 - 2 * elapsed);
    this.mapping.t =
      this.animation.from + (this.animation.to - this.animation.from) * eased;
    if (elapsed === 1) this.settle(this.shape);
  }

  dispose() {
    this.animation.active = false;
    if (this.previous) this.disposeTexture(this.previous.texture);
    if (this.current) this.disposeTexture(this.current.texture);
    this.previous = null;
    this.current = null;
    this.mapping.from = null;
    this.mapping.to = null;
    this.configured = false;
  }

  private start(
    from: number,
    to: number,
    reducedMotion: boolean,
    now: number,
    shape: 'true' | 'reshaped',
  ) {
    this.mapping.t = from;
    this.animation = {
      active: !reducedMotion && from !== to,
      startedAt: now,
      from,
      to,
    };
    if (!this.active) this.settle(shape);
  }

  private settle(shape: 'true' | 'reshaped') {
    this.animation.active = false;
    if (this.previous) this.disposeTexture(this.previous.texture);
    this.previous = null;
    this.mapping.from = null;
    this.mapping.to = this.current?.field ?? null;
    this.mapping.t = shape === 'reshaped' ? 1 : 0;
  }
}

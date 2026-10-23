import type { SurnameLabelSlot } from './surnameLabelSlots';
import type { SurnameWordmark } from '../surnames/surnameWordmark';

/**
 * One country's wordmark for the surface label layer. Surname Atlas and
 * Literal Names resolve their own wordmark text; the layer only places it.
 */
export interface MapWordmarkLabel {
  countryId: string;
  countryName: string;
  wordmark: SurnameWordmark | null;
}

/** A screen-obstacle adjustment must remain inside the validated footprint. */
export function shrinkBlockedWordmarkSlot(
  slot: SurnameLabelSlot,
): SurnameLabelSlot {
  return {
    ...slot,
    maxAngularDegrees: slot.maxAngularDegrees * 0.68,
    squareMax: slot.squareMax === undefined ? undefined : slot.squareMax * 0.68,
  };
}

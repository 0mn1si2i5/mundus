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

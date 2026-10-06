import detailedAtlas from 'world-atlas/countries-50m.json';
import { countryFeaturesFromTopology } from './countryData';

/**
 * Surname-only runtime, loaded lazily when the Surname Atlas opens. The 50m
 * topology and the generated slot table are large and no other observation
 * needs them, so they stay out of the always-loaded globe chunks.
 *
 * The slot table is generated against Natural Earth 50m geometry; runtime
 * land tests use the same geometry instead of the coarser 110m picking set.
 */
export const surnameCountries = countryFeaturesFromTopology(detailedAtlas);

export {
  chooseAlternativeSurnameLabelSlot,
  chooseSurnameLabelSlot,
  isSurnameLabelSlotOnRenderedLand,
} from './surnameLabelSlots';

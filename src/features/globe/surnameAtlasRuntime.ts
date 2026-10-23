/** Compact precomputed slots, loaded only for the two wordmark observations.
 * Geographic search is performed by the offline builder; no 50m topology is
 * needed to choose or reposition a label in the browser.
 */
export {
  chooseAlternativeSurnameLabelSlot,
  chooseSurnameLabelSlot,
  isSurnameLabelSlotOnRenderedLand,
} from './surnameLabelSlots';

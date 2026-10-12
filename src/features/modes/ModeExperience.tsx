import type { Locale } from '../../i18n/messages';
import type { GeoPoint } from '../globe/geo';
import { ModeControls } from './ModeControls';
import { ModeResult } from './ModeResult';
import {
  useModePresentation,
  type ReshapedLoadState,
} from './useModePresentation';

/**
 * Renders the active-mode result and controls from a single bounded
 * presentation hook. Any presentation, data, chunk, or render error inside
 * this subtree is contained by the caller's error boundary, leaving the
 * shell (header, language, atlas, return-to-lobby) intact.
 */
export function ModeExperience({
  locale,
  onCameraFocus,
  reshapedData,
}: {
  locale: Locale;
  reshapedData?: ReshapedLoadState;
  onCameraFocus: (point: GeoPoint) => void;
}) {
  const presentation = useModePresentation(reshapedData);
  if (presentation === null) return null;

  return (
    <>
      <ModeResult
        locale={locale}
        presentation={presentation}
        onCameraFocus={onCameraFocus}
      />
      <ModeControls locale={locale} presentation={presentation} />
    </>
  );
}

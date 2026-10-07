import { lazy, Suspense } from 'react';
import type { Locale } from '../../i18n/messages';
import type { ModePresentation } from './useModePresentation';

const OtherSideControls = lazy(() =>
  import('../antipodes/OtherSideControls').then((module) => ({
    default: module.OtherSideControls,
  })),
);
const DevelopmentControls = lazy(() =>
  import('../development/DevelopmentControls').then((module) => ({
    default: module.DevelopmentControls,
  })),
);
const SunlineControls = lazy(() =>
  import('../sunline/SunlineControls').then((module) => ({
    default: module.SunlineControls,
  })),
);
export function ModeControls({
  locale,
  presentation,
}: {
  locale: Locale;
  presentation: ModePresentation;
}) {
  let controls;
  switch (presentation.id) {
    case 'antipodes':
      controls = (
        <OtherSideControls locale={locale} cityIndex={presentation.cityIndex} />
      );
      break;
    case 'development':
      controls = (
        <DevelopmentControls
          locale={locale}
          loadState={presentation.developmentData}
          selectedCountry={presentation.selectedCountry}
        />
      );
      break;
    case 'sunline':
      controls = <SunlineControls locale={locale} />;
      break;
    case 'surnames':
      // The script toggle lives in the surname result card.
      return null;
    default:
      return assertNever(presentation);
  }
  return <Suspense fallback={null}>{controls}</Suspense>;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled controls: ${String(value)}`);
}

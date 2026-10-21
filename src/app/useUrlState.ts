import { useEffect } from 'react';
import { useAppStore } from '../state/appStore';
import {
  parseNavigationNotice,
  parseUrlState,
  serializeUrlState,
} from '../state/urlState';

export function useUrlState() {
  useEffect(() => {
    let applyingHistory = false;
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (
        applyingHistory ||
        (state.activeMode === previous.activeMode &&
          state.point === previous.point &&
          state.sunlineTimeMs === previous.sunlineTimeMs &&
          state.sunlineClockMode === previous.sunlineClockMode &&
          state.surnameDisplayMode === previous.surnameDisplayMode &&
          state.isolationAlpha === previous.isolationAlpha &&
          state.isolationView === previous.isolationView &&
          state.isolationReach === previous.isolationReach &&
          state.reshapedMetric === previous.reshapedMetric &&
          state.trueSizeCountry === previous.trueSizeCountry &&
          state.bordersDestination === previous.bordersDestination &&
          state.circleRadiusKm === previous.circleRadiusKm)
      ) {
        return;
      }
      const query = serializeUrlState(state);
      const onlySunlineTimeChanged =
        state.activeMode === previous.activeMode &&
        state.point === previous.point &&
        state.sunlineClockMode === previous.sunlineClockMode &&
        state.sunlineTimeMs !== previous.sunlineTimeMs;
      const onlyIsolationAlphaChanged =
        state.activeMode === previous.activeMode &&
        state.point === previous.point &&
        state.sunlineTimeMs === previous.sunlineTimeMs &&
        state.sunlineClockMode === previous.sunlineClockMode &&
        state.surnameDisplayMode === previous.surnameDisplayMode &&
        state.isolationView === previous.isolationView &&
        state.isolationReach === previous.isolationReach &&
        state.isolationAlpha !== previous.isolationAlpha;
      const onlyIsolationReachChanged =
        state.activeMode === previous.activeMode &&
        state.point === previous.point &&
        state.sunlineTimeMs === previous.sunlineTimeMs &&
        state.sunlineClockMode === previous.sunlineClockMode &&
        state.surnameDisplayMode === previous.surnameDisplayMode &&
        state.isolationView === previous.isolationView &&
        state.isolationAlpha === previous.isolationAlpha &&
        state.isolationReach !== previous.isolationReach;
      // Dragging the radius slider replaces the entry, like α; returning
      // to the half circle (null) is a deliberate step and is pushed.
      const onlyCircleRadiusChanged =
        state.activeMode === previous.activeMode &&
        state.point === previous.point &&
        state.circleRadiusKm !== null &&
        previous.circleRadiusKm !== null &&
        state.circleRadiusKm !== previous.circleRadiusKm;
      const updateHistory =
        onlySunlineTimeChanged ||
        onlyIsolationAlphaChanged ||
        onlyIsolationReachChanged ||
        onlyCircleRadiusChanged
          ? window.history.replaceState
          : window.history.pushState;
      updateHistory.call(
        window.history,
        null,
        '',
        `${window.location.pathname}${query}${window.location.hash}`,
      );
    });

    const restore = () => {
      applyingHistory = true;
      const parsed = parseUrlState(window.location.search);
      useAppStore.setState({
        ...parsed,
        bordersDestination: parsed.bordersDestination ?? null,
        navigationNotice: parseNavigationNotice(window.location.search),
        hoveredCountry: null,
        reshapedSelectedUnitId: undefined,
        cameraFocusIntent: { side: 'origin', target: null },
        sunlinePlaying: false,
      });
      applyingHistory = false;
    };
    window.addEventListener('popstate', restore);

    return () => {
      unsubscribe();
      window.removeEventListener('popstate', restore);
    };
  }, []);
}

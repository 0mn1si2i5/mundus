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
          state.developmentIndicator === previous.developmentIndicator &&
          state.developmentYear === previous.developmentYear &&
          state.sunlineTimeMs === previous.sunlineTimeMs &&
          state.sunlineClockMode === previous.sunlineClockMode &&
          state.surnameDisplayMode === previous.surnameDisplayMode)
      ) {
        return;
      }
      const query = serializeUrlState(state);
      const onlyDevelopmentYearChanged =
        state.activeMode === previous.activeMode &&
        state.point === previous.point &&
        state.developmentIndicator === previous.developmentIndicator &&
        state.developmentYear !== previous.developmentYear;
      const onlySunlineTimeChanged =
        state.activeMode === previous.activeMode &&
        state.point === previous.point &&
        state.developmentIndicator === previous.developmentIndicator &&
        state.developmentYear === previous.developmentYear &&
        state.sunlineClockMode === previous.sunlineClockMode &&
        state.sunlineTimeMs !== previous.sunlineTimeMs;
      const updateHistory =
        onlyDevelopmentYearChanged || onlySunlineTimeChanged
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
      useAppStore.setState({
        ...parseUrlState(window.location.search),
        previewMode: null,
        navigationNotice: parseNavigationNotice(window.location.search),
        hoveredCountry: null,
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

import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from './useReducedMotion';

function mockPreference(matches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches,
    addEventListener: vi.fn((_: string, listener: () => void) =>
      listeners.add(listener),
    ),
    removeEventListener: vi.fn((_: string, listener: () => void) =>
      listeners.delete(listener),
    ),
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue(query),
  });
  return {
    change(next: boolean) {
      query.matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function renderPreference() {
  const values: boolean[] = [];
  function Probe() {
    values.push(useReducedMotion());
    return null;
  }
  const view = render(<Probe />);
  return { values, view };
}

describe('useReducedMotion', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('reports a reduced-motion preference in the first render', () => {
    mockPreference(true);
    const { values } = renderPreference();
    // Effects that start animations run after the first commit, so a false
    // first value let the entry morph begin before it was cancelled.
    expect(values[0]).toBe(true);
    expect(values).not.toContain(false);
  });

  it('follows later preference changes', () => {
    const preference = mockPreference(false);
    const { values } = renderPreference();
    expect(values.at(-1)).toBe(false);
    act(() => preference.change(true));
    expect(values.at(-1)).toBe(true);
  });
});

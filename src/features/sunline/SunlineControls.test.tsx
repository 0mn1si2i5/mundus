import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SunlineControls } from './SunlineControls';

describe('SunlineControls copy', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  it.each([
    {
      locale: 'zh' as const,
      note: '曙暮光指太阳高度在 0° 至 -6° 之间',
    },
    {
      locale: 'en' as const,
      note: 'twilight means the Sun is between 0° and -6°',
    },
  ])(
    'states the twilight definition and educational caveat in $locale',
    ({ locale, note }) => {
      render(<SunlineControls locale={locale} />);
      expect(
        screen.getByText((_, element) =>
          Boolean(
            element?.tagName === 'P' && element.textContent?.includes(note),
          ),
        ),
      ).toBeVisible();
    },
  );
});

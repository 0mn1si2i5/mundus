import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../state/appStore';
import { SurnameControls } from './SurnameControls';

describe('SurnameControls', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    useAppStore.setState({ surnameDisplayMode: 'local' });
  });

  it.each([
    ['zh', ['当地语言', '拉丁转写', '中文']],
    ['en', ['Local script', 'Latin transliteration', 'Chinese']],
  ] as const)(
    'offers one mutually exclusive wordmark mode in %s',
    (locale, labels) => {
      render(<SurnameControls locale={locale} />);

      const group = screen.getByRole('radiogroup');
      expect(group).toBeVisible();
      const options = labels.map((label) =>
        screen.getByRole('radio', { name: label }),
      );
      expect(options).toHaveLength(3);
      expect(options[0]!).toHaveAttribute('aria-checked', 'true');
      expect(options[1]!).toHaveAttribute('aria-checked', 'false');

      fireEvent.click(options[1]!);

      expect(useAppStore.getState().surnameDisplayMode).toBe('latin');
      expect(options[0]!).toHaveAttribute('aria-checked', 'false');
      expect(options[1]!).toHaveAttribute('aria-checked', 'true');
    },
  );
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useAppStore } from '../../state/appStore';
import { ShareDialog } from './ShareDialog';
import { parseUrlState } from '../../state/urlState';

const initialShareState = {
  activeMode: 'antipodes' as const,
  point: { latitude: 31.2304, longitude: 121.4737 },
  sunlineTimeMs: Date.parse('2026-07-14T09:37:00Z'),
  sunlineClockMode: 'live' as const,
  surnameDisplayMode: 'local' as const,
  sunlinePlaying: false,
};

let root: HTMLDivElement;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useAppStore.setState(initialShareState);
  window.history.replaceState({}, '', '/exhibit');
  root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  root.remove();
  vi.restoreAllMocks();
});

describe('ShareDialog', () => {
  it('gives the read-only link field a 44px minimum block size', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/share/ShareDialog.module.css'),
      'utf8',
    );
    const linkFieldRule = css.match(/\.linkField\s*\{(?<body>[^}]*)\}/u)?.groups
      ?.body;

    expect(linkFieldRule).toMatch(/min-block-size:\s*2\.75rem;/u);
    expect(linkFieldRule).toMatch(/box-sizing:\s*border-box;/u);
  });

  it('offers one exact share action and copies the displayed canonical URL', async () => {
    useAppStore.setState({
      point: { latitude: 30.12346, longitude: 120.98765 },
    });
    render(<ShareDialog locale="en" onClose={vi.fn()} />);

    const field = screen.getByRole('textbox', { name: 'Share link' });
    expect(field).toHaveValue(
      'http://localhost:3000/exhibit?mode=antipodes&point=30.1235%2C120.9877&v=2',
    );
    expect(
      screen.getByRole('button', { name: 'Copy share link' }),
    ).toBeVisible();
    expect(
      screen.queryByText(/approximate|exact location/i),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(field.getAttribute('value')),
    );
  });

  it('discloses coordinate sharing and location recovery before copying in both languages', () => {
    const chinese = render(<ShareDialog locale="zh" onClose={vi.fn()} />);
    expect(
      screen.getByText(
        '分享链接会编码并恢复当前所选位置与观察方式；复制前请确认你愿意分享这一位置。',
      ),
    ).toBeVisible();
    chinese.unmount();

    render(<ShareDialog locale="en" onClose={vi.fn()} />);
    expect(
      screen.getByText(
        'The share link encodes and restores the selected location and observation mode. Before copying, confirm that you are willing to share this location.',
      ),
    ).toBeVisible();
  });

  it('freezes a live Sunline minute and all share state while open', async () => {
    useAppStore.setState({
      activeMode: 'sunline',
      point: { latitude: 12.34567, longitude: -45.67894 },
      sunlineTimeMs: Date.parse('2026-07-14T09:37:48Z'),
      sunlineClockMode: 'live',
    });
    render(<ShareDialog locale="en" onClose={vi.fn()} />);
    const field = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Share link',
    });
    const snapshot = field.value;
    expect(snapshot).toContain('point=12.3457%2C-45.6789');
    expect(snapshot).toContain('time=2026-07-14T09%3A37Z');
    expect(
      screen.getByText(
        'The share link encodes and restores the selected location and observation mode, and fixes the displayed UTC time. Before copying, confirm that you are willing to share this location and time.',
      ),
    ).toBeVisible();

    useAppStore.setState({
      point: { latitude: 1, longitude: 2 },
      sunlineTimeMs: Date.parse('2026-07-14T09:39:00Z'),
    });
    expect(field).toHaveValue(snapshot);
    fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(snapshot));
    expect(field).toHaveValue(snapshot);
  });

  it('restores a nondefault Reshaped Earth measure and level from the displayed share link', () => {
    useAppStore.setState({
      activeMode: 'reshaped',
      reshapedMetric: 'gdp',
      reshapedLevel: 'admin1',
      reshapedShape: 'true',
      point: { latitude: 30.12346, longitude: 120.98765 },
    });
    render(<ShareDialog locale="en" onClose={vi.fn()} />);

    const field = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Share link',
    });
    const shared = new URL(field.value);
    expect(parseUrlState(shared.search)).toMatchObject({
      activeMode: 'reshaped',
      reshapedMetric: 'gdp',
      reshapedLevel: 'admin1',
      point: {
        latitude: expect.closeTo(30.1235, 10),
        longitude: expect.closeTo(120.9877, 10),
      },
    });
    expect(shared.searchParams.has('shape')).toBe(false);
    expect(shared.searchParams.has('t')).toBe(false);
  });

  it('selects the read-only field on focus', () => {
    render(<ShareDialog locale="zh" onClose={vi.fn()} />);
    const field = screen.getByRole<HTMLInputElement>('textbox', {
      name: '分享链接',
    });

    fireEvent.focus(field);

    expect(field).toHaveAttribute('readonly');
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  it('focuses and selects the field with localized guidance when copying fails', async () => {
    writeText.mockRejectedValueOnce(new Error('clipboard unavailable'));
    render(<ShareDialog locale="zh" onClose={vi.fn()} />);
    const field = screen.getByRole<HTMLInputElement>('textbox', {
      name: '分享链接',
    });

    fireEvent.click(screen.getByRole('button', { name: '复制分享链接' }));

    expect(
      await screen.findByText('无法自动复制，请手动复制上方链接。'),
    ).toBeVisible();
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  it('closes with Escape and restores focus to the opener', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Share
          </button>
          {open ? (
            <ShareDialog locale="en" onClose={() => setOpen(false)} />
          ) : null}
        </>
      );
    }

    render(<Harness />, { container: root });
    const opener = screen.getByRole('button', { name: 'Share' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeVisible();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(opener).toHaveFocus();
  });
});

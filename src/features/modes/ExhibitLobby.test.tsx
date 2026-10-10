import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ExhibitLobby } from './ExhibitLobby';

afterEach(cleanup);

describe('ExhibitLobby', () => {
  it('offers the three primary observations as one labelled list', () => {
    render(<ExhibitLobby locale="en" onEnter={vi.fn()} />);
    const list = screen.getByRole('list', { name: 'Observation modes' });
    expect(list.querySelectorAll('li')).toHaveLength(4);
    expect(
      screen.getByRole('button', { name: /Other Side/u }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Surname Atlas/u }),
    ).toBeInTheDocument();
  });

  it('keeps the other observations one step away', () => {
    const onEnter = vi.fn();
    render(<ExhibitLobby locale="en" onEnter={onEnter} />);
    const more = screen.getByRole('list', { name: 'More' });
    expect(more.querySelectorAll('li')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sunline' }));
    expect(onEnter).toHaveBeenCalledWith('sunline');
    fireEvent.click(screen.getByRole('button', { name: /Urban Proximity/u }));
    expect(onEnter).toHaveBeenCalledWith('isolation');
  });

  it('enters a primary observation directly', () => {
    const onEnter = vi.fn();
    render(<ExhibitLobby locale="zh" onEnter={onEnter} />);
    fireEvent.click(screen.getByRole('button', { name: /姓氏观察/u }));
    expect(onEnter).toHaveBeenCalledWith('surnames');
    expect(
      screen.getByRole('heading', { name: '选择一种观察' }),
    ).toBeInTheDocument();
  });

  it('disables lobby motion for reduced-motion users', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/modes/ExhibitLobby.module.css'),
      'utf8',
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/u,
    );
  });
});

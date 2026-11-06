// @vitest-environment jsdom
import '../../test/setup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { resetThemeStoreForTests, THEME_STORAGE_KEY } from '../../lib/theme';
import { ThemeToggle } from './ThemeToggle';

const meta = () => document.querySelector('meta[name="color-scheme"]')?.getAttribute('content');

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  resetThemeStoreForTests();
});
afterEach(() => vi.restoreAllMocks());

describe('ThemeToggle', () => {
  it('is a labelled radio group defaulting to System', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('group', { name: 'Color theme' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('Light/Dark set the attribute and persist; System removes it', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(meta()).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(meta()).toBe('light dark');
  });

  it('restores a stored preference on mount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('keeps several toggles in sync', () => {
    render(
      <>
        <ThemeToggle />
        <ThemeToggle />
      </>,
    );
    fireEvent.click(screen.getAllByRole('radio', { name: 'Light' })[0]);
    expect(screen.getAllByRole('radio', { name: 'Light' }).every((r) => (r as HTMLInputElement).checked)).toBe(true);
  });

  it('degrades to System without crashing when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<ThemeToggle />);
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
  });
});

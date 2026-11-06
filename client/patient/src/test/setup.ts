/** Patient-app test setup (import first in each *.test.tsx). */
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

if (typeof window !== 'undefined') {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
}

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Replace global fetch with a router: `routes` maps "METHOD /path" to a JSON body (or a
 * function returning one). Returns the recorded calls.
 */
export function mockFetch(routes: Record<string, unknown | ((body: unknown) => unknown)>, opts: { status?: (key: string) => number } = {}) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const key = `${method} ${url}`;
    if (!(key in routes)) return new Response(JSON.stringify({ error: `No route ${key}` }), { status: 404 });
    const r = routes[key];
    const data = typeof r === 'function' ? (r as (b: unknown) => unknown)(body) : r;
    return new Response(JSON.stringify(data), { status: opts.status?.(key) ?? (method === 'POST' ? 201 : 200), headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

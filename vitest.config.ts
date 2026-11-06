import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': r('./shared') } },
  test: {
    globals: true,
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'client/src/**/*.test.{ts,tsx}', 'client/patient/**/*.test.{ts,tsx}'],
  },
});

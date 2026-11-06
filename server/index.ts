/**
 * Server entry point. Dev: `tsx watch server/index.ts` (port 8787, Vite proxies /api).
 * Production (NODE_ENV=production): also serves client/dist with an SPA fallback.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { createStore } from './data/store';

const here = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 8787;

const store = createStore();
const app = createApp(store, production ? { staticDir: path.resolve(here, '../client/dist') } : {});

app.listen(port, (err?: Error) => {
  if (err) {
    console.error(`[server] Failed to listen on port ${port}:`, err.message);
    process.exit(1);
  }
  console.log(
    `[server] SMART@Home clinician view API on http://localhost:${port}/api ` +
      `(${store.listPatients().length} synthetic patients, today=${store.today}${production ? ', serving client/dist' : ''})`,
  );
});

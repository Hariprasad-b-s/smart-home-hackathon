import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Dev-server SPA fallback for the patient app: /patient/<route> → /patient/index.html. */
function patientSpaFallback(): Plugin {
  return {
    name: 'patient-spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (/^\/patient(\/|$)/.test(path) && !path.includes('.') && req.headers.accept?.includes('text/html')) {
          req.url = '/patient/index.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: r('./client'),
  plugins: [react(), patientSpaFallback()],
  resolve: { alias: { '@shared': r('./shared') } },
  server: {
    port: 5173,
    fs: { allow: [r('.')] },
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    outDir: r('./client/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        clinician: r('./client/index.html'),
        patient: r('./client/patient/index.html'),
      },
    },
  },
});

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In production the dashboard is served by the backend (same origin), so no proxy
// is needed. For local `vite dev` against a remote backend, set VITE_PROXY_TARGET
// (e.g. https://rangerloop-api.fly.dev) and /api + /webhooks are proxied there.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_PROXY_TARGET;
  return {
    plugins: [react()],
    ...(target
      ? {
          server: {
            proxy: {
              '/api': { target, changeOrigin: true, secure: true },
            },
          },
        }
      : {}),
  };
});

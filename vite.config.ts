import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./package.json', import.meta.url)),
    'utf8',
  ),
) as { version: string }

export default defineConfig(({ mode }) => {
  // Vite does not populate process.env from .env for the config file itself;
  // loadEnv does. STUDIO_LAN=1 in .env enables LAN access.
  const env = loadEnv(mode, process.cwd(), '')
  return {
  // Electrobun's views:// protocol resolves root-absolute paths (/assets/...)
  // relative to the view directory (views/mainview/). Matches the official
  // electrobun-starter which uses the default base '/'.
  base: '/',
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    // LAN access: `--host` flag or STUDIO_LAN=1 binds 0.0.0.0 and allows
    // non-localhost Host headers (Vite 8 blocks them by default).
    ...(env.STUDIO_LAN === '1' || process.env.STUDIO_LAN === '1'
      ? { host: '0.0.0.0' as const, allowedHosts: true as const }
      : {}),
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      '/media': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  }
})

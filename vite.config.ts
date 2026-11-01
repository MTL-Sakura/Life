import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const assetsDir = path.resolve(__dirname, 'public/assets')

// The build writes into public/, which also holds the PHP API and icons, so
// only the generated assets folder is cleared before each build.
function cleanAssets(): Plugin {
  return {
    name: 'life-clean-assets',
    apply: 'build',
    buildStart() {
      fs.rmSync(assetsDir, { recursive: true, force: true })
    },
  }
}

// Added only to the production page: the dev server relies on inline scripts.
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
  return {
    name: 'life-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
    },
  }
}

export default defineConfig({
  plugins: [react(), cleanAssets(), contentSecurityPolicy()],
  publicDir: false,
  build: {
    outDir: 'public',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        // Content hashes in the file names make phones load the new version
        // after a deploy instead of a cached copy of a fixed "app.js".
        entryFileNames: 'assets/app-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
})

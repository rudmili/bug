/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Commit corto del build; Cloudflare Pages lo da en CF_PAGES_COMMIT_SHA, en local se pregunta a git
function commitId() {
  const sha = process.env.CF_PAGES_COMMIT_SHA
  if (sha) return sha.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

// Versión SemVer con el commit como metadato de build: 1.0.0+5ea9401
const commit = commitId()
const appVersion = `${version}+${commit}`

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit),
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    {
      name: 'app-version',
      transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'version', content: appVersion }, injectTo: 'head' }],
    },
  ],
  test: {
    // La lógica corre en Node; los tests de la interfaz piden jsdom con un comentario al principio del archivo
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // mock.ts es una sesión falsa para trabajar en el diseño, no se usa en la aplicación
      exclude: ['src/**/*.test.{ts,tsx}', 'src/debug/mock.ts', 'src/env.d.ts'],
    },
  },
})

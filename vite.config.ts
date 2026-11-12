import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createSpeakingMiddleware, readSpeakingAsset, speakingAssets } from './scripts/speaking-runtime.mjs'

function speaking(): Plugin {
  return {
    name: 'speaking-studio',
    configureServer(server) {
      const api = createSpeakingMiddleware({ serveSource: true })
      server.middlewares.use(api.handle)
      server.httpServer?.once('close', api.close)
    },
    configurePreviewServer(server) {
      const api = createSpeakingMiddleware()
      server.middlewares.use(api.handle)
      server.httpServer.once('close', api.close)
    },
    generateBundle() {
      for (const name of speakingAssets()) {
        this.emitFile({ type: 'asset', fileName: 'speaking/' + name, source: readSpeakingAsset(name) })
      }
    },
  }
}
export default defineConfig({
  plugins: [react(), speaking()],
  base: './',
  build: { rollupOptions: { output: { manualChunks(id) {
    if (id.includes('/node_modules/@tencent-ai/')) return 'cloud-sdk'
    if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor'
  } } } },
  server: {
    port: 5173,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.data/**', '**/*.sqlite*', '**/scripts/**', '**/modules/speaking/**', '**/modules/listening/data/**', '**/modules/campus-social/answer-bank.mjs'] },
  },
})

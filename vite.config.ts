import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // 音は全て合成・外部リソースゼロなので、precache だけで全機能がオフラインで動く。
    // ランタイムキャッシュの設定は要らない（そもそも通信しない）。
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
        // 書き出した WAV を誤ってキャッシュしないよう、音声は対象外にしておく
        globIgnores: ['**/*.wav'],
      },
      manifest: {
        name: 'Binaural Studio',
        short_name: 'Binaural',
        description: '集中と瞑想のためのバイノーラルビート。音は端末内で合成され、通信しません。',
        lang: 'ja',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0e14',
        theme_color: '#0b0e14',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { port: 5273 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});

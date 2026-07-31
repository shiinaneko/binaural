import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * GitHub Pages は https://<user>.github.io/<repo>/ で配信されるため、
 * ビルド成果物はこのサブパスを前提にする必要がある。
 * 開発サーバはルートのままにしておく（ローカルの手触りを変えない）。
 */
const REPO_BASE = '/binaural/';

export default defineConfig(({ command, isPreview }) => {
  // preview も command は 'serve' なので、isPreview を見ないとビルド成果物と
  // 配信パスが食い違い、本番相当の確認ができない
  const base = command === 'build' || isPreview ? REPO_BASE : '/';

  return {
    base,
    define: {
      // 実機で「いま何が動いているか」を確認できるようにする
      __BUILD_ID__: JSON.stringify(
        new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      ),
    },
    plugins: [
      react(),
      // 音は全て合成・外部リソースゼロなので、precache だけで全機能がオフラインで動く。
      // ランタイムキャッシュの設定は要らない（そもそも通信しない）。
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
          // 書き出した WAV を誤ってキャッシュしないよう、音声は対象外にしておく
          globIgnores: ['**/*.wav'],
        },
        manifest: {
          name: 'Binaural Studio',
          short_name: 'Binaural',
          description:
            '集中と瞑想のためのバイノーラルビート。音は端末内で合成され、通信しません。',
          lang: 'ja',
          // サブパス配信でもインストール後の起動先が正しくなるよう base に合わせる
          start_url: base,
          scope: base,
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
  };
});

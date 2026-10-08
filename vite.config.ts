import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const voiceTestRoot = resolve('public', 'voice-models');

const voiceTestAssetsPlugin: Plugin = {
  name: 'voice-test-assets',
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const requestPath = decodeURIComponent(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      );
      if (!requestPath.startsWith('/voice-models/')) {
        next();
        return;
      }
      const filePath = resolve(
        voiceTestRoot,
        requestPath.slice('/voice-models/'.length).replaceAll('/', sep),
      );
      if (!filePath.startsWith(`${voiceTestRoot}${sep}`)) {
        response.statusCode = 403;
        response.end();
        return;
      }
      try {
        const size = statSync(filePath).size;
        const contentTypes: Record<string, string> = {
          '.js': 'text/javascript',
          '.json': 'application/json',
          '.mjs': 'text/javascript',
          '.wasm': 'application/wasm',
        };
        response.setHeader(
          'Content-Type',
          contentTypes[extname(filePath).toLowerCase()] ??
            'application/octet-stream',
        );
        response.setHeader('Content-Length', size);
        createReadStream(filePath).pipe(response);
      } catch {
        response.statusCode = 404;
        response.end();
      }
    });
  },
};

export default defineConfig({
  publicDir: 'public-app',
  resolve: {
    alias: {
      kuromoji: resolve('node_modules', 'kuromoji', 'build', 'kuromoji.js'),
    },
  },
  plugins: [
    ...(process.env.RUN_LOCAL_VOICE_E2E === '1'
      ? [voiceTestAssetsPlugin]
      : []),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/icon-maskable.svg'],
      manifest: {
        name: 'Vocabulary Trainer',
        short_name: 'Vocabulary',
        description: 'Build vocabulary through meaning, sound and speed.',
        theme_color: '#f8fafc',
        background_color: '#f8fafc',
        display: 'standalone',
        lang: 'en',
        categories: ['education'],
        id: '/',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,webp,svg,woff2,bin}'],
        maximumFileSizeToCacheInBytes: 7 * 1024 * 1024,
      },
    }),
  ],
});

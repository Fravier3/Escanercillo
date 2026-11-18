import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const staticFiles = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable.png', 'icons/apple-touch-icon.png'];
const fonts = ['standard_fonts', 'cmaps', 'wasm', 'iccs'];

function pdfAssets(destination) {
  mkdirSync(destination, { recursive: true });
  for (const directory of fonts) {
    cpSync(new URL('./node_modules/pdfjs-dist/' + directory, import.meta.url), new URL(directory, destination), { recursive: true });
  }
  cpSync(new URL('./node_modules/pdfjs-dist/LICENSE', import.meta.url), new URL('LICENSE-PDF.js', destination));
  cpSync(new URL('./node_modules/pdf-lib/LICENSE.md', import.meta.url), new URL('LICENSE-pdf-lib.md', destination));
}

function localApp() {
  return {
    name: 'archivo-pdf',
    configureServer() {
      pdfAssets(new URL('./public/pdf-assets/', import.meta.url));
    },
    generateBundle(_options, bundle) {
      const paths = [...new Set(['index.html', ...Object.keys(bundle), ...staticFiles])];
      const worker = readFileSync(new URL('./src/service-worker.js', import.meta.url), 'utf8');
      const hash = createHash('sha256').update(paths.join('|')).update(worker);
      hash.update(readFileSync(new URL('./index.html', import.meta.url)));
      for (const path of staticFiles) hash.update(readFileSync(new URL('./public/' + path, import.meta.url)));
      this.emitFile({
        type: 'asset', fileName: 'sw.js',
        source: 'const version=' + JSON.stringify(hash.digest('hex').slice(0, 12)) +
          ';\nconst paths=' + JSON.stringify(paths) + ';\n' + worker,
      });
    },
    closeBundle() {
      pdfAssets(new URL('./dist/pdf-assets/', import.meta.url));
    },
  };
}

export default defineConfig({
  base: './',
  build: { target: ['safari16.4', 'chrome109', 'firefox115'], sourcemap: false },
  plugins: [localApp()],
});

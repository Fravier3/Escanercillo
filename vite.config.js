import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const runtimeFiles = new Map([
  ['vision-worker.js', readFileSync(new URL('./src/vision-worker.js', import.meta.url))],
  ['opencv.js', readFileSync(new URL('./node_modules/@techstark/opencv-js/dist/opencv.js', import.meta.url))],
  ['jscanify.js', readFileSync(new URL('./vendor/jscanify.cjs', import.meta.url))],
  ['jscanify.LICENSE', readFileSync(new URL('./vendor/jscanify.LICENSE', import.meta.url))],
  ['AndroidDocumentFilter.LICENSE', readFileSync(new URL('./vendor/AndroidDocumentFilter.LICENSE', import.meta.url))],
  ['react-perspective-cropper.LICENSE', readFileSync(new URL('./vendor/react-perspective-cropper.LICENSE', import.meta.url))],
  ['THIRD-PARTY-NOTICES.txt', readFileSync(new URL('./vendor/THIRD-PARTY-NOTICES.txt', import.meta.url))],
  ['pdf-lib.LICENSE', readFileSync(new URL('./node_modules/pdf-lib/LICENSE.md', import.meta.url))],
  ['opencv.LICENSE', readFileSync(new URL('./node_modules/@techstark/opencv-js/LICENSE', import.meta.url))],
]);
const signature = createHash('sha256');
for (const data of runtimeFiles.values()) signature.update(data);
const folder = 'engine-' + signature.digest('hex').slice(0, 12);
const staticFiles = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable.png', 'icons/apple-touch-icon.png'];

function localScanner() {
  return {
    name: 'local-scanner',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url, 'http://localhost').pathname;
        const prefix = '/' + folder + '/';
        const file = path.startsWith(prefix) && runtimeFiles.get(path.slice(prefix.length));
        if (!file) return next();
        response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/plain');
        response.end(file);
      });
    },
    generateBundle(_options, bundle) {
      for (const [name, source] of runtimeFiles) {
        this.emitFile({ type: 'asset', fileName: folder + '/' + name, source });
      }
      const paths = [...new Set(['index.html', ...Object.keys(bundle), ...staticFiles, ...Array.from(runtimeFiles.keys(), name => folder + '/' + name)])];
      const version = createHash('sha256').update(paths.join('|')).digest('hex').slice(0, 12);
      const worker = readFileSync(new URL('./src/service-worker.js', import.meta.url), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: 'const version=' + JSON.stringify(version) + ';\nconst paths=' + JSON.stringify(paths) + ';\n' + worker,
      });
    },
  };
}

export default defineConfig({
  base: './',
  define: { __VISION_FOLDER__: JSON.stringify(folder) },
  build: { target: ['safari16', 'chrome109', 'firefox115'], sourcemap: false },
  plugins: [localScanner()],
});

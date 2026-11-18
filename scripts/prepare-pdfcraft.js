import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const lock = JSON.parse(readFileSync(new URL('../pdfcraft.lock.json', import.meta.url)));
const dest = new URL('../public/pdfcraft/' + lock.version + '/', import.meta.url);
const stamp = new URL('.asset-checksum', dest);
if (existsSync(stamp) && readFileSync(stamp, 'utf8') === lock.sha256 && existsSync(new URL(lock.wasm, dest))) process.exit(0);

const temp = mkdtempSync(join(tmpdir(), 'archivo-pdfcraft-'));
try {
  const zip = process.env.PDFCRAFT_ARCHIVE || join(temp, 'pdfcraft.zip');
  if (!process.env.PDFCRAFT_ARCHIVE) {
    execFileSync('curl', ['-fsSL', '--retry', '3', '--max-time', '120', lock.url, '-o', zip], { stdio: 'inherit' });
  }
  const digest = createHash('sha256').update(readFileSync(zip)).digest('hex');
  if (digest !== lock.sha256) throw new Error('La descarga no coincide con el checksum de Arsenal.');
  const files = [lock.entry, lock.wasm, 'snippets/eframe-d31a8450ea12dfc1/inline0.js', 'LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE'];
  for (const file of files) {
    const path = new URL(file, dest);
    mkdirSync(new URL(dirname(file) + '/', dest), { recursive: true });
    const contents = execFileSync('unzip', ['-p', zip, 'pdfcraft-web-' + lock.version + '/' + file], { maxBuffer: 80 * 1024 ** 2 });
    writeFileSync(path, contents);
  }
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PdfCraft</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f1f1f3}canvas{display:block;width:100%;height:100%;outline:0;touch-action:none}</style></head>
<body><canvas id="pdfcraft"></canvas>
<script type="module">
try {
  const bindings = await import('./${lock.entry}');
  const wasm = await bindings.default({ module_or_path: './${lock.wasm}' });
  window.wasmBindings = bindings;
  dispatchEvent(new CustomEvent('TrunkApplicationStarted', { detail: { wasm } }));
} catch (error) {
  parent.postMessage({type:'pdfcraft:failed',error:String(error)}, location.origin);
}
</script></body></html>`;
  writeFileSync(new URL('index.html', dest), html);
  writeFileSync(stamp, digest);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const origin = 'http://127.0.0.1:4197';
let server, browser;

before(async () => {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4197', '--strictPort'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    executablePath: process.env.SCANNER_CHROMIUM || undefined,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
});
after(async () => {
  await browser?.close();
  server?.kill();
});

function makeDocument(fill) {
  const canvas = document.createElement('canvas');
  canvas.width = 860;
  canvas.height = 1040;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#304155';
  ctx.fillRect(0, 0, 860, 1040);
  ctx.beginPath();
  ctx.moveTo(155, 115);
  ctx.lineTo(758, 204);
  ctx.lineTo(678, 924);
  ctx.lineTo(122, 829);
  ctx.closePath();
  ctx.clip();
  const light = ctx.createLinearGradient(140, 0, 775, 0);
  light.addColorStop(0, '#a5a9ae');
  light.addColorStop(1, '#fbf7eb');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, 860, 1040);
  ctx.fillStyle = fill;
  ctx.font = '45px serif';
  ctx.fillText('Escanercillo', 240, 328);
  for (let i = 0; i < 11; i += 1) ctx.fillRect(224, 380 + i * 32, 370 - (i % 4) * 30, 5);
  return canvas.toDataURL('image/jpeg', .97).split(',')[1];
}

test('móvil: bordes automáticos, filtros, PDF multipágina y escaneo sin conexión', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith(origin) && !request.url().startsWith('blob:')) external.push(request.url());
  });
  await page.goto(origin);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-top', '47px');
    document.documentElement.style.setProperty('--safe-bottom', '34px');
  });
  assert.ok(await page.locator('.brand').evaluate(node => node.getBoundingClientRect().top >= 47));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  const [a, b] = await Promise.all([page.evaluate(makeDocument, '#101822'), page.evaluate(makeDocument, '#482721')]);
  const file = (name, content) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from(content, 'base64') });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Escanear ahora' }).click()]);
  await chooser.setFiles(file('primera.jpg', a));
  await page.waitForFunction(() => document.querySelector('#page-count').textContent === '1', null, { timeout: 45000 });
  assert.equal(await page.locator('#status').isHidden(), true, await page.locator('#status').textContent());
  await page.getByRole('button', { name: 'Ajustar bordes' }).click();
  const corner = await page.getByRole('button', { name: 'Esquina superior izquierda' }).evaluate(node =>
    [parseFloat(node.style.left), parseFloat(node.style.top)]);
  assert.ok(Math.abs(corner[0] - 18) < 4 && Math.abs(corner[1] - 11) < 4, JSON.stringify(corner));
  await page.getByRole('button', { name: 'Esquina superior izquierda' }).press('ArrowRight');
  await page.getByRole('button', { name: 'Aplicar recorte' }).click();
  await page.getByRole('button', { name: 'Papel blanco' }).click();
  await page.getByRole('button', { name: 'Añadir páginas' }).click();
  const [picker] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('dialog').getByRole('button', { name: 'Importar fotos' }).click()]);
  await picker.setFiles(file('segunda.jpg', b));
  await page.waitForFunction(() => document.querySelector('#page-count').textContent === '2');
  await page.getByRole('button', { name: 'Girar' }).click();
  await page.getByRole('button', { name: 'Mover antes' }).click();
  await page.getByRole('button', { name: 'Guardar PDF' }).click();
  const downloadLink = page.getByRole('link', { name: 'Descargar PDF' });
  await downloadLink.waitFor({ timeout: 45000 });
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  const pdf = await PDFDocument.load(await readFile(await download.path()));
  assert.equal(pdf.getPageCount(), 2);
  assert.ok(pdf.getPage(0).getWidth() > pdf.getPage(0).getHeight());
  assert.ok(pdf.getPage(1).getWidth() < pdf.getPage(1).getHeight());

  await page.getByRole('button', { name: 'Quitar' }).click();
  assert.equal(await page.locator('#page-count').textContent(), '1');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await page.locator('#photo-input').setInputFiles(file('sin-conexion.jpg', a));
  await page.waitForFunction(() => document.querySelector('#page-count').textContent === '1');
  await page.getByRole('button', { name: 'Guardar PDF' }).click();
  await page.getByRole('link', { name: 'Descargar PDF' }).waitFor();
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('escritorio: captura web local y cierre del flujo de cámara', async () => {
  const page = await browser.newPage({ permissions: ['camera'] });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Escanear ahora' }).click();
  const shutter = page.getByRole('button', { name: 'Capturar', exact: true });
  await shutter.waitFor();
  await page.waitForFunction(() => !document.querySelector('#capture').disabled);
  await shutter.click();
  await page.waitForFunction(() => document.querySelector('#page-count').textContent === '1');
  assert.equal(await page.locator('video').evaluate(video => video.srcObject), null);
  await page.close();
});

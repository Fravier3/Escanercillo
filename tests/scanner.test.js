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
  await page.getByRole('button', { name: 'Color original' }).click();
  await page.waitForFunction(() => {
    const img = document.querySelector('#preview img');
    return img?.naturalWidth > 0 && img.naturalWidth < 700;
  });
  const backgroundPixels = await page.locator('#preview img').evaluate(async image => {
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let background = 0;
    for (let n = 0; n <= 40; n += 1) {
      const x = Math.round(n * (width - 1) / 40), y = Math.round(n * (height - 1) / 40);
      for (const i of [x, (height - 1) * width + x, y * width, y * width + width - 1]) {
        if (data[i * 4 + 2] - data[i * 4] > 22 && data[i * 4] < 100) background += 1;
      }
    }
    return background;
  });
  assert.equal(backgroundPixels, 0);
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

test('fondo claro, papel en perspectiva y sombra lateral', async () => {
  const page = await browser.newPage();
  await page.goto(origin);
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1100;
    canvas.height = 1300;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e5dfd7';
    ctx.fillRect(0, 0, 1100, 1300);
    const corners = [[163, 147], [970, 275], [830, 1139], [242, 1085]];
    function outline(x, y) {
      ctx.beginPath();
      corners.forEach(([px, py], i) => i ? ctx.lineTo(px + x, py + y) : ctx.moveTo(px + x, py + y));
      ctx.closePath();
    }
    ctx.save();
    ctx.filter = 'blur(10px)';
    outline(-10, 18);
    ctx.fillStyle = '#9e958a';
    ctx.fill();
    ctx.restore();
    outline(0, 0);
    ctx.clip();
    const light = ctx.createLinearGradient(240, 0, 780, 0);
    light.addColorStop(0, '#877f77');
    light.addColorStop(.37, '#9e9994');
    light.addColorStop(.67, '#eee7e1');
    light.addColorStop(1, '#fffaf4');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, 1100, 1300);
    ctx.fillStyle = '#231d1c';
    for (let i = 0; i < 17; i += 1) ctx.fillRect(290, 366 + 30 * i, 410 - 35 * (i % 5), 5);
    ctx.fillStyle = '#b91832';
    ctx.fillRect(606, 949, 67, 49);
    return { corners, base64: canvas.toDataURL('image/jpeg', .96).split(',')[1] };
  });
  await page.locator('#photo-input').setInputFiles({ name: 'sombra.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(fixture.base64, 'base64') });
  await page.getByRole('heading', { name: 'Revisar escaneo' }).waitFor();
  await page.getByRole('button', { name: 'Ajustar bordes' }).click();
  const actual = await page.locator('.handle').evaluateAll(nodes =>
    nodes.map(node => [parseFloat(node.style.left) * 11, parseFloat(node.style.top) * 13]));
  for (const [i, [x, y]] of actual.entries()) {
    assert.ok(Math.hypot(x - fixture.corners[i][0], y - fixture.corners[i][1]) < 12, JSON.stringify(actual));
  }
  await page.getByRole('button', { name: 'Aplicar recorte' }).click();
  const measure = () => page.locator('#preview img').evaluate(async image => {
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const w = canvas.width, h = canvas.height;
    const pixel = (x, y) => Array.from(ctx.getImageData(Math.round(w * x), Math.round(h * y), 1, 1).data);
    const pixels = ctx.getImageData(0, 0, w, h).data;
    let redInk = 0, darkInk = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i], green = pixels[i + 1], blue = pixels[i + 2];
      if (red - green > 80 && red - blue > 60) redInk += 1;
      if (red < 55 && green < 55 && blue < 55) darkInk += 1;
    }
    return { paper: [pixel(.23, .07)[0], pixel(.79, .07)[0]], redInk, darkInk };
  });
  await page.waitForFunction(() => document.querySelector('#preview img')?.naturalHeight > 0 &&
    document.querySelector('#preview img').naturalWidth < 800);
  const cleaned = await measure();
  await page.getByRole('button', { name: 'Color original' }).click();
  await page.waitForFunction(() => document.querySelector('#preview img')?.naturalWidth > 0 &&
    document.querySelector('#preview img').naturalWidth < 800);
  const original = await measure();
  assert.ok(cleaned.paper[0] > original.paper[0] + 40, JSON.stringify({ original, cleaned }));
  assert.ok(Math.abs(cleaned.paper[1] - cleaned.paper[0]) < 35, JSON.stringify(cleaned));
  assert.ok(cleaned.redInk > 500 && cleaned.redInk >= .8 * original.redInk, JSON.stringify({ original, cleaned }));
  assert.ok(cleaned.darkInk >= .68 * original.darkInk, JSON.stringify({ original, cleaned }));
  await page.close();
});

test('una foto sin bordes claros requiere confirmar el recorte para exportar', async () => {
  const page = await browser.newPage();
  await page.goto(origin);
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 320;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#eee';
    ctx.fillRect(0, 0, 320, 320);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  await page.locator('#photo-input').setInputFiles({ name: 'sin-bordes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(fixture, 'base64') });
  await page.getByRole('heading', { name: 'Revisar escaneo' }).waitFor();
  await page.getByRole('button', { name: 'Guardar PDF' }).click();
  await page.getByRole('dialog', { name: 'Ajustar bordes' }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Descargar PDF' }).count(), 0);
  await page.getByRole('button', { name: 'Imagen completa' }).click();
  await page.getByRole('button', { name: 'Aplicar recorte' }).click();
  await page.getByRole('button', { name: 'Guardar PDF' }).click();
  await page.getByRole('link', { name: 'Descargar PDF' }).waitFor();
  await page.close();
});

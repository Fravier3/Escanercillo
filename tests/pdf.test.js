import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PDFDocument, PDFName } from 'pdf-lib';

const origin = 'http://127.0.0.1:4197';
const base = '/Escanercillo/';
const home = origin + base;
let browser, server;
before(async () => {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4197', '--strictPort', '--base', base], { stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) {
    try {
      if ((await fetch(home)).ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    executablePath: process.env.PDF_CHROMIUM || undefined,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
});
after(async () => {
  await browser?.close();
  server?.kill();
});

async function fixture(name = 'prueba.pdf', sizes = [[300, 460], [380, 510]]) {
  const doc = await PDFDocument.create();
  for (const size of sizes) {
    const page = doc.addPage(size);
    page.drawText('Archivo PDF', { x: 20, y: 60 });
  }
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}
async function loadFile(page, files, buttonName) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: buttonName, exact: true }).click()]);
  await chooser.setFiles(files);
}
async function downloadPdf(page, locator) {
  const [download] = await Promise.all([page.waitForEvent('download'), locator.click()]);
  return PDFDocument.load(await readFile(await download.path()));
}

test('iPhone simulado: abrir, combinar, organizar, anotar, extraer y guardar sin conexión', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [], outbound = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith(origin) && !request.url().startsWith('blob:')) outbound.push(request.url());
  });
  await page.goto(home);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--top', '48px');
    document.documentElement.style.setProperty('--bottom', '34px');
  });
  assert.ok(await page.locator('.brand').evaluate(node => node.getBoundingClientRect().top >= 48));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  const testFile = await fixture();
  await loadFile(page, testFile, 'Abrir PDF');
  await page.getByText('2 páginas', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Organizar páginas' }).click();
  await page.getByRole('button', { name: 'Mover después' }).click();
  await page.getByRole('button', { name: 'Girar 90°' }).click();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  let pdf = await downloadPdf(page, page.getByRole('button', { name: 'Guardar PDF' }));
  assert.equal(pdf.getPage(0).getWidth(), 380);
  assert.equal(pdf.getPage(1).getRotation().angle, 90);

  await loadFile(page, await fixture('tercero.pdf', [[240, 320]]), 'Combinar PDF');
  await page.getByText('3 páginas', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Añadir texto' }).click();
  await page.getByRole('textbox', { name: 'Texto nuevo' }).fill('Revisión');
  await page.getByRole('button', { name: 'Colocar texto' }).click();
  await page.getByRole('button', { name: 'Colocar en el centro de la página' }).press('Enter');
  const marked = await downloadPdf(page, page.getByRole('button', { name: 'Guardar PDF' }));
  assert.ok(marked.getPage(2).node.Contents().size() > 1);
  await page.getByRole('button', { name: 'Extraer páginas' }).click();
  await page.getByRole('textbox', { name: 'Páginas del nuevo PDF' }).fill('2-3');
  await page.getByRole('button', { name: 'Crear PDF separado' }).click();
  pdf = await downloadPdf(page, page.getByRole('link', { name: /Descargar.*extraido/ }));
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.getPage(1).getWidth(), 240);

  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await loadFile(page, testFile, 'Abrir PDF');
  await page.getByText('2 páginas', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('#document-canvas').width > 300);
  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  await context.close();
});

test('firmar y convertir una foto a PDF', async () => {
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto(home);
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 800);
    ctx.fillStyle = '#211a33'; ctx.fillText('Documento', 20, 50);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await loadFile(page, { name: 'documento.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }, 'Fotos a PDF');
  await page.getByText('1 página', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Firmar', exact: true }).click();
  const rect = await page.locator('#signature-pad').boundingBox();
  await page.mouse.move(rect.x + 20, rect.y + 42);
  await page.mouse.down();
  await page.mouse.move(rect.x + 100, rect.y + 67, { steps: 6 });
  await page.mouse.move(rect.x + 160, rect.y + 24, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Colocar firma' }).click();
  await page.getByRole('button', { name: 'Colocar en el centro de la página' }).press('Enter');
  const pdf = await downloadPdf(page, page.getByRole('button', { name: 'Guardar PDF' }));
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getPage(0).node.Resources().lookup(PDFName.of('XObject')).keys().length, 2);
  await page.getByRole('button', { name: 'Comprimir' }).click();
  await page.getByRole('button', { name: 'Crear copia ligera' }).click();
  const compressed = await downloadPdf(page, page.getByRole('link', { name: /Descargar.*ligero/ }));
  assert.equal(compressed.getPageCount(), 1);
  await page.close();
});

test('inicia el motor web de PdfCraft desde el editor avanzado', async () => {
  const page = await browser.newPage({ viewport: { width: 414, height: 820 } });
  await page.addInitScript(() => {
    window.addEventListener('message', event => {
      if (event.data?.type === 'pdfcraft:open') window.pdfCraftBytes = event.data.bytes.byteLength;
    });
  });
  await page.goto(home + '?cpu');
  const input = await fixture('Archivo-para-PdfCraft.pdf');
  await loadFile(page, input, 'Abrir PDF');
  await page.getByText('2 páginas', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edición avanzada' }).click();
  await page.waitForFunction(() => document.querySelector('#advanced-status').hidden, null, { timeout: 40000 });
  const core = page.frameLocator('#craft-frame').locator('#pdfcraft');
  assert.ok(await core.evaluate(canvas => canvas.width > 200 && canvas.height > 300));
  await core.evaluate((_, expected) => {
    if (window.pdfCraftBytes !== expected) throw new Error('Archivo no entregado al motor');
  }, input.buffer.length);
  await page.getByRole('button', { name: 'Volver a Archivo PDF' }).click();
  await page.getByRole('heading', { name: 'Archivo-para-PdfCraft.pdf' }).waitFor();
  await page.close();
});

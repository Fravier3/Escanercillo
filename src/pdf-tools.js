import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

let renderer;
export const mime = 'application/pdf';

async function pdfjs() {
  renderer ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([module, worker]) => {
    module.GlobalWorkerOptions.workerSrc = worker.default;
    return module;
  });
  return renderer;
}

export async function viewDocument(bytes) {
  const pdf = await pdfjs();
  const root = new URL('./pdf-assets/', document.baseURI);
  return pdf.getDocument({
    data: bytes.slice(), isEvalSupported: false, enableXfa: false,
    cMapUrl: new URL('cmaps/', root).href, cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', root).href,
    wasmUrl: new URL('wasm/', root).href,
  }).promise;
}

export function loadDocument(bytes) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

export async function render(doc, number, canvas, width, maxSide = 2048) {
  const page = await doc.getPage(number);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(width / base.width, maxSide / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  await page.render({ canvas, viewport }).promise;
  return viewport;
}

export async function copyPages(destination, source, indices) {
  const copied = await destination.copyPages(source, indices);
  copied.forEach(page => destination.addPage(page));
}

export function pageRange(value, count) {
  const selection = [];
  for (const term of value.split(',')) {
    const match = term.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('Usa números o rangos, por ejemplo 1, 3-5.');
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    if (first < 1 || last < first || last > count) throw new Error('El rango tiene que estar entre 1 y ' + count + '.');
    for (let i = first; i <= last; i += 1) if (!selection.includes(i - 1)) selection.push(i - 1);
  }
  return selection;
}

export async function addMark(doc, index, item, vx, vy) {
  const page = doc.getPage(index);
  const box = page.getCropBox();
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const rotated = angle === 90 || angle === 270;
  const visibleWidth = rotated ? box.height : box.width;
  let image, font, size, width;
  if (item.type === 'signature') {
    image = await doc.embedPng(item.bytes);
    width = Math.min(150, visibleWidth * .31);
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica);
    const p = font.widthOfTextAtSize(item.value, 1);
    size = Math.min(17, (visibleWidth - 8) / Math.max(1, p));
    width = p * size;
  }
  const shownHeight = rotated ? box.width : box.height;
  const itemHeight = image ? image.height * width / image.width : size;
  const x = Math.max(0, Math.min(vx, 1 - width / visibleWidth));
  const y = Math.min(.98, Math.max(vy, itemHeight / shownHeight));
  const xy = {
    0: [x, 1 - y], 90: [y, x], 180: [1 - x, y], 270: [1 - y, 1 - x],
  }[angle] ?? [x, 1 - y];
  const position = { x: box.x + xy[0] * box.width, y: box.y + xy[1] * box.height, rotate: degrees(angle) };
  if (image) page.drawImage(image, { ...position, width, height: itemHeight });
  else page.drawText(item.value, { ...position, font, size, color: rgb(.14, .08, .25) });
}

function encode(canvas, quality = .84) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob.arrayBuffer());
    else reject(new Error('No se pudo guardar la imagen.'));
  }, 'image/jpeg', quality));
}

export async function imagePdf(files, advance) {
  const pdf = await PDFDocument.create();
  for (const [index, file] of files.entries()) {
    advance(index + 1, files.length);
    const url = URL.createObjectURL(file);
    const image = new Image();
    const canvas = document.createElement('canvas');
    try {
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const jpeg = await pdf.embedJpg(await encode(canvas, .91));
      const layout = 810 / Math.max(jpeg.width, jpeg.height);
      const width = jpeg.width * layout, height = jpeg.height * layout;
      pdf.addPage([width, height]).drawImage(jpeg, { x: 0, y: 0, width, height });
    } finally {
      URL.revokeObjectURL(url);
      canvas.width = canvas.height = 1;
    }
  }
  return pdf;
}

export async function compressedPdf(bytes, advance) {
  const original = await viewDocument(bytes);
  const pdf = await PDFDocument.create();
  const canvas = document.createElement('canvas');
  try {
    for (let n = 1; n <= original.numPages; n += 1) {
      advance(n, original.numPages);
      const page = await original.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      await render(original, n, canvas, 1050, 1350);
      const jpeg = await pdf.embedJpg(await encode(canvas, .65));
      pdf.addPage([width, height]).drawImage(jpeg, { x: 0, y: 0, width, height });
      page.cleanup();
    }
  } finally {
    canvas.width = canvas.height = 1;
    await original.destroy();
  }
  return pdf.save();
}

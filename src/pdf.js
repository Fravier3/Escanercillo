import { renderPage } from './imaging.js';

export async function createPdf(pages, progress) {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle('Documento escaneado');
  pdf.setCreator('Escanercillo');
  for (const [index, page] of pages.entries()) {
    progress(index + 1, pages.length);
    const jpeg = await renderPage(page, 3100, .94);
    const image = await pdf.embedJpg(await jpeg.arrayBuffer());
    const scale = 841.89 / Math.max(image.width, image.height);
    const width = image.width * scale, height = image.height * scale;
    pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

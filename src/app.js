import './styles.css';
import { PDFDocument, degrees } from 'pdf-lib';
import { addMark, compressedPdf, copyPages, imagePdf, loadDocument, mime, pageRange, render, viewDocument } from './pdf-tools.js';
import { signaturePad } from './signature.js';
import { setupCraft } from './craft.js';
import { manageUpdates } from './pwa.js';

const $ = id => document.getElementById(id);
const pdfInput = $('pdf-input'), imageInput = $('image-input'), canvas = $('document-canvas');
const originalName = 'Documento.pdf';
const toolbar = ['advanced','new','pages','append','sign','text','extract','compress','save','share','rotate','remove','move-left','move-right','prev-page','next-page'];
const pad = signaturePad($('signature-pad'));
let documentModel, bytes, viewing, fileName = originalName, position = 0;
let waiting = false, pendingMark, appendMode = false, changed = false, revision = 0, secondaryDownload, pendingUpdate;
const history = [];

function announce(message = '', error = false) {
  const node = $('status');
  node.textContent = message;
  node.dataset.error = String(error);
  node.hidden = !message;
}

function updateControls() {
  toolbar.forEach(id => { $(id).disabled = waiting; });
  ['open', 'from-images'].forEach(id => { $(id).disabled = waiting; });
  if (!documentModel) return;
  const count = documentModel.getPageCount();
  $('prev-page').disabled = $('move-left').disabled = waiting || position === 0;
  $('next-page').disabled = $('move-right').disabled = waiting || position >= count - 1;
  $('remove').disabled = waiting || count <= 1;
  $('undo').disabled = waiting || !history.length;
  $('file-name').textContent = fileName;
  $('file-count').textContent = count + (count === 1 ? ' página' : ' páginas');
  $('page-number').textContent = (position + 1) + ' / ' + count;
  if ($('pages-dialog').open) showPageList();
}

async function operation(task) {
  if (waiting) return;
  waiting = true;
  updateControls();
  try {
    await task();
  } catch (error) {
    const readable = error?.name === 'EncryptedPDFError' || error?.name === 'PasswordException';
    announce(readable ? 'Este PDF está protegido. Intenta abrirlo en Edición avanzada con su contraseña.' : (error.message || 'No se pudo procesar el documento.'), true);
  } finally {
    waiting = false;
    updateControls();
    if (!documentModel) pendingUpdate?.();
  }
}

let painting = Promise.resolve();
function paint() {
  const token = ++revision;
  const engine = viewing, pageNumber = position + 1;
  if (!engine) return Promise.resolve();
  painting = painting.catch(() => {}).then(async () => {
    if (token !== revision) return;
    const targetWidth = Math.max(140, $('canvas-area').clientWidth - 22);
    const scratch = document.createElement('canvas');
    try {
      await render(engine, pageNumber, scratch, Math.min(targetWidth * (devicePixelRatio || 1), 1800));
      if (token !== revision) return;
      canvas.width = scratch.width;
      canvas.height = scratch.height;
      canvas.style.width = Math.min(targetWidth, scratch.width / Math.min(2, devicePixelRatio || 1)) + 'px';
      canvas.getContext('2d', { alpha: false }).drawImage(scratch, 0, 0);
    } finally {
      scratch.width = scratch.height = 1;
    }
  });
  return painting;
}

async function setDocument(model, name, modelBytes, { edited = false, page = 0, remember = false } = {}) {
  if (!model.getPageCount()) throw new Error('El documento no contiene páginas.');
  const nextViewer = await viewDocument(modelBytes);
  const priorViewer = viewing;
  if (remember && bytes && bytes.length < 22 * 1024 ** 2) {
    history.push({ bytes, page: position });
    if (history.length > 4) history.shift();
  }
  documentModel = model;
  bytes = modelBytes;
  viewing = nextViewer;
  position = Math.min(page, model.getPageCount() - 1);
  fileName = name;
  changed = edited;
  $('welcome').hidden = true;
  $('editor').hidden = false;
  $('share').hidden = !navigator.canShare?.({ files: [new File(['%PDF'], 'archivo.pdf', { type: mime })] });
  setPlacement();
  updateControls();
  try {
    await paint();
  } finally {
    await priorViewer?.destroy();
  }
}

function showPageList() {
  const count = documentModel.getPageCount();
  const list = $('page-list');
  list.replaceChildren(...Array.from({ length: count }, (_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Página ' + (index + 1);
    if (index === position) button.setAttribute('aria-current', 'true');
    button.disabled = waiting;
    button.onclick = () => {
      goTo(index);
      list.children[index].focus();
    };
    return button;
  }));
}

function goTo(index) {
  if (waiting || index < 0 || index >= documentModel.getPageCount()) return;
  position = index;
  updateControls();
  paint().catch(error => announce(error.message, true));
}
$('prev-page').onclick = () => goTo(position - 1);
$('next-page').onclick = () => goTo(position + 1);

function mutate(change, nextPage = position) {
  return operation(async () => {
    const next = await loadDocument(bytes);
    await change(next);
    await setDocument(next, fileName, await next.save(), { edited: true, page: nextPage, remember: true });
  });
}

function choosePDF(append) {
  if (!append && changed && !confirm('¿Quieres abrir otro documento? Guarda primero los cambios que quieras conservar.')) return;
  appendMode = append;
  pdfInput.click();
}

for (const id of ['open', 'new']) $(id).onclick = () => choosePDF(false);
$('append').onclick = () => choosePDF(true);
$('from-images').onclick = () => imageInput.click();
pdfInput.onchange = () => {
  const files = Array.from(pdfInput.files);
  pdfInput.value = '';
  if (!files.length) return;
  void operation(async () => {
    announce('Abriendo PDF…');
    const documents = [];
    for (const file of files) {
      if (file.size > 80 * 1024 ** 2) throw new Error('Usa un PDF de hasta 80 MB en las herramientas táctiles.');
      const input = new Uint8Array(await file.arrayBuffer());
      const model = await loadDocument(input);
      documents.push({ input, model });
    }
    if (!appendMode && documents.length === 1) {
      await setDocument(documents[0].model, files[0].name, documents[0].input);
      history.length = 0;
    } else {
      const output = appendMode ? await loadDocument(bytes) : await PDFDocument.create();
      const addedAt = output.getPageCount();
      for (const { model } of documents) await copyPages(output, model, model.getPageIndices());
      await setDocument(output, appendMode ? fileName : 'Documentos-combinados.pdf', await output.save(), { edited: true, page: addedAt, remember: appendMode });
      if (!appendMode) history.length = 0;
    }
    announce();
  });
};

imageInput.onchange = () => {
  const files = Array.from(imageInput.files);
  imageInput.value = '';
  if (!files.length) return;
  void operation(async () => {
    const output = await imagePdf(files, (n, total) => announce('Convirtiendo foto ' + n + ' de ' + total + '…'));
    await setDocument(output, 'Fotos.pdf', await output.save(), { edited: true });
    history.length = 0;
    announce();
  });
};

$('pages').onclick = () => {
  $('pages-dialog').showModal();
  showPageList();
};
function move(offset) {
  const from = position;
  return mutate(output => {
    const page = output.getPage(from);
    output.removePage(from);
    output.insertPage(from + offset, page);
  }, from + offset);
}
$('move-left').onclick = () => move(-1);
$('move-right').onclick = () => move(1);
$('rotate').onclick = () => mutate(output => {
  const page = output.getPage(position);
  page.setRotation(degrees((page.getRotation().angle + 90) % 360));
});
$('remove').onclick = () => mutate(output => { output.removePage(position); });
$('undo').onclick = () => {
  const prior = history.at(-1);
  if (!prior) return;
  return operation(async () => {
    await setDocument(await loadDocument(prior.bytes), fileName, prior.bytes, { edited: true, page: prior.page });
    history.pop();
    announce('Cambio deshecho.');
  });
};

function setPlacement(item) {
  pendingMark = item;
  $('placement').hidden = $('placement-help').hidden = $('cancel-placement').hidden = !item;
  if (item) $('placement').focus();
}
$('cancel-placement').onclick = () => setPlacement();
$('sign').onclick = () => {
  pad.clear();
  $('signature-error').hidden = true;
  $('sign-dialog').showModal();
};
$('clear-sign').onclick = () => pad.clear();
$('use-sign').onclick = async () => {
  try {
    const signature = await pad.png();
    $('sign-dialog').close();
    setPlacement({ type: 'signature', bytes: signature });
  } catch (error) {
    $('signature-error').textContent = error.message;
    $('signature-error').hidden = false;
  }
};
$('text').onclick = () => $('text-dialog').showModal();
$('text-form').onsubmit = event => {
  event.preventDefault();
  const value = $('text-value').value.trim();
  if (!value) return;
  $('text-dialog').close();
  setPlacement({ type: 'text', value });
};
$('placement').onclick = event => {
  if (!pendingMark || waiting) return;
  const box = canvas.getBoundingClientRect();
  const location = event.detail ? [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height] : [.42, .5];
  const mark = pendingMark, index = position;
  void mutate(output => addMark(output, index, mark, ...location));
};

function linkFor(blob, name) {
  const link = document.createElement('a');
  link.download = name;
  link.href = URL.createObjectURL(blob);
  return link;
}
function showDownload(data, name) {
  if (secondaryDownload) URL.revokeObjectURL(secondaryDownload);
  const link = linkFor(new Blob([data], { type: mime }), name);
  secondaryDownload = link.href;
  link.textContent = 'Descargar ' + name;
  $('download-extra').replaceChildren(link);
  $('download-extra').hidden = false;
}
const baseName = () => fileName.replace(/\.pdf$/i, '');
$('save').onclick = () => {
  const link = linkFor(new Blob([bytes], { type: mime }), baseName() + '.pdf');
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  changed = false;
};
$('share').onclick = () => {
  const file = new File([bytes], baseName() + '.pdf', { type: mime });
  navigator.share({ files: [file] }).then(() => { changed = false; }).catch(error => {
    if (error.name !== 'AbortError') announce('Usa Guardar PDF para descargar el documento.', true);
  });
};

$('extract').onclick = () => $('extract-dialog').showModal();
$('extract-form').onsubmit = event => {
  event.preventDefault();
  let indices;
  try {
    indices = pageRange($('range').value, documentModel.getPageCount());
  } catch (error) {
    $('range').setCustomValidity(error.message);
    $('range').reportValidity();
    return;
  }
  $('extract-dialog').close();
  void operation(async () => {
    const output = await PDFDocument.create();
    await copyPages(output, documentModel, indices);
    showDownload(await output.save(), baseName() + '-extraido.pdf');
    announce('PDF separado listo.');
  });
};
$('range').oninput = () => $('range').setCustomValidity('');
$('compress').onclick = () => $('compress-dialog').showModal();
$('run-compress').onclick = () => {
  $('compress-dialog').close();
  void operation(async () => {
    const result = await compressedPdf(bytes, (n, total) => announce('Comprimiendo página ' + n + ' de ' + total + '…'));
    showDownload(result, baseName() + '-ligero.pdf');
    announce(result.length < bytes.length ? 'Copia ligera lista.' : 'La copia está lista. El archivo de origen ya era más pequeño.');
  });
};

document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => button.closest('dialog').close(); });
const openCraft = setupCraft({
  dialog: $('advanced-dialog'), frame: $('craft-frame'), status: $('advanced-status'), retry: $('advanced-retry'),
  current: () => bytes && ({ bytes, name: fileName }),
  async onSave(data, name) {
    await setDocument(await loadDocument(data), name, data, { edited: true, remember: true, page: position });
  },
});
$('advanced').onclick = openCraft;

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => paint().catch(error => announce(error.message, true)), 130);
});
manageUpdates({
  canReload: () => !waiting && !documentModel && !$('advanced-dialog').open,
  onUpdate(apply) { pendingUpdate = apply; apply(); },
});
$('advanced-dialog').addEventListener('close', () => pendingUpdate?.());

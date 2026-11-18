import './styles.css';
import { editCorners } from './crop.js';
import { frameBlob, preparePage, renderPage } from './imaging.js';
import { createPdf } from './pdf.js';
import { setupCamera } from './camera.js';
import { manageUpdates } from './pwa.js';

const element = id => document.getElementById(id);
const home = element('home'), editing = element('editing'), preview = element('preview'), status = element('status');
const pagesNode = element('pages'), filterNode = element('filters'), resultNode = element('result');
const photoInput = element('photo-input'), cameraInput = element('camera-input');
const cameraDialog = element('camera-dialog'), addDialog = element('add-dialog'), cropDialog = element('crop-dialog');
const video = element('video'), capture = element('capture');
const uploadButtons = ['scan', 'import', 'add', 'crop', 'export', 'rotate', 'remove', 'left', 'right'].map(element);
const filterList = [
  ['document', 'Documento'],
  ['light', 'Papel blanco'],
  ['binary', 'Blanco y negro'],
  ['gray', 'Escala de grises'],
  ['original', 'Color original'],
];
const pages = [];
let active = 0, busy = false, revision = 0, cropEditor, pdfURL, pendingUpdate;

function showMessage(message = '', error = false) {
  status.hidden = !message;
  status.textContent = message;
  status.dataset.error = String(error);
}

function setBusy(value) {
  busy = value;
  uploadButtons.forEach(button => { button.disabled = value; });
  if (!value) {
    element('left').disabled = active === 0;
    element('right').disabled = active >= pages.length - 1;
    if (!pages.length && pendingUpdate) pendingUpdate();
  }
}

function clearResult() {
  if (pdfURL) URL.revokeObjectURL(pdfURL);
  pdfURL = undefined;
  resultNode.hidden = true;
  resultNode.replaceChildren();
}

function showPreview() {
  const page = pages[active];
  const token = ++revision;
  if (!page) {
    preview.replaceChildren();
    return;
  }
  const visible = new Image();
  visible.alt = 'Vista previa de la página ' + (active + 1);
  visible.src = page.previewURL ?? page.photoURL;
  preview.replaceChildren(visible);
  if (page.previewURL) return;
  renderPage(page, 980, .87).then(blob => {
    if (token !== revision) return;
    page.previewURL = URL.createObjectURL(blob);
    visible.src = page.previewURL;
  }).catch(error => {
    if (token === revision) showMessage(error.message, true);
  });
}

function renderState() {
  const page = pages[active];
  home.hidden = Boolean(page);
  editing.hidden = !page;
  if (!page) {
    ++revision;
    return;
  }
  element('page-label').textContent = 'Página ' + (active + 1) + ' de ' + pages.length;
  element('page-count').textContent = String(pages.length);
  filterNode.replaceChildren(...filterList.map(([mode, label]) => {
    const button = document.createElement('button');
    button.textContent = label;
    button.setAttribute('aria-pressed', String(page.mode === mode));
    button.disabled = busy;
    button.addEventListener('click', () => {
      if (busy || page.mode === mode) return;
      page.mode = mode;
      changePage(page);
      filterNode.querySelectorAll('button')[filterList.findIndex(([key]) => key === mode)]?.focus();
    });
    return button;
  }));
  pagesNode.replaceChildren(...pages.map((item, i) => {
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Página ' + (i + 1));
    if (active === i) button.setAttribute('aria-current', 'true');
    const image = new Image();
    image.alt = '';
    image.src = item.photoURL;
    button.append(image, String(i + 1));
    button.addEventListener('click', () => {
      active = i;
      showMessage();
      renderState();
      pagesNode.children[i].focus();
    });
    return button;
  }));
  const item = pagesNode.children[active];
  const bounds = item.getBoundingClientRect();
  const rail = pagesNode.getBoundingClientRect();
  if (bounds.left < rail.left) pagesNode.scrollLeft += bounds.left - rail.left;
  if (bounds.right > rail.right) pagesNode.scrollLeft += bounds.right - rail.right;
  setBusy(busy);
  showPreview();
}

function changePage(page) {
  if (page.previewURL) URL.revokeObjectURL(page.previewURL);
  page.previewURL = undefined;
  clearResult();
  renderState();
}

async function addPhotos(files) {
  if (busy || !files.length) return;
  setBusy(true);
  clearResult();
  let added = 0, missed = 0, failed = 0;
  try {
    for (const [index, file] of files.entries()) {
      showMessage('Preparando foto ' + (index + 1) + ' de ' + files.length + '…');
      try {
        const prepared = await preparePage(file);
        pages.push({ ...prepared, mode: 'document', turns: 0, photoURL: URL.createObjectURL(prepared.photo) });
        added += 1;
        if (!prepared.detected) missed += 1;
      } catch {
        failed += 1;
      }
    }
    if (added) active = pages.length - added;
  } finally {
    setBusy(false);
    renderState();
  }
  if (failed) {
    showMessage('No se pudieron abrir ' + failed + ' foto(s). Prueba con JPEG, PNG o una foto de la cámara.', true);
  } else if (missed) {
    showMessage('Revisa los bordes. Conservamos la imagen completa en ' + missed + ' página(s) sin detección clara.');
  } else {
    showMessage();
  }
}

const openCamera = setupCamera({ dialog: cameraDialog, video, capture, nativeInput: cameraInput });
function startCamera() {
  cameraDialog.querySelector('.camera-error')?.remove();
  openCamera().catch(error => {
    const message = document.createElement('p');
    message.className = 'dialog-help';
    message.setAttribute('role', 'status');
    message.textContent = error.message;
    message.classList.add('camera-error');
    video.before(message);
  });
}

element('scan').onclick = startCamera;
element('import').onclick = () => photoInput.click();
element('add').onclick = () => addDialog.showModal();
element('add-camera').onclick = () => { addDialog.close(); startCamera(); };
element('add-import').onclick = () => { addDialog.close(); photoInput.click(); };
element('native-camera').onclick = () => { cameraDialog.close(); cameraInput.click(); };
for (const input of [photoInput, cameraInput]) {
  input.onchange = () => {
    const files = Array.from(input.files);
    input.value = '';
    void addPhotos(files);
  };
}
capture.onclick = async () => {
  capture.disabled = true;
  try {
    const file = await frameBlob(video);
    cameraDialog.close();
    await addPhotos([file]);
  } catch (error) {
    cameraDialog.close();
    showMessage(error.message, true);
  }
};
document.querySelectorAll('[data-close]').forEach(button => {
  button.onclick = () => button.closest('dialog').close();
});
element('crop').onclick = () => {
  const page = pages[active];
  cropEditor = editCorners(element('crop-stage'), page.photoURL, page.corners);
  cropDialog.showModal();
};
element('crop-reset').onclick = () => cropEditor.reset();
element('crop-apply').onclick = () => {
  const corners = cropEditor.value();
  const valid = corners.every((a, index) => {
    const b = corners[(index + 1) % 4], c = corners[(index + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > .002;
  });
  if (!valid) {
    const help = cropDialog.querySelector('.dialog-help');
    help.textContent = 'Separa las esquinas y evita que las líneas se crucen.';
    return;
  }
  cropDialog.close();
  pages[active].corners = corners;
  showMessage();
  changePage(pages[active]);
};
cropDialog.addEventListener('close', () => {
  element('crop-stage').replaceChildren();
  cropDialog.querySelector('.dialog-help').textContent = 'Arrastra las cuatro esquinas hasta el borde de la hoja.';
});
function movePage(offset) {
  const next = active + offset;
  if (next < 0 || next >= pages.length) return;
  [pages[active], pages[next]] = [pages[next], pages[active]];
  active = next;
  clearResult();
  renderState();
}
element('left').onclick = () => movePage(-1);
element('right').onclick = () => movePage(1);
element('rotate').onclick = () => {
  pages[active].turns += 1;
  changePage(pages[active]);
};
element('remove').onclick = () => {
  const [removed] = pages.splice(active, 1);
  URL.revokeObjectURL(removed.photoURL);
  if (removed.previewURL) URL.revokeObjectURL(removed.previewURL);
  active = Math.max(0, Math.min(active, pages.length - 1));
  clearResult();
  showMessage();
  renderState();
};

element('export').onclick = async () => {
  const snapshot = pages.map(page => ({ ...page }));
  if (!snapshot.length || busy) return;
  setBusy(true);
  clearResult();
  try {
    const blob = await createPdf(snapshot, (n, count) => showMessage('Preparando página ' + n + ' de ' + count + '…'));
    const name = 'Escanercillo-' + new Date().toISOString().slice(0, 10) + '.pdf';
    pdfURL = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = pdfURL;
    link.download = name;
    link.textContent = 'Descargar PDF';
    resultNode.append(link);
    const file = new File([blob], name, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      const share = document.createElement('button');
      share.className = 'text-btn';
      share.textContent = 'Compartir o guardar en Archivos';
      share.onclick = () => navigator.share({ files: [file] }).catch(error => {
        if (error.name !== 'AbortError') showMessage('Usa Descargar PDF para guardar el archivo.', true);
      });
      resultNode.append(share);
    }
    resultNode.hidden = false;
    showMessage('PDF listo con ' + snapshot.length + (snapshot.length === 1 ? ' página.' : ' páginas.'));
  } catch (error) {
    showMessage(error.message || 'No se pudo crear el PDF.', true);
  } finally {
    setBusy(false);
  }
};

document.querySelector('.brand').onclick = event => {
  if (pages.length || busy) event.preventDefault();
};
manageUpdates({
  canReload: () => !busy && !pages.length && !cameraDialog.open && !addDialog.open && !cropDialog.open,
  onUpdate(useUpdate) {
    pendingUpdate = useUpdate;
    useUpdate();
  },
});

import release from '../pdfcraft.lock.json';

export function setupCraft({ dialog, frame, status, retry, current, onSave }) {
  let dirty = false, mode, timer;
  const origin = location.origin;
  const viewport = document.getElementById('craft-viewport');
  document.querySelectorAll('[data-craft-view]').forEach(button => {
    button.onclick = () => {
      const fraction = Number(button.dataset.craftView);
      viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) * fraction;
    };
  });

  function fail(message) {
    clearTimeout(timer);
    status.hidden = false;
    status.textContent = message;
    retry.hidden = mode === 'cpu';
  }

  function start(renderer = '') {
    mode = renderer;
    dirty = false;
    retry.hidden = true;
    status.hidden = false;
    status.textContent = 'Cargando el motor de PdfCraft…';
    const url = new URL('./pdfcraft/' + release.version + '/index.html', document.baseURI);
    url.searchParams.set('host', 'parent');
    if (mode) url.searchParams.set(mode, '');
    frame.src = url.href;
    clearTimeout(timer);
    timer = setTimeout(() => fail('PdfCraft está tardando en iniciar. Puedes cerrar este modo y seguir con las herramientas táctiles.'), 45000);
  }

  window.addEventListener('message', async event => {
    if (!dialog.open || event.origin !== origin || event.source !== frame.contentWindow) return;
    const message = event.data;
    if (message?.type === 'pdfcraft:ready') {
      clearTimeout(timer);
      status.hidden = true;
      retry.hidden = true;
      viewport.scrollLeft = current() ? (viewport.scrollWidth - viewport.clientWidth) / 2 : 0;
      const file = current();
      if (file) {
        const bytes = file.bytes.slice().buffer;
        event.source.postMessage({ type: 'pdfcraft:open', name: file.name, bytes }, origin, [bytes]);
      }
    }
    if (message?.type === 'pdfcraft:dirty') dirty = Boolean(message.dirty);
    if (message?.type === 'pdfcraft:failed') fail('PdfCraft no pudo iniciar en este navegador.');
    if (message?.type === 'pdfcraft:save') {
      const bytes = message.bytes;
      if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) return;
      try {
        await onSave(new Uint8Array(bytes), String(message.name || 'Documento.pdf'));
        dirty = false;
        event.source.postMessage({ type: 'pdfcraft:saved', name: message.name }, origin);
        status.textContent = 'Edición recibida. Pulsa × para volver y guardar el PDF.';
        status.hidden = false;
      } catch {
        fail('El documento guardado desde PdfCraft no pudo abrirse.');
      }
    }
  });

  retry.onclick = () => start('cpu');

  function mayClose() {
    return !dirty || confirm('Hay cambios sin guardar en PdfCraft. ¿Quieres cerrar este editor?');
  }
  dialog.addEventListener('cancel', event => {
    if (!mayClose()) event.preventDefault();
  });
  document.getElementById('close-advanced').onclick = () => {
    if (mayClose()) dialog.close();
  };
  dialog.addEventListener('close', () => {
    clearTimeout(timer);
    frame.removeAttribute('src');
  });
  return () => {
    dialog.showModal();
    start(new URL(location.href).searchParams.has('cpu') ? 'cpu' : '');
  };
}

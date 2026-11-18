const base = new URL(import.meta.env.BASE_URL, document.baseURI);
let worker, ticket = 0;
const requests = new Map();

function startWorker() {
  const engine = new Worker(new URL(__VISION_FOLDER__ + '/vision-worker.js', base));
  engine.onmessage = ({ data }) => {
    const request = requests.get(data.id);
    if (!request) return;
    requests.delete(data.id);
    clearTimeout(request.timeout);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data);
  };
  engine.onerror = () => {
    for (const request of requests.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error('No se pudo iniciar el motor de escaneo.'));
    }
    requests.clear();
    engine.terminate();
    worker = undefined;
  };
  return engine;
}

function request(type, pixels, options = {}) {
  return new Promise((resolve, reject) => {
    worker ??= startWorker();
    const id = ++ticket;
    const { width, height } = pixels, buffer = pixels.data.buffer;
    const timeout = setTimeout(() => {
      requests.delete(id);
      reject(new Error('El procesamiento tardó demasiado. Intenta con una imagen más pequeña.'));
    }, 45000);
    requests.set(id, { resolve, reject, timeout });
    worker.postMessage({ id, type, width, height, buffer, ...options }, [buffer]);
  });
}

function canvasAt(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function withImage(file, callback) {
  // Safari applies EXIF orientation when decoding a photo in an image element.
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    return await callback(image);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function withSample(file, maxEdge, callback) {
  return withImage(file, async image => {
    const ratio = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = canvasAt(Math.max(1, Math.round(image.naturalWidth * ratio)), Math.max(1, Math.round(image.naturalHeight * ratio)));
    try {
      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await callback(canvas);
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  });
}

export function imageBlob(canvas, quality = .9) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('No se pudo guardar la imagen.'));
  }, 'image/jpeg', quality));
}

function readPixels(canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
}

export const fullImage = () => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

export async function preparePage(file) {
  if (!file.size || file.size > 65 * 1024 * 1024) throw new Error('Usa una foto de menos de 65 MB.');
  const photo = await withSample(file, 1200, canvas => imageBlob(canvas, .89));
  let corners;
  try {
    ({ corners } = await withSample(photo, 720, canvas => request('detect', readPixels(canvas))));
  } catch (error) {
    console.warn('Detección automática:', error.message);
  }
  return { source: file, photo, corners: corners ?? fullImage(), detected: Boolean(corners) };
}

export async function renderPage(page, maxEdge, quality) {
  const sourceEdge = maxEdge > 1200 ? 3200 : 1200;
  const data = await withSample(page.source, sourceEdge, canvas =>
    request('render', readPixels(canvas), { corners: page.corners, mode: page.mode, maxEdge }));
  const output = canvasAt(data.width, data.height);
  const turns = page.turns % 4;
  let rotated;
  try {
    output.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height), 0, 0);
    if (!turns) return await imageBlob(output, quality);
    rotated = canvasAt(turns % 2 ? data.height : data.width, turns % 2 ? data.width : data.height);
    const ctx = rotated.getContext('2d');
    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate(turns * Math.PI / 2);
    ctx.drawImage(output, -output.width / 2, -output.height / 2);
    return await imageBlob(rotated, quality);
  } finally {
    output.width = output.height = 1;
    if (rotated) rotated.width = rotated.height = 1;
  }
}

export async function frameBlob(video) {
  const canvas = canvasAt(video.videoWidth, video.videoHeight);
  try {
    canvas.getContext('2d').drawImage(video, 0, 0);
    return await imageBlob(canvas, .97);
  } finally {
    canvas.width = canvas.height = 1;
  }
}

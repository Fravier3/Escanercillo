/* global cv, jscanify */
let ready;

function initialize() {
  ready ??= (async () => {
    importScripts('./opencv.js', './jscanify.js');
    globalThis.cv = await globalThis.cv;
    if (!cv.Mat) throw new Error('El motor de escaneo no pudo iniciarse.');
  })();
  return ready;
}

const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
const clamp = (number, min, max) => Math.min(max, Math.max(min, number));

function orderCorners(points) {
  const center = points.reduce((sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4 }), { x: 0, y: 0 });
  const ordered = points.slice().sort((a, b) =>
    Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  const start = ordered.reduce((best, p, i) =>
    p.x + p.y < ordered[best].x + ordered[best].y ? i : best, 0);
  return ordered.slice(start).concat(ordered.slice(0, start));
}

function polygonScore(points, width, height) {
  const area = Math.abs(points.reduce((sum, a, i) => {
    const b = points[(i + 1) % 4];
    return sum + a.x * b.y - b.x * a.y;
  }, 0)) / (2 * width * height);
  if (area < .13 || area > .95) return 0;

  let angleScore = 0;
  let frameCorners = 0;
  const minEdge = Math.min(width, height) * .12;
  for (let i = 0; i < 4; i += 1) {
    const a = points[i], b = points[(i + 1) % 4], c = points[(i + 2) % 4];
    const length = pointDistance(a, b), nextLength = pointDistance(b, c);
    if (length < minEdge || cross(a, b, c) <= 0) return 0;
    const cosine = Math.abs(((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)) / (length * nextLength));
    if (cosine > .91) return 0;
    angleScore += 1 - cosine;
    if ((a.x < 4 || a.x > width - 5) && (a.y < 4 || a.y > height - 5)) frameCorners += 1;
  }
  if (frameCorners >= 2) return 0;
  return area * (.55 + .45 * angleScore / 4);
}

function bestQuadrilateral(mask, consider) {
  const contours = new cv.MatVector(), hierarchy = new cv.Mat(), polygon = new cv.Mat();
  try {
    cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      try {
        if (cv.contourArea(contour) < mask.rows * mask.cols * .1) continue;
        const perimeter = cv.arcLength(contour, true);
        for (const rate of [.017, .028, .042, .059]) {
          cv.approxPolyDP(contour, polygon, perimeter * rate, true);
          if (polygon.rows !== 4 || !cv.isContourConvex(polygon)) continue;
          const values = polygon.data32S;
          consider(orderCorners(Array.from({ length: 4 }, (_, n) => ({ x: values[n * 2], y: values[n * 2 + 1] }))));
          break;
        }
      } finally {
        contour.delete();
      }
    }
  } finally {
    polygon.delete();
    hierarchy.delete();
    contours.delete();
  }
}

function findPage(image) {
  const width = image.cols, height = image.rows;
  let best = null, bestScore = 0;
  function consider(points, weight = 1) {
    const score = polygonScore(points, width, height) * weight;
    if (score > bestScore) {
      best = points;
      bestScore = score;
    }
  }

  const gray = new cv.Mat(), edge = new cv.Mat(), paper = new cv.Mat();
  const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
  const scanner = new jscanify();
  let contour;
  try {
    cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0);
    // jscanify supplies an independent paper contour. Use a polygon-based
    // estimate when available, since extrema alone can clip angled pages.
    contour = scanner.findPaperContour(gray);
    if (contour) {
      const corners = scanner.getCornerPoints(contour);
      const points = [corners.topLeftCorner, corners.topRightCorner, corners.bottomRightCorner, corners.bottomLeftCorner];
      if (points.every(Boolean)) consider(orderCorners(points), .73);
    }
    for (const [low, high] of [[45, 145], [20, 70]]) {
      cv.Canny(gray, edge, low, high);
      cv.morphologyEx(edge, edge, cv.MORPH_CLOSE, kernel);
      bestQuadrilateral(edge, consider);
    }
    cv.threshold(gray, paper, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    cv.morphologyEx(paper, paper, cv.MORPH_CLOSE, kernel);
    bestQuadrilateral(paper, points => consider(points, .9));
    return best?.map(({ x, y }) => ({ x: x / (width - 1), y: y / (height - 1) })) ?? null;
  } finally {
    contour?.delete();
    kernel.delete();
    gray.delete();
    edge.delete();
    paper.delete();
  }
}

// Perspective matrix workflow adapted from react-perspective-cropper (MIT).
function perspective(image, points, maxEdge) {
  const input = points.map(({ x, y }) => ({ x: x * (image.cols - 1), y: y * (image.rows - 1) }));
  if (input.some((point, i) => cross(point, input[(i + 1) % 4], input[(i + 2) % 4]) <= 0)) {
    throw new Error('Las esquinas no pueden cruzarse.');
  }
  const [a, b, c, d] = input;
  const width = Math.max(pointDistance(a, b), pointDistance(d, c));
  const height = Math.max(pointDistance(a, d), pointDistance(b, c));
  if (width < 16 || height < 16) throw new Error('El recorte es demasiado pequeño.');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const w = Math.max(2, Math.round((width + 1) * scale)), h = Math.max(2, Math.round((height + 1) * scale));
  const source = cv.matFromArray(4, 1, cv.CV_32FC2, input.flatMap(({ x, y }) => [x, y]));
  const target = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w - 1, 0, w - 1, h - 1, 0, h - 1]);
  const transform = cv.getPerspectiveTransform(source, target);
  const output = new cv.Mat();
  try {
    cv.warpPerspective(image, output, transform, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
    return output;
  } catch (error) {
    output.delete();
    throw error;
  } finally {
    transform.delete();
    target.delete();
    source.delete();
  }
}

function enhance(image, mode) {
  if (mode === 'original') return new Uint8ClampedArray(image.data);
  const width = image.cols, height = image.rows;
  const gray = new cv.Mat(), reduced = new cv.Mat(), light = new cv.Mat(), soft = new cv.Mat();
  try {
    cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, soft, new cv.Size(3, 3), 0, 0);
    if (mode !== 'gray') {
      const ratio = 96 / Math.max(width, height);
      cv.resize(gray, reduced, new cv.Size(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio))), 0, 0, cv.INTER_AREA);
      // AndroidDocumentFilter (Apache 2.0) estimates paper illumination with
      // dilation and a median filter. Work on a small luminance map here.
      const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
      try {
        cv.dilate(reduced, reduced, kernel);
      } finally {
        kernel.delete();
      }
      cv.medianBlur(reduced, reduced, 9);
      cv.GaussianBlur(reduced, reduced, new cv.Size(5, 5), 0, 0);
      cv.resize(reduced, light, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR);
    }
    const source = image.data, mono = gray.data, local = light.data, blur = soft.data;
    const result = new Uint8ClampedArray(source.length);
    for (let i = 0, p = 0; i < mono.length; i += 1, p += 4) {
      const lum = mono[i];
      const sharp = clamp((lum - blur[i]) * .66, -32, 29);
      const background = local[i];
      let value = lum;
      if (mode === 'gray') value = lum + sharp;
      else if (mode === 'binary') value = (lum / Math.max(background, 90)) * 255 + sharp > 172 ? 255 : 0;
      else {
        const normalized = (lum * 247) / Math.max(background, 118);
        const contrast = mode === 'light' ? 1.14 : 1.07;
        value = (normalized - 128) * contrast + 128 + sharp;
      }
      const preserveColor = mode === 'document' || mode === 'light';
      const colorWeight = mode === 'light' ? .63 : .93;
      result[p] = value + (preserveColor ? (source[p] - lum) * colorWeight : 0);
      result[p + 1] = value + (preserveColor ? (source[p + 1] - lum) * colorWeight : 0);
      result[p + 2] = value + (preserveColor ? (source[p + 2] - lum) * colorWeight : 0);
      result[p + 3] = 255;
    }
    return result;
  } finally {
    gray.delete();
    reduced.delete();
    light.delete();
    soft.delete();
  }
}

self.onmessage = async ({ data }) => {
  const { id, type, width, height, buffer } = data;
  let image, corrected;
  try {
    await initialize();
    image = cv.matFromImageData(new ImageData(new Uint8ClampedArray(buffer), width, height));
    if (type === 'detect') {
      self.postMessage({ id, corners: findPage(image) });
      return;
    }
    corrected = perspective(image, data.corners, data.maxEdge);
    const pixels = enhance(corrected, data.mode);
    self.postMessage({ id, width: corrected.cols, height: corrected.rows, buffer: pixels.buffer }, [pixels.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error?.message ?? 'No se pudo procesar la imagen.' });
  } finally {
    corrected?.delete();
    image?.delete();
  }
};

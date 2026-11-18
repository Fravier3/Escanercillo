import { fullImage } from './imaging.js';

const svgNS = 'http://www.w3.org/2000/svg';
const clamp = value => Math.max(0, Math.min(1, value));

export function editCorners(stage, url, corners) {
  let draft = corners.map(point => ({ ...point }));
  const photo = new Image();
  photo.src = url;
  photo.alt = 'Foto original con las esquinas del recorte';
  const overlay = document.createElementNS(svgNS, 'svg');
  overlay.setAttribute('viewBox', '0 0 1000 1000');
  overlay.setAttribute('preserveAspectRatio', 'none');
  overlay.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(svgNS, 'polygon');
  shape.setAttribute('fill', '#4b9eff25');
  shape.setAttribute('stroke', '#1576fc');
  shape.setAttribute('stroke-width', '2');
  shape.setAttribute('vector-effect', 'non-scaling-stroke');
  overlay.append(shape);
  const names = ['superior izquierda', 'superior derecha', 'inferior derecha', 'inferior izquierda'];
  const handles = names.map((name, index) => {
    const handle = document.createElement('button');
    handle.className = 'handle';
    handle.setAttribute('aria-label', 'Esquina ' + name);
    handle.addEventListener('pointerdown', event => handle.setPointerCapture(event.pointerId));
    handle.addEventListener('pointermove', event => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const bounds = photo.getBoundingClientRect();
      draft[index] = {
        x: clamp((event.clientX - bounds.left) / bounds.width),
        y: clamp((event.clientY - bounds.top) / bounds.height),
      };
      draw();
    });
    handle.addEventListener('keydown', event => {
      const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const offset = offsets[event.key];
      if (!offset) return;
      event.preventDefault();
      const step = event.shiftKey ? .04 : .01;
      draft[index] = { x: clamp(draft[index].x + offset[0] * step), y: clamp(draft[index].y + offset[1] * step) };
      draw();
    });
    return handle;
  });
  function draw() {
    shape.setAttribute('points', draft.map(point => [point.x * 1000, point.y * 1000].join(',')).join(' '));
    handles.forEach((handle, i) => {
      handle.style.left = draft[i].x * 100 + '%';
      handle.style.top = draft[i].y * 100 + '%';
    });
  }
  stage.replaceChildren(photo, overlay, ...handles);
  draw();
  return {
    reset() {
      draft = fullImage();
      draw();
    },
    value() {
      return draft.map(point => ({ ...point }));
    },
  };
}

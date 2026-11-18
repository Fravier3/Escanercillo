export function signaturePad(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let pointer;
  ctx.lineWidth = 6;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.strokeStyle = '#211a33';

  function point(event) {
    const box = canvas.getBoundingClientRect();
    return [(event.clientX - box.left) * canvas.width / box.width, (event.clientY - box.top) * canvas.height / box.height];
  }

  canvas.onpointerdown = event => {
    if (pointer !== undefined) return;
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    const [x, y] = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + .2, y);
    ctx.stroke();
  };
  canvas.onpointermove = event => {
    if (event.pointerId !== pointer) return;
    ctx.lineTo(...point(event));
    ctx.stroke();
  };
  canvas.onlostpointercapture = () => { pointer = undefined; };

  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); },
    async png() {
      const { width, height } = canvas;
      const pixels = ctx.getImageData(0, 0, width, height).data;
      let left = width, right = 0, top = height, bottom = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (!pixels[(y * width + x) * 4 + 3]) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      if (left >= right || top >= bottom) throw new Error('Dibuja tu firma antes de continuar.');
      const cropped = document.createElement('canvas');
      cropped.width = right - left + 1;
      cropped.height = bottom - top + 1;
      cropped.getContext('2d').drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
      const blob = await new Promise(resolve => cropped.toBlob(resolve, 'image/png'));
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}

export function setupCamera({ dialog, video, capture, nativeInput }) {
  let stream, generation = 0;
  function stop() {
    generation += 1;
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    video.srcObject = null;
    capture.disabled = true;
  }

  dialog.addEventListener('close', stop);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !dialog.open) return;
    stop();
    dialog.close();
  });
  window.addEventListener('pagehide', stop);

  return async function openCamera() {
    const isTouchDevice = matchMedia('(pointer: coarse)').matches;
    if (isTouchDevice || !navigator.mediaDevices?.getUserMedia) {
      nativeInput.click();
      return;
    }
    dialog.showModal();
    const opening = ++generation;
    try {
      const result = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      if (opening !== generation || !dialog.open) {
        result.getTracks().forEach(track => track.stop());
        return;
      }
      stream = result;
      video.srcObject = stream;
      await video.play();
      if (opening === generation) capture.disabled = false;
    } catch (error) {
      if (opening !== generation) return;
      stop();
      throw new Error('La cámara web no está disponible. Puedes usar Cámara del dispositivo o importar una foto.');
    }
  };
}

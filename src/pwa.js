export function manageUpdates({ canReload, onUpdate }) {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  let registration, reloading = false, needsReload = false;
  let hadController = Boolean(navigator.serviceWorker.controller);

  function useUpdate() {
    if (!canReload() || reloading) return;
    if (needsReload) {
      reloading = true;
      location.reload();
      return;
    }
    registration?.waiting?.postMessage('activate');
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    needsReload = true;
    onUpdate(useUpdate);
  });

  navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { updateViaCache: 'none' }).then(result => {
    registration = result;
    function notify() {
      if (registration.waiting) onUpdate(useUpdate);
    }
    notify();
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', notify);
    });
    const refresh = () => {
      if (!document.hidden) registration.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
  }).catch(error => console.warn('Instalación sin conexión:', error.message));
}

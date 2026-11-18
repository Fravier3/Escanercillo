# Escanercillo

PWA en español para escanear documentos, corregir bordes y guardar una o más hojas como PDF. Lee fotos de la cámara o la galería y procesa píxeles en un Web Worker. No requiere cuenta ni servicios de datos y no carga imágenes a Internet. Las páginas de la sesión viven en memoria hasta que se descargue el PDF o se cierre la aplicación.

## Usar en iPhone

Abre la app con Safari. Para instalarla, pulsa **Compartir → Añadir a pantalla de inicio**. **Escanear ahora** abre la captura del dispositivo; **Importar fotos** permite seleccionar varias. Si un recorte no sale bien, ajusta las cuatro esquinas. Usa **Guardar PDF** y descarga el archivo o compártelo con Archivos donde esté disponible. El modo sin conexión queda disponible después de que el navegador termine de guardar la aplicación y el motor de escaneo.

La decodificación depende del sistema y el navegador. Si una imagen HEIC no se abre, prueba la cámara o una copia JPEG.

## Desarrollo

Requiere Node.js 24.

```sh
npm ci
npm run dev
npm run build
npx playwright install --with-deps chromium
npm test
```

`npm test` utiliza el build de `dist`. Puede usar Chromium instalado si se define `SCANNER_CHROMIUM`. El workflow verifica el flujo móvil y escritorio y despliega únicamente `dist`. Para habilitar Pages, selecciona **GitHub Actions** como fuente en la configuración de Pages.

## Detección y filtrado

jscanify aporta el contorno de referencia. OpenCV evalúa candidatos por bordes y luminosidad, corrige la perspectiva con interpolación cúbica y genera filtros con contraste local. La exportación vuelve a procesar las fotos originales a hasta 3100 píxeles de lado mayor, sin ampliar archivos pequeños. Los algoritmos y sus licencias están detallados en [THIRD-PARTY-NOTICES](vendor/THIRD-PARTY-NOTICES.txt). El motor y las dependencias se sirven desde el mismo sitio.

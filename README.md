# Archivo PDF

Editor local de PDF diseñado para iPhone. Abre y visualiza PDFs, organiza páginas, combina y extrae documentos, añade texto y firmas dibujadas, convierte fotos a PDF y exporta copias comprimidas. Los PDFs se procesan en el dispositivo.

El modo **Edición avanzada** carga la distribución web oficial de [PdfCraft](https://github.com/storytold/pdfcraft), la misma versión 0.19.0 integrada en [Arsenal](https://github.com/Fravier3/navajaSuiza/tree/omnidesk-windows/desktop). La aplicación táctil usa PDF.js para visualizar y pdf-lib para las operaciones rápidas. Los avisos de licencia de los tres proyectos se incluyen en el build.

## Uso

Abre [Archivo PDF](https://fravier3.github.io/Escanercillo/) en Safari y usa **Compartir → Agregar a Inicio**. El modo táctil puede usarse sin red después de la primera carga. El modo avanzado es una descarga aparte cuando se abre por primera vez. En ese modo, guarda en PdfCraft, vuelve a Archivo PDF y descarga o comparte la edición. Para documentos cifrados, abre el archivo directamente en Edición avanzada.

La firma dibujada es una marca visual. El texto nuevo se superpone a la página. La copia comprimida rasteriza el documento, lo que elimina los enlaces y la capacidad de seleccionar texto en esa copia. Conserva el archivo original para esos usos.

## Desarrollo

Requiere Node 24, curl y unzip. El build verifica el SHA-256 del archivo de PdfCraft antes de extraerlo. Para reutilizar un ZIP local idéntico, se puede definir `PDFCRAFT_ARCHIVE`.

```sh
npm ci
npm run dev
npm run build
npx playwright install --with-deps chromium
npm test
```

GitHub Actions construye, prueba y publica solamente `dist` en Pages. El historial del producto anterior se conserva en los commits previos a este cambio.

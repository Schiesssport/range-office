// Copies the pinned pdfjs-dist UMD build into src/vendor so it ships with the
// app and is cached by the service worker. Run after `npm install` whenever the
// pdfjs-dist version in package.json changes: `npm run vendor`.

import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const source = new URL('node_modules/pdfjs-dist/build/', root);
const target = new URL('src/vendor/', root);

const files = ['pdf.min.js', 'pdf.worker.min.js'];

await mkdir(fileURLToPath(target), { recursive: true });
for (const file of files) {
    await copyFile(fileURLToPath(new URL(file, source)), fileURLToPath(new URL(file, target)));
    console.log(`vendored ${file}`);
}

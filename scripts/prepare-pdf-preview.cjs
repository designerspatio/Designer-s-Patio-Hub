const { copyFileSync, cpSync, mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");

const pdfjs = dirname(require.resolve("pdfjs-dist/package.json"));
const output = join(__dirname, "../public/pdf-preview");
mkdirSync(output, { recursive: true });
copyFileSync(join(pdfjs, "build/pdf.worker.min.mjs"), join(output, "pdf.worker.min.mjs"));
for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  cpSync(join(pdfjs, directory), join(output, directory), { recursive: true });
}

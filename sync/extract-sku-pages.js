#!/usr/bin/env node
// Extrae mapeo SKU → página del PDF VINI usando pdftotext -bbox-layout.
// Solo texto, sin imágenes. Output: sync/vini-sku-pages.json
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const POPPLER = 'C:/Users/cgcer/AppData/Local/Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin';
const PDFTOTEXT = POPPLER + '/pdftotext.exe';
const PDFINFO = POPPLER + '/pdfinfo.exe';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const pdfPath = args[0] ||
  'C:/Users/cgcer/OneDrive/MOTOS/CATALOGOS MOTOS GENERAL/CATALAGOS GENERAL/catalogo vini 2026 feb.pdf';

// Total páginas
const info = execFileSync(PDFINFO, [pdfPath], { encoding: 'utf8' });
const totalPages = parseInt(info.match(/Pages:\s+(\d+)/)[1], 10);
console.log(`PDF: ${totalPages} páginas`);

// Extraer texto con bbox completo
const tmp = path.join(require('os').tmpdir(), `vini-bbox-${Date.now()}.html`);
execFileSync(PDFTOTEXT, ['-bbox-layout', pdfPath, tmp]);
const xml = fs.readFileSync(tmp, 'utf8');
fs.unlinkSync(tmp);

// Cada <page ...> ... </page> es una página.
const pages = xml.split(/<page /);
const skuByPage = new Map(); // Map<pagina, Set<sku>>
const pageBySku = new Map(); // Map<sku, primera_pagina>

for (let i = 1; i < pages.length; i++) {
  const pageNum = i; // 1-indexed
  const body = '<page ' + pages[i];
  const skus = new Set();
  const wordRx = /<word[^>]*>([^<]+)<\/word>/g;
  let m;
  while ((m = wordRx.exec(body)) !== null) {
    const txt = m[1].trim();
    if (/^\d{12}$/.test(txt)) {
      skus.add(txt);
      if (!pageBySku.has(txt)) pageBySku.set(txt, pageNum);
    }
  }
  if (skus.size) skuByPage.set(pageNum, [...skus]);
}

// Stats
let totalSkus = 0;
for (const arr of skuByPage.values()) totalSkus += arr.length;
console.log(`Páginas con SKUs: ${skuByPage.size}`);
console.log(`Total ocurrencias SKU: ${totalSkus}`);
console.log(`SKUs únicos: ${pageBySku.size}`);

// Guardar
const out = {
  total_paginas: totalPages,
  skus_unicos: pageBySku.size,
  sku_to_page: Object.fromEntries(pageBySku),  // SKU → primera página donde aparece
  page_to_skus: Object.fromEntries(skuByPage), // página → lista SKUs
};
const outPath = path.join(__dirname, 'vini-sku-pages.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`✓ Guardado en ${outPath}`);

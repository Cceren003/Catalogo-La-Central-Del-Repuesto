#!/usr/bin/env node
// Extrae imágenes EMBEBIDAS de un PDF (no render+crop) y las asocia a SKUs por orden.
// Pipeline:
//   1. Para cada página: pdfimages -list para identificar imágenes "producto" (>100x100, aspect 0.4-2.5)
//   2. pdfimages -all para extraer imágenes + smasks
//   3. Combina cada imagen con su smask (si existe) y aplana sobre fondo blanco
//   4. Orden de SKUs en la página (top-bottom, left-right) = orden de imágenes
//   5. Guarda como img_emb/<SKU>.jpg

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');

const POPPLER = 'C:/Users/cgcer/AppData/Local/Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin';
const PDFIMAGES = POPPLER + '/pdfimages.exe';
const PDFTOTEXT = POPPLER + '/pdftotext.exe';
const PDFINFO   = POPPLER + '/pdfinfo.exe';
const MAGICK    = 'C:/Program Files/ImageMagick-7.1.2-Q16-HDRI/magick.exe';

const MIN_DIM = 100;
const MAX_ASPECT = 2.5;
const MIN_ASPECT = 0.4;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout.toString());
    });
  });
}

// Parses `pdfimages -list` output into array of {page, num, type, width, height, objectId}
function parseListOutput(out) {
  const lines = out.split('\n').filter(l => /^\s+\d+\s+\d+\s+\w+/.test(l));
  return lines.map(line => {
    const parts = line.trim().split(/\s+/);
    return {
      page: +parts[0], num: +parts[1], type: parts[2],
      width: +parts[3], height: +parts[4],
      objectId: +parts[10],
    };
  });
}

function isProductImage(img) {
  if (img.type !== 'image') return false;
  if (img.width < MIN_DIM || img.height < MIN_DIM) return false;
  const ar = img.width / img.height;
  if (ar > MAX_ASPECT || ar < MIN_ASPECT) return false;
  return true;
}

// Extrae texto con bbox y devuelve SKUs ordenados por página (top-bottom, left-right).
async function extractSkus(pdf, firstPage, lastPage, skuRegex) {
  const tmp = path.join(os.tmpdir(), `skus-${firstPage}-${lastPage}.html`);
  await run(PDFTOTEXT, ['-bbox-layout', '-f', String(firstPage), '-l', String(lastPage), pdf, tmp]);
  const xml = fs.readFileSync(tmp, 'utf8');
  fs.unlinkSync(tmp);

  const wordRx = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g;
  const skusByPage = new Map();
  let pageNum = firstPage - 1;
  const parts = xml.split(/<page /);
  for (let i = 1; i < parts.length; i++) {
    pageNum++;
    const body = '<page ' + parts[i];
    const pm = /<page width="([\d.]+)" height="([\d.]+)">/.exec(body);
    if (!pm) continue;
    const width = parseFloat(pm[1]);
    const midX = width / 2;
    const items = [];
    let m;
    wordRx.lastIndex = 0;
    while ((m = wordRx.exec(body)) !== null) {
      const txt = m[5].trim();
      if (skuRegex.test(txt)) {
        items.push({
          sku: txt,
          y: +m[2],
          x: +m[1],
          col: (+m[1] + +m[3]) / 2 < midX ? 0 : 1,
        });
      }
    }
    // Orden de lectura: agrupar por fila aproximada (y) y dentro de fila, por columna.
    items.sort((a, b) => {
      // Agrupar en bandas de ~30 pts
      const rowA = Math.floor(a.y / 30);
      const rowB = Math.floor(b.y / 30);
      if (rowA !== rowB) return rowA - rowB;
      return a.col - b.col;
    });
    skusByPage.set(pageNum, items.map(i => i.sku));
  }
  return skusByPage;
}

async function main() {
  const pdfPath = process.argv[2];
  const outDir = process.argv[3] || path.join(__dirname, '..', 'img_emb');
  const skuRegex = new RegExp(process.argv[4] || '^\\d{12}$');
  if (!pdfPath) { console.error('uso: extract_embedded.js <pdf> [outDir] [skuRegex]'); process.exit(1); }

  fs.mkdirSync(outDir, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfemb-'));

  // 1. Total páginas
  const info = await run(PDFINFO, [pdfPath]);
  const totalPages = parseInt(info.match(/Pages:\s+(\d+)/)[1], 10);
  console.log(`PDF: ${path.basename(pdfPath)} — ${totalPages} pages`);

  // 2. Listar imágenes de TODO el PDF en un solo call (más rápido que per-page)
  console.log('→ Listando todas las imágenes embebidas...');
  const listOut = await run(PDFIMAGES, ['-list', pdfPath]);
  const allImages = parseListOutput(listOut);
  console.log(`  total items: ${allImages.length}`);

  // 3. Extraer todas las imágenes en un temp dir
  console.log('→ Extrayendo archivos...');
  await run(PDFIMAGES, ['-all', pdfPath, path.join(tmpDir, 'e')]);
  const extractedFiles = fs.readdirSync(tmpDir).filter(f => /\.(jpg|jpeg|png|ppm|pbm)$/i.test(f));
  extractedFiles.sort(); // orden natural por nombre

  // Mapear index (según -list) → file (según -all)
  // pdfimages extrae en el MISMO orden que lista, con nombres e-000, e-001, ...
  const indexToFile = new Map();
  for (const f of extractedFiles) {
    const m = f.match(/e-(\d+)\./);
    if (m) indexToFile.set(parseInt(m[1], 10), path.join(tmpDir, f));
  }
  console.log(`  archivos extraídos: ${extractedFiles.length}`);

  // 4. Extraer SKUs de todas las páginas
  console.log('→ Leyendo SKUs de texto...');
  const skusByPage = await extractSkus(pdfPath, 1, totalPages, skuRegex);

  // 5. Por página: filtrar productos, parear con smasks, asociar a SKU por orden
  console.log('→ Procesando imágenes por página...');
  const stats = { saved: 0, skipped: 0, mismatched: 0 };

  for (let p = 1; p <= totalPages; p++) {
    const pageImgs = allImages.filter(i => i.page === p);
    const pageSkus = skusByPage.get(p) || [];
    if (pageSkus.length === 0) continue;

    // Filtrar productos y parear con smasks (por objectId)
    const products = [];
    for (let i = 0; i < pageImgs.length; i++) {
      const img = pageImgs[i];
      if (!isProductImage(img)) continue;
      // Buscar smask con mismo objectId o el siguiente item
      let smask = null;
      const next = pageImgs[i + 1];
      if (next && next.type === 'smask' && next.objectId === img.objectId) {
        smask = next;
      }
      products.push({ img, smask });
    }

    if (products.length !== pageSkus.length) {
      stats.mismatched++;
      if (stats.mismatched <= 5) {
        console.log(`  ⚠ pág ${p}: ${products.length} imágenes producto vs ${pageSkus.length} SKUs — skip`);
      }
      continue;
    }

    for (let i = 0; i < products.length; i++) {
      const { img, smask } = products[i];
      const sku = pageSkus[i];
      const imgFile = indexToFile.get(img.num);
      const smaskFile = smask ? indexToFile.get(smask.num) : null;
      if (!imgFile) { stats.skipped++; continue; }
      const out = path.join(outDir, `${sku}.jpg`);
      try {
        if (smaskFile) {
          // Combinar con alpha + flatten blanco
          await run(MAGICK, [
            imgFile, '-read-mask', smaskFile,
            '-background', 'white', '-alpha', 'remove', '-alpha', 'off',
            '-quality', '90', out,
          ]);
        } else {
          await run(MAGICK, [imgFile, '-quality', '90', out]);
        }
        stats.saved++;
      } catch (e) { stats.skipped++; }
    }
  }

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  console.log(`\n=== RESULTADO ===`);
  console.log(`Guardadas: ${stats.saved}`);
  console.log(`Saltadas: ${stats.skipped}`);
  console.log(`Páginas con mismatch imagen↔SKU: ${stats.mismatched}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

#!/usr/bin/env node
// Extrae imágenes de productos desde PDF catalogos:
// 1. Renderiza cada página a JPG @200 DPI con pdftoppm.
// 2. Extrae texto con bounding boxes vía pdftotext -bbox-layout.
// 3. Busca SKUs (patrones numéricos) y determina su celda en el grid de la página.
// 4. Corta la región del producto (arriba del texto del SKU) y guarda como img_pdf/<SKU>.jpg.
//
// Uso: node extract_pdf_images.js <pdf_path> [--sku-regex=\\d{12}] [--out=../img_pdf]

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { execFileSync } = require('child_process');

const POPPLER_BIN = 'C:\\Users\\cgcer\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin';
const PDFTOPPM = path.join(POPPLER_BIN, 'pdftoppm.exe');
const PDFTOTEXT = path.join(POPPLER_BIN, 'pdftotext.exe');
const PDFINFO = path.join(POPPLER_BIN, 'pdfinfo.exe');
const MAGICK = 'C:\\Program Files\\ImageMagick-7.1.2-Q16-HDRI\\magick.exe';

const DPI = 200;
const SCALE = DPI / 72;             // PDF points → px
const CONCURRENCY = 4;              // páginas procesadas en paralelo
const BATCH = 20;                   // páginas por batch de render

// --- CLI args ---
const args = process.argv.slice(2);
const pdfPath = args.find(a => !a.startsWith('--'));
if (!pdfPath) { console.error('Uso: node extract_pdf_images.js <pdf_path>'); process.exit(1); }
const skuRegexArg = (args.find(a => a.startsWith('--sku-regex=')) || '').replace('--sku-regex=', '') || '\\d{12}';
const outDir = (args.find(a => a.startsWith('--out=')) || '').replace('--out=', '') || path.join(__dirname, '..', 'img_pdf');
const skuRegex = new RegExp('^' + skuRegexArg + '$');

fs.mkdirSync(outDir, { recursive: true });
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfextract-'));
console.log(`→ PDF: ${pdfPath}`);
console.log(`→ Output: ${outDir}`);
console.log(`→ SKU regex: ${skuRegex}`);
console.log(`→ Temp: ${tmpDir}`);

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 50 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });
}

function runSync(cmd, args) {
  return execFileSync(cmd, args, { maxBuffer: 50 * 1024 * 1024 }).toString();
}

async function getPageCount(pdf) {
  const out = await run(PDFINFO, [pdf]);
  const m = out.match(/Pages:\s+(\d+)/);
  return parseInt(m[1], 10);
}

async function renderBatch(pdf, from, to) {
  const prefix = path.join(tmpDir, `p`);
  await run(PDFTOPPM, ['-r', String(DPI), '-jpeg', '-jpegopt', 'quality=85',
    '-f', String(from), '-l', String(to), pdf, prefix]);
  // Returns array of {page, file}
  const files = [];
  for (let p = from; p <= to; p++) {
    // pdftoppm pads with leading zeros based on total pages. Check both common patterns.
    const padded3 = String(p).padStart(3, '0');
    const padded4 = String(p).padStart(4, '0');
    const candidates = [`${prefix}-${padded3}.jpg`, `${prefix}-${padded4}.jpg`, `${prefix}-${p}.jpg`];
    const f = candidates.find(c => fs.existsSync(c));
    if (f) files.push({ page: p, file: f });
  }
  return files;
}

async function extractBboxBatch(pdf, from, to) {
  const out = path.join(tmpDir, `bbox-${from}-${to}.html`);
  await run(PDFTOTEXT, ['-bbox-layout', '-f', String(from), '-l', String(to), pdf, out]);
  const xml = fs.readFileSync(out, 'utf8');
  fs.unlinkSync(out);
  return xml;
}

// Parsea bbox XML y devuelve, por página: {pageNum, width, height, skus: [...], words: [...todas las palabras]}
function parseBboxXml(xml, firstPage) {
  const pages = [];
  let pageNum = firstPage - 1;
  const wordRx = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g;

  const parts = xml.split(/<page /);
  for (let i = 1; i < parts.length; i++) {
    pageNum++;
    const body = '<page ' + parts[i];
    const pm = /<page width="([\d.]+)" height="([\d.]+)">/.exec(body);
    if (!pm) continue;
    const width = parseFloat(pm[1]);
    const height = parseFloat(pm[2]);
    const skus = [];
    const words = [];
    let m;
    wordRx.lastIndex = 0;
    while ((m = wordRx.exec(body)) !== null) {
      const word = { text: m[5].trim(), xMin: +m[1], yMin: +m[2], xMax: +m[3], yMax: +m[4] };
      words.push(word);
      if (skuRegex.test(word.text)) {
        skus.push({ sku: word.text, ...word });
      }
    }
    pages.push({ pageNum, width, height, skus, words });
  }
  return pages;
}

// Para cada SKU: box del producto = región entre el último texto ARRIBA del SKU (nombre del producto)
// y el propio SKU, en la misma columna. Excluye título del PDF y texto decorativo.
function computeCropBoxes(page) {
  const { width, skus, words } = page;
  if (skus.length === 0) return [];
  const midX = width / 2;
  const leftCol = skus.filter(s => (s.xMin + s.xMax) / 2 < midX).sort((a, b) => a.yMin - b.yMin);
  const rightCol = skus.filter(s => (s.xMin + s.xMax) / 2 >= midX).sort((a, b) => a.yMin - b.yMin);

  // Palabras de texto por columna (excluyendo SKUs mismos)
  const leftWords = words.filter(w => !skuRegex.test(w.text) && (w.xMin + w.xMax) / 2 < midX);
  const rightWords = words.filter(w => !skuRegex.test(w.text) && (w.xMin + w.xMax) / 2 >= midX);

  const boxes = [];

  const makeBoxes = (col, colWords, xColStart, xColEnd) => {
    for (let i = 0; i < col.length; i++) {
      const s = col[i];
      const prev = i > 0 ? col[i - 1] : null;
      const prevFloor = prev ? prev.yMax + 4 : 20;

      // Topes: la última palabra cuyo yMax < sku.yMin y yMin > prevFloor
      // Esa palabra es el texto más cercano al SKU (normalmente el nombre/modelo del producto).
      const textsAbove = colWords.filter(w => w.yMax < s.yMin - 2 && w.yMin > prevFloor);
      let topY = prevFloor;
      if (textsAbove.length) {
        const lastYMax = Math.max(...textsAbove.map(w => w.yMax));
        topY = lastYMax + 6;
      }

      const bottomY = s.yMin - 4;
      if (bottomY - topY < 40) continue;
      boxes.push({
        sku: s.sku,
        x: Math.max(8, xColStart),
        y: topY,
        w: Math.min(width, xColEnd) - Math.max(8, xColStart),
        h: bottomY - topY,
      });
    }
  };
  makeBoxes(leftCol, leftWords, 8, midX - 4);
  makeBoxes(rightCol, rightWords, midX + 4, width - 8);
  return boxes;
}

async function cropSave(pageFile, box) {
  const out = path.join(outDir, `${box.sku}.jpg`);
  // PDF points → px. Crop con magick.
  const x = Math.round(box.x * SCALE);
  const y = Math.round(box.y * SCALE);
  const w = Math.round(box.w * SCALE);
  const h = Math.round(box.h * SCALE);
  await run(MAGICK, [pageFile, '-crop', `${w}x${h}+${x}+${y}`, '+repage', '-strip', '-quality', '90', out]);
  return out;
}

async function main() {
  const totalPages = await getPageCount(pdfPath);
  console.log(`→ Total páginas: ${totalPages}`);
  const stats = { pagesProcessed: 0, imagesSaved: 0, errors: 0 };

  for (let start = 1; start <= totalPages; start += BATCH) {
    const end = Math.min(start + BATCH - 1, totalPages);
    process.stdout.write(`  Páginas ${start}-${end}... `);
    try {
      const rendered = await renderBatch(pdfPath, start, end);
      const xml = await extractBboxBatch(pdfPath, start, end);
      const pagesMeta = parseBboxXml(xml, start);

      for (const meta of pagesMeta) {
        const rend = rendered.find(r => r.page === meta.pageNum);
        if (!rend) continue;
        const boxes = computeCropBoxes(meta);
        // paralelizar crops
        const queue = [...boxes];
        const workers = Array.from({ length: CONCURRENCY }, async () => {
          while (queue.length) {
            const b = queue.shift();
            if (!b) return;
            try { await cropSave(rend.file, b); stats.imagesSaved++; }
            catch (e) { stats.errors++; }
          }
        });
        await Promise.all(workers);
        stats.pagesProcessed++;
        // Limpiar el JPG de la página
        try { fs.unlinkSync(rend.file); } catch {}
      }
      console.log(`acum ${stats.imagesSaved} imgs`);
    } catch (e) {
      console.log(`ERR ${e.message.slice(0, 80)}`);
      stats.errors++;
    }
  }

  // Cleanup temp
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  console.log(`\n=== RESULTADO ===`);
  console.log(`Páginas procesadas: ${stats.pagesProcessed}`);
  console.log(`Imágenes extraídas: ${stats.imagesSaved}`);
  console.log(`Errores: ${stats.errors}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

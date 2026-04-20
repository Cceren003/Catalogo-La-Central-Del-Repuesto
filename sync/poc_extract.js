// POC: extract pages 30-33 of VINI PDF to /tmp/poc_out (Windows-friendly path)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const POPPLER = 'C:/Users/cgcer/AppData/Local/Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin';
const MAGICK = 'C:/Program Files/ImageMagick-7.1.2-Q16-HDRI/magick.exe';
const DPI = 200, SCALE = DPI / 72;
const PDF = 'C:/Users/cgcer/OneDrive/MOTOS/CATALOGOS MOTOS GENERAL/CATALAGOS GENERAL/catalogo vini 2026 feb.pdf';
const OUT = 'C:/Users/cgcer/AppData/Local/Temp/poc_out';

fs.mkdirSync(OUT, { recursive: true });

// Render pages 30-33
execFileSync(POPPLER + '/pdftoppm.exe',
  ['-r', '200', '-jpeg', '-jpegopt', 'quality=85', '-f', '30', '-l', '33', PDF, OUT + '/page'],
  { stdio: 'inherit' }
);
console.log('Rendered files:', fs.readdirSync(OUT).filter(f => f.endsWith('.jpg')));

// Extract bbox
execFileSync(POPPLER + '/pdftotext.exe',
  ['-bbox-layout', '-f', '30', '-l', '33', PDF, OUT + '/bbox.html']
);

const xml = fs.readFileSync(OUT + '/bbox.html', 'utf8');
const pagesParts = xml.split(/<page /);
let pageNum = 29;
let totalSaved = 0;
for (let i = 1; i < pagesParts.length; i++) {
  pageNum++;
  const body = '<page ' + pagesParts[i];
  const pm = /<page width="([\d.]+)" height="([\d.]+)">/.exec(body);
  if (!pm) continue;
  const pageW = parseFloat(pm[1]);

  const wordRx = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g;
  const skus = [];
  let m;
  while ((m = wordRx.exec(body)) !== null) {
    const txt = m[5].trim();
    if (/^\d{12}$/.test(txt)) {
      skus.push({ sku: txt, xMin: +m[1], yMin: +m[2], xMax: +m[3], yMax: +m[4] });
    }
  }
  const mid = pageW / 2;
  const left = skus.filter(s => (s.xMin + s.xMax) / 2 < mid).sort((a, b) => a.yMin - b.yMin);
  const right = skus.filter(s => (s.xMin + s.xMax) / 2 >= mid).sort((a, b) => a.yMin - b.yMin);
  const pageFile = OUT + '/page-0' + pageNum + '.jpg';
  console.log(`Page ${pageNum} → ${skus.length} SKUs (L:${left.length} R:${right.length})`);

  function makeBoxes(col, xS, xE) {
    const boxes = [];
    for (let j = 0; j < col.length; j++) {
      const s = col[j];
      const prev = j > 0 ? col[j - 1] : null;
      const topY = prev ? prev.yMax + 8 : 50;
      const bottomY = s.yMin - 4;
      if (bottomY - topY < 40) continue;
      boxes.push({ sku: s.sku, x: Math.max(8, xS), y: Math.max(0, topY), w: Math.min(pageW, xE) - Math.max(8, xS), h: bottomY - topY });
    }
    return boxes;
  }
  const allBoxes = [...makeBoxes(left, 8, mid - 4), ...makeBoxes(right, mid + 4, pageW - 8)];
  for (const b of allBoxes) {
    const x = Math.round(b.x * SCALE), y = Math.round(b.y * SCALE);
    const w = Math.round(b.w * SCALE), h = Math.round(b.h * SCALE);
    execFileSync(MAGICK, [pageFile, '-crop', `${w}x${h}+${x}+${y}`, '+repage', '-strip', '-quality', '90', `${OUT}/${b.sku}.jpg`]);
    totalSaved++;
  }
}
console.log('Total extracted:', totalSaved);

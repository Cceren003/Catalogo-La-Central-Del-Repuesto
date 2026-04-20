#!/usr/bin/env node
// Limpia fondos de img_pdf/ con flood-fill conservador (fuzz 8%).
// NO upscale — las imágenes del PDF ya vienen a buena resolución (~800x400).

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MAGICK = 'C:\\Program Files\\ImageMagick-7.1.2-Q16-HDRI\\magick.exe';
const DIR = path.join(__dirname, '..', 'img_pdf');
const CONCURRENCY = 8;

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(MAGICK, args, { maxBuffer: 10 * 1024 * 1024 }, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

async function clean(file) {
  const fp = path.join(DIR, file);
  // Solo flood desde 4 esquinas con fuzz conservador — respeta silueta del producto
  await run([
    fp,
    '-bordercolor', 'rgb(0,0,0)', '-border', '2',
    '-fuzz', '8%', '-fill', 'white',
    '-floodfill', '+0+0', 'rgb(0,0,0)',
    '-shave', '2x2',
    fp,
  ]);
}

async function main() {
  const files = fs.readdirSync(DIR).filter(f => /\.jpg$/i.test(f));
  console.log(`→ Limpiando ${files.length} imágenes con concurrencia ${CONCURRENCY}...`);

  let done = 0, errors = 0;
  const queue = [...files];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const f = queue.shift();
      if (!f) return;
      try { await clean(f); done++; }
      catch (e) { errors++; }
      if (done % 200 === 0) console.log(`  ... ${done} limpiadas`);
    }
  });
  await Promise.all(workers);
  console.log(`\n✓ ${done} limpiadas, ${errors} errores`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

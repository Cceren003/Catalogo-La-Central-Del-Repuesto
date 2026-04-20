#!/usr/bin/env node
// Batch processor para img/:
//   1) Convierte fondo negro/oscuro → blanco (flood-fill desde bordes con fuzz 15%)
//   2) Upscale imágenes de baja resolución (<200x200) a 400x400 mínimo con Lanczos
// Backup automático a img_backup/ antes de tocar nada.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MAGICK = 'C:\\Program Files\\ImageMagick-7.1.2-Q16-HDRI\\magick.exe';
const IMG_DIR = path.join(__dirname, '..', 'img');
const BACKUP_DIR = path.join(__dirname, '..', 'img_backup');
const CONCURRENCY = 6;

const DARK_THRESHOLD = 40;    // avg corner brightness (0-255)
const FUZZ = '8%';            // más conservador — evita comerse el producto
const DO_UPSCALE = false;     // upscale desactivado — interpolación hace imgs chicas verse borrosas

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(MAGICK, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout.toString().trim());
    });
  });
}

async function analyze(filePath) {
  // Una sola invocación: retorna "avgCornerBrightness|width|height"
  const fmt = '%[fx:(u.p{0,0}.r+u.p{0,0}.g+u.p{0,0}.b+u.p{9,0}.r+u.p{9,0}.g+u.p{9,0}.b+u.p{0,9}.r+u.p{0,9}.g+u.p{0,9}.b+u.p{9,9}.r+u.p{9,9}.g+u.p{9,9}.b)*255/12]|%w|%h';
  const out = await run([filePath, '-resize', '10x10!', '-format', fmt, 'info:']);
  // Algunos casos el fx devuelve valores redondeados raros. Forzamos 0 mínimo.
  const [b, w, h] = out.split('|');
  return { brightness: Math.max(0, parseFloat(b)), width: +w, height: +h };
}

async function convertDarkToWhite(filePath) {
  await run([
    filePath,
    '-bordercolor', 'rgb(0,0,0)', '-border', '2',
    '-fuzz', FUZZ, '-fill', 'white',
    '-floodfill', '+0+0', 'rgb(0,0,0)',
    '-shave', '2x2',
    filePath,
  ]);
}

async function upscale(filePath, targetW, targetH) {
  // '<' = solo agrandar si es más chica (no shrink imágenes grandes)
  await run([
    filePath,
    '-filter', 'Lanczos',
    '-resize', `${targetW}x${targetH}<`,
    '-unsharp', '0x0.75+0.75+0.008',
    filePath,
  ]);
}

async function processOne(file, stats) {
  const fp = path.join(IMG_DIR, file);
  try {
    const { brightness, width, height } = await analyze(fp);
    stats.total++;

    if (brightness < DARK_THRESHOLD) {
      stats.darkBg++;
      await convertDarkToWhite(fp);
      stats.converted++;
    }
    if (DO_UPSCALE) {
      // Placeholder — activar solo si querés reintentar upscale controlado
      // const ratio = ...; await upscale(fp, ...); stats.upscaled++;
    }
  } catch (e) {
    stats.errors++;
    stats.errorList.push({ file, err: e.message.slice(0, 120) });
  }
  if (stats.total % 100 === 0) {
    console.log(`  ... ${stats.total} procesadas | ${stats.converted} convertidas a blanco | ${stats.upscaled} escaladas`);
  }
}

async function main() {
  // Backup (solo la primera vez)
  if (!fs.existsSync(BACKUP_DIR)) {
    console.log('→ Creando backup en img_backup/ ...');
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const allFiles = fs.readdirSync(IMG_DIR);
    for (const f of allFiles) {
      fs.copyFileSync(path.join(IMG_DIR, f), path.join(BACKUP_DIR, f));
    }
    console.log(`✓ Backup creado (${allFiles.length} archivos)`);
  } else {
    console.log(`ℹ Ya existe img_backup/ — procesando sobre img/ directamente (tocarlo de nuevo modifica lo que ya fue tocado antes).`);
  }

  const files = fs.readdirSync(IMG_DIR).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  console.log(`→ Procesando ${files.length} imágenes con concurrencia ${CONCURRENCY}...`);

  const stats = { total: 0, darkBg: 0, converted: 0, lowRes: 0, upscaled: 0, errors: 0, errorList: [] };
  const queue = [...files];

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const f = queue.shift();
      if (f) await processOne(f, stats);
    }
  });
  await Promise.all(workers);

  console.log('\n=== RESULTADO ===');
  console.log(`Total procesadas:       ${stats.total}`);
  console.log(`Con fondo oscuro:       ${stats.darkBg}`);
  console.log(`Convertidas a blanco:   ${stats.converted}`);
  console.log(`Baja resolución:        ${stats.lowRes}`);
  console.log(`Upscaled:               ${stats.upscaled} (desactivado en este modo)`);
  console.log(`Errors:                 ${stats.errors}`);
  if (stats.errorList.length) {
    console.log('\nPrimeros errores:');
    stats.errorList.slice(0, 10).forEach(e => console.log(' ', e.file, '→', e.err));
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

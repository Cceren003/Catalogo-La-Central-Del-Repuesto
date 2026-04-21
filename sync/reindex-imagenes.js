#!/usr/bin/env node
// Reindex de imágenes — actualiza solo `imagen` e `imagen_size` en catalogo.json.
// No toca precios, stock, ni ningún otro campo. No requiere credenciales ni red.
//
// Uso:
//   node sync/reindex-imagenes.js                    # aplica sobre el repo padre
//   node sync/reindex-imagenes.js --dry-run          # solo reporta
//   node sync/reindex-imagenes.js --root <path>      # apunta a otra worktree
//   node sync/reindex-imagenes.js --root <path> --dry-run

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const rootIdx = args.indexOf('--root');
const ROOT = rootIdx >= 0 && args[rootIdx + 1]
  ? path.resolve(args[rootIdx + 1])
  : path.join(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'imagenes');
const CATALOG_PATH = path.join(ROOT, 'catalogo.json');

// Construye el índice de imágenes. Si hay duplicados (mismo SKU con distintas
// extensiones), los reporta por separado — el último en el orden del filesystem
// gana en el Map pero el usuario debe decidir cuál dejar.
function buildImgIndex() {
  if (!fs.existsSync(IMG_DIR)) {
    console.error(`✗ No existe la carpeta ${IMG_DIR}`);
    process.exit(1);
  }
  const index = new Map();
  const duplicates = new Map();
  for (const f of fs.readdirSync(IMG_DIR)) {
    const m = f.match(/^(.+)\.(jpg|jpeg|png|webp)$/i);
    if (!m) continue;
    const key = m[1].toUpperCase();
    let size = 0;
    try { size = fs.statSync(path.join(IMG_DIR, f)).size; } catch {}
    if (index.has(key)) {
      if (!duplicates.has(key)) duplicates.set(key, [index.get(key).path]);
      duplicates.get(key).push(`imagenes/${f}`);
    }
    index.set(key, { path: `imagenes/${f}`, size });
  }
  return { index, duplicates };
}

function main() {
  console.log(`Reindex de imágenes${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`→ Root: ${ROOT}`);

  if (!fs.existsSync(CATALOG_PATH)) {
    console.error(`✗ No existe ${CATALOG_PATH}`);
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  if (!Array.isArray(catalog.productos)) {
    console.error('✗ catalogo.json no tiene un array `productos`');
    process.exit(1);
  }

  const { index, duplicates } = buildImgIndex();
  console.log(`→ Índice: ${index.size} SKUs únicos en imagenes/`);
  console.log(`→ Catálogo: ${catalog.productos.length} productos`);

  if (duplicates.size > 0) {
    console.log('');
    console.log(`⚠ ${duplicates.size} SKU(s) con archivos duplicados (distinta extensión):`);
    for (const [sku, paths] of duplicates) {
      console.log(`  ${sku}: ${paths.join(' + ')}`);
    }
    console.log('  → El último en orden alfabético gana. Borra los que sobran.');
  }

  let ganaron = 0;          // antes sin imagen, ahora sí
  let perdieron = 0;        // antes con imagen, ahora no
  let tamanoCambio = 0;     // misma imagen, distinto tamaño
  let rutaCambio = 0;       // extensión o nombre distinto
  const ejemplosGanaron = [];
  const ejemplosPerdieron = [];

  for (const p of catalog.productos) {
    const key = (p.sku || '').toString().trim().toUpperCase();
    const entry = index.get(key);
    const nuevoPath = entry?.path || '';
    const nuevoSize = entry?.size || 0;
    const prevPath = p.imagen || '';
    const prevSize = p.imagen_size || 0;

    if (!prevPath && nuevoPath) {
      ganaron++;
      if (ejemplosGanaron.length < 5) ejemplosGanaron.push(p.sku);
    } else if (prevPath && !nuevoPath) {
      perdieron++;
      if (ejemplosPerdieron.length < 5) ejemplosPerdieron.push(p.sku);
    } else if (prevPath && nuevoPath) {
      if (prevPath !== nuevoPath) rutaCambio++;
      else if (prevSize !== nuevoSize) tamanoCambio++;
    }

    p.imagen = nuevoPath;
    p.imagen_size = nuevoSize;
  }

  const totalConImagen = catalog.productos.filter(p => p.imagen).length;
  const cobertura = ((totalConImagen / catalog.productos.length) * 100).toFixed(1);

  console.log('');
  console.log('Cambios:');
  console.log(`  + ${ganaron} productos ganaron imagen${ejemplosGanaron.length ? ` (ej: ${ejemplosGanaron.join(', ')})` : ''}`);
  console.log(`  - ${perdieron} productos perdieron imagen${ejemplosPerdieron.length ? ` (ej: ${ejemplosPerdieron.join(', ')})` : ''}`);
  console.log(`  ~ ${rutaCambio} cambiaron de ruta (extensión/nombre)`);
  console.log(`  ~ ${tamanoCambio} cambiaron de tamaño (misma ruta, archivo distinto)`);
  console.log('');
  console.log(`Cobertura: ${totalConImagen}/${catalog.productos.length} (${cobertura}%)`);

  const huboCambios = ganaron + perdieron + rutaCambio + tamanoCambio > 0;

  if (DRY_RUN) {
    console.log('\nDRY RUN — no se escribió catalogo.json');
    return;
  }

  if (!huboCambios) {
    console.log('\n✓ Sin cambios — catalogo.json no se modifica');
    return;
  }

  catalog.generated_at = new Date().toISOString();
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`\n✓ Escrito ${CATALOG_PATH}`);
}

try {
  main();
} catch (err) {
  console.error('\n✗ ERROR:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
}

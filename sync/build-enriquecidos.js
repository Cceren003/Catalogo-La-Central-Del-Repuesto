#!/usr/bin/env node
// sync/build-enriquecidos.js
// Convierte sync/enriquecidos.xlsx → data/enriquecidos.json
//
// Hojas esperadas (nombres insensibles a mayúsculas):
//   Compatibilidades: SKU | Marca | Modelo | Años
//   Equivalencias:    SKU | SKU_Equivalente
//   Relacionados:     SKU | SKU_Relacionado
//
// Filas que arrancan con "//" en la primera columna se ignoran (comentarios).
// Líneas vacías se ignoran.
//
// Correr:  node sync/build-enriquecidos.js
//          npm run build-enriquecidos (desde sync/)

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SRC = path.join(__dirname, 'enriquecidos.xlsx');
const OUT = path.join(__dirname, '..', 'data', 'enriquecidos.json');

function norm(v) {
  if (v == null) return '';
  return v.toString().trim();
}

// "2018-2023, 2015" → [2015, 2018, 2019, ..., 2023]
// "2020"           → [2020]
// "2018,2020"      → [2018, 2020]
function parseAnios(input) {
  const s = norm(input);
  if (!s) return [];
  const set = new Set();
  for (const chunk of s.split(/[,;]/)) {
    const c = chunk.trim();
    if (!c) continue;
    const m = c.match(/^(\d{4})\s*-\s*(\d{4})$/);
    if (m) {
      const a = +m[1], b = +m[2];
      for (let y = Math.min(a, b); y <= Math.max(a, b); y++) set.add(y);
    } else if (/^\d{4}$/.test(c)) {
      set.add(+c);
    } else {
      console.warn(`  ⚠ Año ignorado: "${c}"`);
    }
  }
  return [...set].sort((a, b) => a - b);
}

// Encuentra la hoja por nombre, sin importar mayúsculas/acentos
function findSheet(wb, target) {
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const wanted = norm(target);
  const name = wb.SheetNames.find(n => norm(n) === wanted);
  return name ? wb.Sheets[name] : null;
}

function readSheet(wb, name) {
  const ws = findSheet(wb, name);
  if (!ws) {
    console.warn(`  ⚠ No se encontró hoja "${name}" — se omite`);
    return [];
  }
  return XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });
}

// Normaliza el nombre de la columna (case/accent insensitive)
function col(row, names) {
  const keys = Object.keys(row);
  const want = names.map(n => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  for (const k of keys) {
    const norm = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (want.includes(norm)) return row[k];
  }
  return '';
}

function isComment(row) {
  const first = Object.values(row).find(v => v != null && v !== '');
  return typeof first === 'string' && first.trim().startsWith('//');
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`✗ No existe ${SRC}`);
    console.error('  Copiá enriquecidos-template.xlsx → enriquecidos.xlsx y llenalo.');
    process.exit(1);
  }

  console.log(`→ Leyendo ${SRC}`);
  const wb = XLSX.readFile(SRC);
  console.log(`→ Hojas encontradas: ${wb.SheetNames.join(', ')}`);

  const out = {};
  const slot = sku => (out[sku] ??= { compatibilidades: [], equivalencias: [], relacionados: [] });

  // ─── Compatibilidades ──────────────────────────────────────────
  const compatRows = readSheet(wb, 'Compatibilidades');
  let compatCount = 0, compatSkipped = 0;
  for (const r of compatRows) {
    if (isComment(r)) continue;
    const sku    = norm(col(r, ['SKU', 'sku']));
    const marca  = norm(col(r, ['Marca', 'marca']));
    const modelo = norm(col(r, ['Modelo', 'modelo']));
    const anios  = parseAnios(col(r, ['Años', 'Anios', 'anios']));
    if (!sku) { compatSkipped++; continue; }
    if (!marca && !modelo) { compatSkipped++; continue; }
    slot(sku).compatibilidades.push({ marca, modelo, anios });
    compatCount++;
  }

  // ─── Equivalencias (bidireccional) ─────────────────────────────
  // Si Excel tiene A → B (con nota opcional en la dirección original):
  //   - A.equivalencias incluye { sku: B, nota? }
  //   - B.equivalencias incluye { sku: A }   ← SIN nota (es la inversa)
  // Dedup por SKU destino. Si el Excel ya declara B → A explícitamente,
  // gana la versión con nota del Excel (no se sobrescribe con la inversa).
  const equivRows = readSheet(wb, 'Equivalencias');
  let equivForward = 0, equivInverse = 0, equivSkipped = 0;

  function upsertEquiv(fromSku, toSku, nota, isOriginal) {
    const arr = slot(fromSku).equivalencias;
    const existing = arr.find(e => e.sku === toSku);
    if (existing) {
      // Ya existe. Solo actualiza nota si viene del Excel original y no había.
      if (isOriginal && nota && !existing.nota) existing.nota = nota;
      return false;
    }
    const entry = { sku: toSku };
    if (isOriginal && nota) entry.nota = nota;
    arr.push(entry);
    return true;
  }

  for (const r of equivRows) {
    if (isComment(r)) continue;
    const sku  = norm(col(r, ['SKU', 'sku']));
    const eq   = norm(col(r, ['SKU_Equivalente', 'SKU equivalente', 'Equivalente']));
    const nota = norm(col(r, ['Nota', 'nota', 'Nota (opcional)']));
    if (!sku || !eq) { equivSkipped++; continue; }
    if (sku === eq) { equivSkipped++; continue; } // auto-referencia
    if (upsertEquiv(sku, eq, nota, true))  equivForward++;
    if (upsertEquiv(eq, sku, '',   false)) equivInverse++;
  }

  // ─── Relacionados ──────────────────────────────────────────────
  const relRows = readSheet(wb, 'Relacionados');
  let relCount = 0, relSkipped = 0;
  for (const r of relRows) {
    if (isComment(r)) continue;
    const sku = norm(col(r, ['SKU', 'sku']));
    const rel = norm(col(r, ['SKU_Relacionado', 'SKU relacionado', 'Relacionado']));
    if (!sku || !rel) { relSkipped++; continue; }
    if (!slot(sku).relacionados.includes(rel)) {
      slot(sku).relacionados.push(rel);
      relCount++;
    }
  }

  // ─── Limpieza: quita arrays vacíos del output ──────────────────
  const clean = {};
  for (const [sku, data] of Object.entries(out)) {
    const c = {};
    if (data.compatibilidades.length) c.compatibilidades = data.compatibilidades;
    if (data.equivalencias.length)    c.equivalencias    = data.equivalencias;
    if (data.relacionados.length)     c.relacionados     = data.relacionados;
    if (Object.keys(c).length > 0) clean[sku] = c;
  }

  const final = {
    _formato: {
      generado_en: new Date().toISOString(),
      origen: 'sync/enriquecidos.xlsx (vía sync/build-enriquecidos.js)',
      cantidad_productos: Object.keys(clean).length,
      advertencia: 'NO editar a mano. Se regenera desde el Excel. Para cambios, editá sync/enriquecidos.xlsx y corré build-enriquecidos.js.',
    },
    ...clean,
  };

  fs.writeFileSync(OUT, JSON.stringify(final, null, 2), 'utf8');

  console.log('');
  console.log(`✓ ${OUT}`);
  console.log(`  · ${Object.keys(clean).length} productos enriquecidos`);
  console.log(`  · ${compatCount} compatibilidades (omitidas: ${compatSkipped})`);
  console.log(`  · ${equivForward} equivalencias + ${equivInverse} inversas auto-generadas (omitidas: ${equivSkipped})`);
  console.log(`  · ${relCount} relacionados     (omitidas: ${relSkipped})`);

  // ─── Validación vs catalogo.json (si existe) ───────────────────
  // Detecta SKUs escritos en el Excel que ya no están en el catálogo actual
  // (producto dado de baja, SKU cambiado, etc.). NO falla el build — solo avisa.
  const CATALOG_PATH = path.join(__dirname, '..', 'catalogo.json');
  if (!fs.existsSync(CATALOG_PATH)) return;

  let cat;
  try { cat = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')); }
  catch { return; }
  const catalogSkus = new Set((cat.productos || []).map(p => p.sku));

  const missing = new Set();
  for (const [sku, data] of Object.entries(clean)) {
    if (!catalogSkus.has(sku)) missing.add(sku);
    for (const e of data.equivalencias || []) {
      const s = typeof e === 'string' ? e : e.sku;
      if (s && !catalogSkus.has(s)) missing.add(s);
    }
    for (const r of data.relacionados || []) {
      const s = typeof r === 'string' ? r : r.sku;
      if (s && !catalogSkus.has(s)) missing.add(s);
    }
  }

  if (missing.size === 0) return;
  console.log('');
  console.log(`⚠  ${missing.size} SKU(s) referenciados en el Excel NO existen en catalogo.json:`);
  [...missing].sort().forEach(s => console.log(`    · ${s}`));
  console.log('   Esas equivalencias/relacionados se OCULTAN en la ficha web.');
  console.log('   Acciones sugeridas:');
  console.log('     - Verificá si el SKU se dio de baja en LCR');
  console.log('     - Revisá si hay typo en sync/enriquecidos.xlsx');
  console.log('     - Si el SKU ya no existe, borralo del Excel y corré de nuevo');
}

try { main(); } catch (err) {
  console.error('\n✗ ERROR:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
}

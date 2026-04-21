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

  // ─── Equivalencias ─────────────────────────────────────────────
  const equivRows = readSheet(wb, 'Equivalencias');
  let equivCount = 0, equivSkipped = 0;
  for (const r of equivRows) {
    if (isComment(r)) continue;
    const sku = norm(col(r, ['SKU', 'sku']));
    const eq  = norm(col(r, ['SKU_Equivalente', 'SKU equivalente', 'Equivalente']));
    if (!sku || !eq) { equivSkipped++; continue; }
    if (!slot(sku).equivalencias.includes(eq)) {
      slot(sku).equivalencias.push(eq);
      equivCount++;
    }
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
  console.log(`  · ${equivCount} equivalencias    (omitidas: ${equivSkipped})`);
  console.log(`  · ${relCount} relacionados     (omitidas: ${relSkipped})`);
}

try { main(); } catch (err) {
  console.error('\n✗ ERROR:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
}

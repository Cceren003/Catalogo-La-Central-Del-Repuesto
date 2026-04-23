#!/usr/bin/env node
// Recategoriza productos VINI usando las secciones del PDF ilustrado.
//
// Pipeline:
//   1. Lee mapeo sección→categoría (sólido automático + overrides manuales)
//   2. Para cada sección, mapea a la categoría final (normalizando typos)
//   3. Para cada SKU VINI del catálogo:
//      - Si está en el PDF → categoría según sección
//      - Si no → mantiene inferCategoria() actual
//   4. Escribe catalogo.json
//
// Uso: node recategorize-vini.js [--dry-run]

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT = path.join(__dirname, '..');

const sectionMap = require('./vini-section-map.json');
const skuPages = require('./vini-sku-pages.json');
const catalogoPath = path.join(ROOT, 'catalogo.json');
const catalogo = JSON.parse(fs.readFileSync(catalogoPath, 'utf8'));

// ─── Normalización de typos conocidos ────────────────────────────────
// El usuario va a arreglar estos en el sistema LCR; mientras tanto, escribimos
// las versiones normalizadas en VINI para que queden unificadas cuando
// LCR se actualice.
const NORMALIZE = {
  'SUSPENCION': 'SUSPENSION',
  'MISELANEA': 'MISCELANEA',
};
function normalizar(cat) {
  return NORMALIZE[cat] || cat;
}

// ─── Overrides manuales ──────────────────────────────────────────────
// A) 4 ambiguas: elegimos según lógica/dominancia
// B) 36 sin ground truth: asignadas por familia (ver recomendación validada)
const OVERRIDES = {
  // Ambiguas — resolvemos manualmente
  'SET HULE MASA':        'REPUESTOS',
  'CATARINA Y PIÑON':     'KIT TRACCION',
  'MANECILLA DE CLUTCH':  'EMBRAGUE',
  'CAJA VELOCIMETRO':     'REPUESTOS',

  // Sin ground truth — Motor
  'KIT DE BIELA':                   'MOTOR',
  'ANILLO DE PISTÓN':               'MOTOR',
  'ARBOL DE LEVAS MODIFICADO':      'MOTOR',
  'LEVA SUPERIOR':                  'MOTOR',
  'KIT DE DISTRIBUCIÓN DE TIEMPO':  'MOTOR',
  'EMBOLO CARBURADOR':              'MOTOR',
  'CARBURADOR COMPLETO':            'MOTOR',
  'DIAFRAGMA CARBURADOR':           'MOTOR',
  'SET GUIA DE VALVULA':            'MOTOR',
  'RESORTE VALVULA':                'MOTOR',
  'BAYONETA ACEITE':                'MOTOR',

  // Frenos
  'RESORTE FRENO':                  'FRENOS',

  // Llantas y tubos
  'TUBO':                           'LLANTAS Y TUBOS',

  // Baleros
  'MASA DELANTERA':                 'BALEROS',
  'MASA TRASERA':                   'BALEROS',

  // Suspensión (normalizado, no typo)
  'SET BARRA DELANTERA':            'SUSPENSION',
  'SET DE NIQUEL DE BARRA':         'SUSPENSION',

  // Kit tracción
  'KIT TRACCION':                   'KIT TRACCION',

  // Eléctricos
  'MASCARA Y SILVIN COMPLETO':      'ELECTRICOS',
  'SILVIN COMPLETO':                'ELECTRICOS',
  'HALOGENO LED':                   'ELECTRICOS',
  'MASCARA SILVIN':                 'ELECTRICOS',
  'TIRA LED VERDE':                 'ELECTRICOS',
  'TIRA LED AZUL':                  'ELECTRICOS',
  'BOMBILLO STOP':                  'ELECTRICOS',
  'STOP COMPLETO':                  'ELECTRICOS',
  'COVERTOR TRASERO STOP':          'ELECTRICOS',
  'SET COVERTOR DE STOP':           'ELECTRICOS',

  // Escapes (categoría propia)
  'ESCAPE COMPLETO':                'ESCAPES',

  // Carrocería
  'ARO MAGNECIO DELANTERO':         'CARROCERIA',
  'TANQUE DE GAS':                  'CARROCERIA',
  'SET COVERTOR DE TANQUE':         'CARROCERIA',
  'SET TAPA LATERAL':               'CARROCERIA',
  'LODERA TRASERA':                 'CARROCERIA',
  'LODERA DELANTERA':               'CARROCERIA',
  'TOLVAS DE PECHERA':              'CARROCERIA',
};

// ─── Construir mapa final: sección → categoría ───────────────────────
// Un SKU puede aparecer en varias secciones (rangos solapados). Prioridad:
//   1. Sección con override explícito
//   2. Sección más específica (menos páginas)
//   3. Sección con mapeo sólido

const allSections = [...sectionMap.solido, ...sectionMap.ambiguo, ...sectionMap.sinLcr];

// Limpia prefijos numéricos residuales del parser de índice
// ("21 KIT DE BIELA" → "KIT DE BIELA", "246~247 MASCARA..." → "MASCARA...")
function cleanSectionName(name) {
  return name.replace(/^(\d+\s*~?\s*\d*\s+)+/, '').trim();
}

// Agregar secciones que faltaban en mi análisis inicial
const EXTRA_OVERRIDES = {
  'ARO MAGNECIO TRASERO': 'CARROCERIA', // equivalente a delantero
  'CABLE INTERNO CLUTCH': 'CABLES',
  'CABLE INTERNO VELOCIDAD': 'CABLES',
};
Object.assign(OVERRIDES, EXTRA_OVERRIDES);

// Para cada sección, determina su categoría final
for (const s of allSections) {
  const cleanName = cleanSectionName(s.seccion);
  if (OVERRIDES[cleanName]) {
    s.categoria_final = OVERRIDES[cleanName];
    s.origen = 'override';
  } else if (OVERRIDES[s.seccion]) {
    s.categoria_final = OVERRIDES[s.seccion];
    s.origen = 'override';
  } else if (s.categoria_lcr_top && s.skus_en_lcr >= 2) {
    s.categoria_final = normalizar(s.categoria_lcr_top);
    s.origen = 'lcr';
  } else {
    s.categoria_final = null;
    s.origen = 'sin-mapeo';
  }
  // Guardar nombre limpio para el match de palabras
  s.seccionClean = cleanName;
}

// ─── SKU → mejor sección ─────────────────────────────────────────────
// Cuando un SKU cae en varias secciones solapadas (ej. p.195 tiene ARO
// MAGNECIO y CABLE INTERNO), matchear por palabras del NOMBRE del producto
// contra palabras de la sección es mucho más preciso que solo por rango.
// "Stop words" = palabras genéricas que no deberían contar para el match.
const STOP_WORDS = new Set([
  'DE','DEL','LA','EL','Y','O','A','CON','SET','KIT','COMPLETO','COMPLETA',
  'PARA','POR','EN','VINI','FL','RC','TVS','YAMAHA','HONDA','SUZUKI','BAJAJ',
]);

function tokenize(s) {
  return (s || '').toString().toUpperCase()
    .replace(/[^\w\sÑÁÉÍÓÚÜ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

function bestSectionForSku(pg, prodNombre) {
  const candidates = allSections.filter(s =>
    pg >= s.pgStart && pg <= s.pgEnd && s.categoria_final
  );
  if (candidates.length === 0) return null;

  const prodWords = new Set(tokenize(prodNombre));
  for (const c of candidates) {
    const secWords = tokenize(c.seccionClean || c.seccion);
    let matches = 0;
    for (const w of secWords) if (prodWords.has(w)) matches++;
    c.score = matches;
    c.secWordCount = secWords.length;
  }
  candidates.sort((a, b) => {
    // 1) más palabras en común con el nombre del producto
    if (b.score !== a.score) return b.score - a.score;
    // 2) mayor fracción de palabras de la sección matcheadas
    const fa = a.secWordCount ? a.score / a.secWordCount : 0;
    const fb = b.secWordCount ? b.score / b.secWordCount : 0;
    if (fb !== fa) return fb - fa;
    // 3) menor rango (más específica)
    return (a.pgEnd - a.pgStart) - (b.pgEnd - b.pgStart);
  });
  return candidates[0];
}

// ─── Aplicar a catalogo.json ─────────────────────────────────────────
const skuToPage = skuPages.sku_to_page;
const stats = {
  vini_total: 0,
  categorizado_pdf: 0,
  categorizado_sin_pdf: 0,
  cambio_categoria: 0,
  mismo_valor: 0,
  cambios_por: { nueva: {}, desde: {} },
};

const ejemplosCambios = [];

for (const p of catalogo.productos) {
  if ((p.fuente || 'LCR') !== 'VINI') continue;
  stats.vini_total++;

  const sku = String(p.sku);
  const pg = skuToPage[sku];
  let nuevaCat = null;
  if (pg) {
    const sec = bestSectionForSku(pg, p.nombre);
    if (sec) {
      nuevaCat = sec.categoria_final;
      stats.categorizado_pdf++;
    }
  }
  if (!nuevaCat) {
    stats.categorizado_sin_pdf++;
    continue; // mantener la existente
  }
  if (p.categoria !== nuevaCat) {
    const key = `${p.categoria} → ${nuevaCat}`;
    stats.cambios_por.desde[p.categoria] = (stats.cambios_por.desde[p.categoria] || 0) + 1;
    stats.cambios_por.nueva[nuevaCat] = (stats.cambios_por.nueva[nuevaCat] || 0) + 1;
    stats.cambio_categoria++;
    if (ejemplosCambios.length < 20) {
      ejemplosCambios.push({ sku, nombre: p.nombre, de: p.categoria, a: nuevaCat });
    }
    p.categoria = nuevaCat; // aplicar también en dry-run para ver proyección
  } else {
    stats.mismo_valor++;
  }
}

// ─── Reporte ────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════');
console.log(`  Recategorización VINI${DRY_RUN ? ' (DRY-RUN)' : ''}`);
console.log('═══════════════════════════════════════════════════');
console.log(`VINI total: ${stats.vini_total}`);
console.log(`  · Categorizado vía PDF:     ${stats.categorizado_pdf}`);
console.log(`  · Mantiene inferencia:      ${stats.categorizado_sin_pdf}`);
console.log(`  · Cambió categoría:         ${stats.cambio_categoria}`);
console.log(`  · Ya tenía la correcta:     ${stats.mismo_valor}`);

console.log('\n─── Categorías DE DÓNDE vienen los cambios ───');
Object.entries(stats.cambios_por.desde).sort((a, b) => b[1] - a[1]).forEach(([c, n]) =>
  console.log(`  ${n.toString().padStart(4)}  ← ${c}`));

console.log('\n─── Categorías HACIA DÓNDE van ───');
Object.entries(stats.cambios_por.nueva).sort((a, b) => b[1] - a[1]).forEach(([c, n]) =>
  console.log(`  ${n.toString().padStart(4)}  → ${c}`));

console.log('\n─── Ejemplos (20) ───');
ejemplosCambios.forEach(e =>
  console.log(`  ${e.sku}  [${e.de} → ${e.a}]  ${e.nombre}`));

// Distribución VINI post-cambio
console.log('\n─── Distribución VINI DESPUÉS ───');
const postCats = {};
for (const p of catalogo.productos) {
  if ((p.fuente || 'LCR') === 'VINI') postCats[p.categoria] = (postCats[p.categoria] || 0) + 1;
}
Object.entries(postCats).sort((a, b) => b[1] - a[1]).forEach(([c, n]) =>
  console.log(`  ${n.toString().padStart(5)}  ${c}`));

if (!DRY_RUN) {
  fs.writeFileSync(catalogoPath, JSON.stringify(catalogo, null, 2));
  console.log(`\n✓ catalogo.json actualizado`);
} else {
  console.log('\n(DRY-RUN — no se escribió catalogo.json)');
}

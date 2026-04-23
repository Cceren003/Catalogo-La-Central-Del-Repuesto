#!/usr/bin/env node
// Recategoriza productos VINI usando las secciones del PDF ilustrado.
//
// Uso como módulo:
//   const { getViniCategoria } = require('./recategorize-vini.js');
//   const cat = getViniCategoria(sku, nombre, fallback);
//
// Uso como CLI (standalone, aplica a catalogo.json):
//   node recategorize-vini.js [--dry-run]

const fs = require('fs');
const path = require('path');

// ─── Normalización de typos conocidos ────────────────────────────────
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
// C) 3 extras agregados post-análisis (cubrir páginas densas)
const OVERRIDES = {
  // Ambiguas
  'SET HULE MASA':        'REPUESTOS',
  'CATARINA Y PIÑON':     'KIT TRACCION',
  'MANECILLA DE CLUTCH':  'EMBRAGUE',
  'CAJA VELOCIMETRO':     'REPUESTOS',

  // Motor
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

  // Llantas
  'TUBO':                           'LLANTAS Y TUBOS',

  // Baleros
  'MASA DELANTERA':                 'BALEROS',
  'MASA TRASERA':                   'BALEROS',

  // Suspensión
  'SET BARRA DELANTERA':            'SUSPENSION',
  'SET DE NIQUEL DE BARRA':         'SUSPENSION',

  // Tracción
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

  // Escapes
  'ESCAPE COMPLETO':                'ESCAPES',

  // Carrocería
  'ARO MAGNECIO DELANTERO':         'CARROCERIA',
  'ARO MAGNECIO TRASERO':           'CARROCERIA',
  'TANQUE DE GAS':                  'CARROCERIA',
  'SET COVERTOR DE TANQUE':         'CARROCERIA',
  'SET TAPA LATERAL':               'CARROCERIA',
  'LODERA TRASERA':                 'CARROCERIA',
  'LODERA DELANTERA':               'CARROCERIA',
  'TOLVAS DE PECHERA':              'CARROCERIA',

  // Cables (secciones de página 195 que no tenían mapeo)
  'CABLE INTERNO CLUTCH':           'CABLES',
  'CABLE INTERNO VELOCIDAD':        'CABLES',

  // LCR tiene "RELOJ ASPIROMETRO" en ESPEJOS (datos mezclados con otros
  // productos de la misma página). Override a ELECTRICOS — los relojes son
  // instrumentos eléctricos.
  'RELOJ ASPIROMETRO':              'ELECTRICOS',
};

// ─── Helpers ─────────────────────────────────────────────────────────
function cleanSectionName(name) {
  return name.replace(/^(\d+\s*~?\s*\d*\s+)+/, '').trim();
}

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

// ─── Carga perezosa de datos auxiliares ──────────────────────────────
let _loaded = null;
function loadData() {
  if (_loaded !== null) return _loaded;
  const mapPath = path.join(__dirname, 'vini-section-map.json');
  const pagesPath = path.join(__dirname, 'vini-sku-pages.json');
  if (!fs.existsSync(mapPath) || !fs.existsSync(pagesPath)) {
    _loaded = false; // archivos auxiliares no disponibles — fallback
    return _loaded;
  }
  const sectionMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const skuPages = JSON.parse(fs.readFileSync(pagesPath, 'utf8'));

  const allSections = [...sectionMap.solido, ...sectionMap.ambiguo, ...sectionMap.sinLcr];
  for (const s of allSections) {
    const cleanName = cleanSectionName(s.seccion);
    s.seccionClean = cleanName;
    if (OVERRIDES[cleanName]) {
      s.categoria_final = OVERRIDES[cleanName];
    } else if (OVERRIDES[s.seccion]) {
      s.categoria_final = OVERRIDES[s.seccion];
    } else if (s.categoria_lcr_top && s.skus_en_lcr >= 2) {
      s.categoria_final = normalizar(s.categoria_lcr_top);
    } else {
      s.categoria_final = null;
    }
  }

  _loaded = {
    allSections,
    skuToPage: skuPages.sku_to_page,
  };
  return _loaded;
}

function bestSectionForSku(pg, prodNombre, allSections) {
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
    if (b.score !== a.score) return b.score - a.score;
    const fa = a.secWordCount ? a.score / a.secWordCount : 0;
    const fb = b.secWordCount ? b.score / b.secWordCount : 0;
    if (fb !== fa) return fb - fa;
    return (a.pgEnd - a.pgStart) - (b.pgEnd - b.pgStart);
  });
  return candidates[0];
}

// ─── API pública ─────────────────────────────────────────────────────
// Devuelve la categoría para un SKU VINI usando el mapeo del PDF, con
// fallback al valor `fallback` (típicamente inferCategoria(nombre)) si:
//   · el SKU no aparece en el PDF, o
//   · los archivos auxiliares no existen (ej. ambiente sin setup), o
//   · la sección no tiene categoría asignada.
function getViniCategoria(sku, nombre, fallback) {
  const data = loadData();
  if (!data) return fallback;
  const pg = data.skuToPage[String(sku)];
  if (!pg) return fallback;
  const sec = bestSectionForSku(pg, nombre, data.allSections);
  if (!sec || !sec.categoria_final) return fallback;
  return sec.categoria_final;
}

module.exports = { getViniCategoria, NORMALIZE, OVERRIDES };

// ─── CLI standalone ──────────────────────────────────────────────────
if (require.main === module) {
  const DRY_RUN = process.argv.includes('--dry-run');
  const ROOT = path.join(__dirname, '..');
  const catalogoPath = path.join(ROOT, 'catalogo.json');
  const catalogo = JSON.parse(fs.readFileSync(catalogoPath, 'utf8'));

  const data = loadData();
  if (!data) {
    console.error('✗ No se encuentran vini-section-map.json o vini-sku-pages.json');
    console.error('  Generalos primero con:');
    console.error('    node parse-vini-index.js --json');
    console.error('    node extract-sku-pages.js');
    console.error('    node build-vini-section-map.js --json');
    process.exit(1);
  }

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
    const pg = data.skuToPage[sku];
    let nuevaCat = null;
    if (pg) {
      const sec = bestSectionForSku(pg, p.nombre, data.allSections);
      if (sec && sec.categoria_final) {
        nuevaCat = sec.categoria_final;
        stats.categorizado_pdf++;
      }
    }
    if (!nuevaCat) { stats.categorizado_sin_pdf++; continue; }
    if (p.categoria !== nuevaCat) {
      stats.cambios_por.desde[p.categoria] = (stats.cambios_por.desde[p.categoria] || 0) + 1;
      stats.cambios_por.nueva[nuevaCat] = (stats.cambios_por.nueva[nuevaCat] || 0) + 1;
      stats.cambio_categoria++;
      if (ejemplosCambios.length < 15) {
        ejemplosCambios.push({ sku, nombre: p.nombre, de: p.categoria, a: nuevaCat });
      }
      p.categoria = nuevaCat;
    } else {
      stats.mismo_valor++;
    }
  }

  console.log('═══════════════════════════════════════════════════');
  console.log(`  Recategorización VINI${DRY_RUN ? ' (DRY-RUN)' : ''}`);
  console.log('═══════════════════════════════════════════════════');
  console.log(`VINI total: ${stats.vini_total}`);
  console.log(`  · Categorizado vía PDF: ${stats.categorizado_pdf}`);
  console.log(`  · Sin cambio (fallback): ${stats.categorizado_sin_pdf}`);
  console.log(`  · Cambió categoría: ${stats.cambio_categoria}`);
  console.log(`  · Ya tenía la correcta: ${stats.mismo_valor}`);

  if (ejemplosCambios.length > 0) {
    console.log('\n─── Ejemplos ───');
    ejemplosCambios.forEach(e =>
      console.log(`  ${e.sku}  [${e.de} → ${e.a}]  ${e.nombre}`));
  }

  if (!DRY_RUN) {
    fs.writeFileSync(catalogoPath, JSON.stringify(catalogo, null, 2));
    console.log(`\n✓ catalogo.json actualizado`);
  } else {
    console.log('\n(DRY-RUN — no se escribió catalogo.json)');
  }
}

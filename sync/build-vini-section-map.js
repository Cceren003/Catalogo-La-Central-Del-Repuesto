#!/usr/bin/env node
// Construye el mapeo sección PDF VINI → categoría LCR usando los 1244 productos
// LCR que ya tienen SKU EAN-VINI (741540*) con categoría real del sistema.
//
// Para cada sección del índice, mira qué SKUs caen en ese rango de páginas,
// ve qué categoría tienen en LCR, y elige la MÁS FRECUENTE como mapeo oficial.
// Reporta las secciones con ambigüedad (varias categorías compitiendo) y las
// que no tienen suficiente cobertura LCR.

const fs = require('fs');
const path = require('path');

const index = require('./vini-index.json'); // secciones del PDF
const pages = require('./vini-sku-pages.json'); // SKU → página
const catalogo = require('../catalogo.json');

// Índice LCR por SKU
const lcrBySku = new Map();
for (const p of catalogo.productos) {
  if ((p.fuente || 'LCR') === 'LCR') lcrBySku.set(String(p.sku), p);
}

// sku_to_page: SKU → primera página
const skuToPage = pages.sku_to_page;

// Construir: para cada sección, qué SKUs caen y qué categoría tienen en LCR
const sectionData = index.map(s => {
  const skusInSection = [];
  for (const [sku, pg] of Object.entries(skuToPage)) {
    if (pg >= s.pgStart && pg <= s.pgEnd) skusInSection.push(sku);
  }
  // De esos SKUs, ¿cuáles están en LCR?
  const categoriasLcr = {};
  let lcrCount = 0;
  for (const sku of skusInSection) {
    const p = lcrBySku.get(sku);
    if (p) {
      lcrCount++;
      categoriasLcr[p.categoria] = (categoriasLcr[p.categoria] || 0) + 1;
    }
  }
  // Categoría dominante
  const sorted = Object.entries(categoriasLcr).sort((a, b) => b[1] - a[1]);
  const topCat = sorted[0] ? sorted[0][0] : null;
  const topCount = sorted[0] ? sorted[0][1] : 0;
  const confianza = lcrCount > 0 ? (topCount / lcrCount).toFixed(2) : 0;

  return {
    seccion: s.nombre,
    pgStart: s.pgStart,
    pgEnd: s.pgEnd,
    skus_en_seccion: skusInSection.length,
    skus_en_lcr: lcrCount,
    categoria_lcr_top: topCat,
    confianza,
    alternativas: sorted.slice(1, 4).map(([c, n]) => `${c}(${n})`),
  };
});

// Separar: con ground truth sólido vs sin
const solido = sectionData.filter(s => s.skus_en_lcr >= 2 && s.confianza >= 0.5);
const ambiguo = sectionData.filter(s => s.skus_en_lcr >= 2 && s.confianza < 0.5);
const sinLcr = sectionData.filter(s => s.skus_en_lcr < 2);

console.log('═══════════════════════════════════════════════');
console.log('  Mapeo sección PDF VINI → categoría LCR');
console.log('═══════════════════════════════════════════════');
console.log('');
console.log(`Secciones en total: ${sectionData.length}`);
console.log(`  · Con mapeo sólido (≥2 SKUs LCR, confianza ≥50%): ${solido.length}`);
console.log(`  · Ambiguas (LCR divididas): ${ambiguo.length}`);
console.log(`  · Sin ground truth LCR: ${sinLcr.length}`);
console.log('');

console.log('─── MAPEO SÓLIDO (muestra 30) ───');
solido.slice(0, 30).forEach(s => {
  const pg = s.pgStart === s.pgEnd ? String(s.pgStart) : `${s.pgStart}-${s.pgEnd}`;
  console.log(`  [${s.categoria_lcr_top.padEnd(14)}]  ${s.skus_en_lcr}/${s.skus_en_seccion} SKUs  p.${pg.padEnd(8)} ${s.seccion}`);
});

console.log('');
console.log('─── AMBIGUAS (inspecciona manual) ───');
ambiguo.forEach(s => {
  const pg = s.pgStart === s.pgEnd ? String(s.pgStart) : `${s.pgStart}-${s.pgEnd}`;
  console.log(`  [${s.categoria_lcr_top.padEnd(14)}]  ${s.skus_en_lcr} LCR  alts:${s.alternativas.join(',')}  p.${pg} ${s.seccion}`);
});

console.log('');
console.log('─── SIN GROUND TRUTH LCR (muestra 20) ───');
sinLcr.slice(0, 20).forEach(s => {
  const pg = s.pgStart === s.pgEnd ? String(s.pgStart) : `${s.pgStart}-${s.pgEnd}`;
  console.log(`  p.${pg.padEnd(8)} ${s.seccion}  (${s.skus_en_seccion} SKUs sin match)`);
});
console.log(`  ... y ${Math.max(0, sinLcr.length - 20)} más`);

// Guardar resultado completo
if (process.argv.includes('--json')) {
  fs.writeFileSync(path.join(__dirname, 'vini-section-map.json'), JSON.stringify({ solido, ambiguo, sinLcr }, null, 2));
  console.log('\n✓ Guardado en sync/vini-section-map.json');
}

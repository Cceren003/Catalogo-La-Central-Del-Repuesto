#!/usr/bin/env node
// sync/create-template.js
// Genera la plantilla Excel (sync/enriquecidos-template.xlsx) con 4 hojas:
//   - Instrucciones (cómo llenar el archivo)
//   - Compatibilidades (SKU | Marca | Modelo | Años)
//   - Equivalencias   (SKU | SKU_Equivalente)
//   - Relacionados    (SKU | SKU_Relacionado)
//
// Correr:  node sync/create-template.js
//          npm run template-enriquecidos (desde sync/)

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const OUT = path.join(__dirname, 'enriquecidos-template.xlsx');

function aoa(rows) { return XLSX.utils.aoa_to_sheet(rows); }

// Ajusta anchos de columna. Array alineado con las columnas de cada hoja.
function setWidths(ws, widths) {
  ws['!cols'] = widths.map(wch => ({ wch }));
}

const wb = XLSX.utils.book_new();

// ─── Hoja 0: Instrucciones ─────────────────────────────────────────────
const wsInstr = aoa([
  ['PLANTILLA DE ENRIQUECIMIENTO — Catálogo La Central del Repuesto'],
  [],
  ['¿PARA QUÉ SIRVE?'],
  ['Este archivo alimenta las secciones "Compatibilidades verificadas",'],
  ['"Equivalencias" y "Productos relacionados" que aparecen en la ficha de'],
  ['cada producto del catálogo web.'],
  [],
  ['FLUJO'],
  ['1. Copiá este archivo a sync/enriquecidos.xlsx (tu copia personal).'],
  ['2. Editá las 3 hojas (Compatibilidades / Equivalencias / Relacionados).'],
  ['3. Corré desde la terminal:  node sync/build-enriquecidos.js'],
  ['   (o desde sync/:  npm run build-enriquecidos )'],
  ['4. Se regenera data/enriquecidos.json con tus datos.'],
  ['5. Commit + push → GitHub Pages publica los cambios.'],
  [],
  ['REGLAS POR HOJA'],
  [],
  ['  Compatibilidades:'],
  ['    - Una fila por cada modelo compatible.'],
  ['    - Un SKU puede tener varias filas (un modelo en cada una).'],
  ['    - "Años" acepta rangos (2018-2023), listas (2018,2020,2022) o combinados'],
  ['      (2018-2021, 2023). Sin años = se muestra el modelo sin años.'],
  [],
  ['  Equivalencias:'],
  ['    - Una fila por cada equivalencia.'],
  ['    - SKU_Equivalente debe existir en el catálogo; si no existe se omite.'],
  [],
  ['  Relacionados:'],
  ['    - Una fila por cada producto relacionado (curación manual).'],
  ['    - Si NO agregás filas para un SKU, el sistema auto-rellena con 4'],
  ['      productos de la misma categoría. Usá esta hoja solo cuando quieras'],
  ['      forzar qué cross-sell aparece para un producto importante.'],
  [],
  ['¿DÓNDE GUARDAR?'],
  ['  - Plantilla (este archivo):  sync/enriquecidos-template.xlsx   (va al repo)'],
  ['  - Tu copia editada:          sync/enriquecidos.xlsx            (NO va al repo)'],
  ['  - JSON generado:             data/enriquecidos.json            (va al repo)'],
]);
setWidths(wsInstr, [90]);
XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');

// ─── Hoja 1: Compatibilidades ──────────────────────────────────────────
// Filas cuyo SKU empieza con "//" se ignoran en el build (comentarios/ejemplos).
const wsCompat = aoa([
  ['SKU', 'Marca', 'Modelo', 'Años'],
  ['741540189145', 'Hero', 'Glamour 125',  '2018-2023'],
  ['741540189145', 'Hero', 'Splendor 125', '2015-2023'],
  ['', '', '', ''],
  ['// EJEMPLOS (las filas que empiezan con // se ignoran — borrá los // y poné tu SKU real)', '', '', ''],
  ['// MI-SKU-123', 'Honda', 'CB 150',   '2018-2023'],
  ['// MI-SKU-123', 'Honda', 'CG 125',   '2015, 2018-2022'],
  ['// MI-SKU-456', 'Yamaha', 'YBR 125', '2019-2024'],
]);
setWidths(wsCompat, [18, 12, 20, 30]);
XLSX.utils.book_append_sheet(wb, wsCompat, 'Compatibilidades');

// ─── Hoja 2: Equivalencias ─────────────────────────────────────────────
const wsEquiv = aoa([
  ['SKU', 'SKU_Equivalente', 'Nota (opcional)'],
  ['', '', ''],
  ['// EJEMPLOS (borrá los // y poné tu SKU real)', '', ''],
  ['// MI-SKU-123', 'OTRO-SKU-789', 'Misma pieza, proveedor distinto'],
  ['// MI-SKU-123', 'OTRO-SKU-555', 'Equivalente marca genérica'],
]);
setWidths(wsEquiv, [18, 22, 40]);
XLSX.utils.book_append_sheet(wb, wsEquiv, 'Equivalencias');

// ─── Hoja 3: Relacionados ──────────────────────────────────────────────
const wsRel = aoa([
  ['SKU', 'SKU_Relacionado', 'Nota (opcional)'],
  ['', '', ''],
  ['// EJEMPLOS — solo usar si querés sobrescribir el auto-fill por categoría', '', ''],
  ['// MI-SKU-123', 'COMPLEMENTO-1', 'Filtro de aceite que va con este motor'],
  ['// MI-SKU-123', 'COMPLEMENTO-2', 'Junta tapa válvulas'],
]);
setWidths(wsRel, [18, 22, 40]);
XLSX.utils.book_append_sheet(wb, wsRel, 'Relacionados');

XLSX.writeFile(wb, OUT);
console.log(`✓ Generado ${OUT}`);
console.log(`  Hojas: ${wb.SheetNames.join(', ')}`);

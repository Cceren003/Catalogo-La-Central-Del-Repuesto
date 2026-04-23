#!/usr/bin/env node
// sync/create-template.js
// Genera la plantilla Excel (sync/enriquecidos-template.xlsx) con 6 hojas:
//   - Instrucciones (cómo llenar el archivo)
//   - Compatibilidades (SKU | Marca | Modelo | Años)
//   - Equivalencias   (SKU | SKU_Equivalente | Nota)
//   - Relacionados    (SKU | SKU_Relacionado | Nota)
//   - Especificaciones (SKU | DIENTES | DIAMETRO_CENTRO | PERNOS_CANTIDAD |
//                       DIAMETRO_PERNO | DIAMETRO_PERNO_A_PERNO | TIPO_DE_PASO)
//   - Overrides       (SKU | Nombre | Descripcion) — reescribe nombre y agrega descripción
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
  ['  Especificaciones:'],
  ['    - UNA fila por SKU (distinto a las otras hojas).'],
  ['    - Dejá vacías las columnas que no aplican al producto.'],
  ['    - Columnas: DIENTES, DIAMETRO_CENTRO, PERNOS_CANTIDAD,'],
  ['      DIAMETRO_PERNO, DIAMETRO_PERNO_A_PERNO, TIPO_DE_PASO'],
  ['    - Si todas las columnas están vacías, la sección no aparece en la ficha.'],
  ['    - Pensado para catarinas, discos, prensas, rodamientos, etc.'],
  [],
  ['  Overrides:'],
  ['    - UNA fila por SKU para sobrescribir el nombre y/o agregar descripción.'],
  ['    - Úsala cuando el nombre del proveedor esté raro, cortado, o quieras'],
  ['      mejorar la redacción. Gana sobre lo que viene del PDF/Excel/LCR.'],
  ['    - Columnas:'],
  ['      · SKU:          código del producto (debe existir en el catálogo).'],
  ['      · Nombre:       nombre nuevo. Dejá vacío para NO cambiar el nombre.'],
  ['      · Descripcion:  texto largo visible en la ficha. Opcional.'],
  ['    - El nombre nuevo también se usa en búsqueda y compartir por WhatsApp.'],
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

// ─── Hoja 4: Especificaciones ──────────────────────────────────────────
// Una fila por SKU. Cada celda vacía se omite en el JSON final.
// Pensado para piezas donde las dimensiones técnicas son críticas (catarinas,
// prensas, discos, rodamientos, etc.).
const wsSpecs = aoa([
  ['SKU', 'DIENTES', 'DIAMETRO_CENTRO', 'PERNOS_CANTIDAD', 'DIAMETRO_PERNO', 'DIAMETRO_PERNO_A_PERNO', 'TIPO_DE_PASO'],
  ['', '', '', '', '', '', ''],
  ['// EJEMPLOS (borrá los // y poné tu SKU real). Dejá vacías las specs que no aplican.', '', '', '', '', '', ''],
  ['// CATARINA-HONDA-14T', '14T',  '20 mm', '5', '8 mm', '42 mm', '428H'],
  ['// CATARINA-BAJAJ-45T', '45T',  '58 mm', '5', '8 mm', '58 mm', '520'],
  ['// DISCO-FRENO-220',    '',     '', '5', '10.5 mm', '', ''],
]);
setWidths(wsSpecs, [28, 10, 16, 16, 16, 22, 14]);
XLSX.utils.book_append_sheet(wb, wsSpecs, 'Especificaciones');

// ─── Hoja 5: Overrides ──────────────────────────────────────────────────
// UNA fila por SKU. Reemplaza el nombre que trae del sync y/o agrega descripción.
// Útil para corregir nombres mal codificados del PDF (ñ, ü), mejorar redacción,
// o agregar texto descriptivo extenso visible en la ficha.
const wsOv = aoa([
  ['SKU', 'Nombre', 'Descripcion'],
  ['1002389', 'Cigüeñal GY6 150cc Scooter', 'Cigüeñal balanceado, compatible con scooters GY6 150cc. Incluye biela y rodamientos.'],
  ['', '', ''],
  ['// EJEMPLOS (borrá los // y poné tu SKU real)', '', ''],
  ['// MI-SKU-123', 'Nombre nuevo más claro', ''],
  ['// MI-SKU-456', '', 'Descripción extendida que aparece en la ficha del producto.'],
  ['// Si solo querés cambiar el NOMBRE, dejá Descripcion vacía.', '', ''],
  ['// Si solo querés agregar DESCRIPCIÓN sin cambiar el nombre, dejá Nombre vacío.', '', ''],
]);
setWidths(wsOv, [18, 50, 80]);
XLSX.utils.book_append_sheet(wb, wsOv, 'Overrides');

XLSX.writeFile(wb, OUT);
console.log(`✓ Generado ${OUT}`);
console.log(`  Hojas: ${wb.SheetNames.join(', ')}`);

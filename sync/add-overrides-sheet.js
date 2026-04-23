#!/usr/bin/env node
// Agrega la hoja "Overrides" al Excel enriquecidos.xlsx del usuario sin
// tocar las hojas que ya tiene. Si la hoja ya existe, no hace nada.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SRC = path.join(__dirname, 'enriquecidos.xlsx');

if (!fs.existsSync(SRC)) {
  console.error('✗ No existe', SRC);
  console.error('  Copiá enriquecidos-template.xlsx → enriquecidos.xlsx primero.');
  process.exit(1);
}

const wb = XLSX.readFile(SRC);
const existing = wb.SheetNames.some(n => n.toLowerCase() === 'overrides');
if (existing) {
  console.log('✓ La hoja "Overrides" ya existe en el Excel — no se hacen cambios.');
  process.exit(0);
}

// Hoja con ejemplos realistas
const rows = [
  ['SKU', 'Nombre', 'Descripcion'],
  ['', '', ''],
  ['// EJEMPLOS — borrá los // y poné tus SKUs reales. Cada fila sobreescribe el nombre', '', ''],
  ['// del producto y/o agrega una descripción extendida que aparece en la ficha web.', '', ''],
  ['// - Solo cambiar NOMBRE: dejá Descripcion vacía.', '', ''],
  ['// - Solo agregar DESCRIPCIÓN: dejá Nombre vacío.', '', ''],
  ['// - Cambiar ambos: llená ambas columnas.', '', ''],
  ['', '', ''],
  ['// 1002389', 'Cigüeñal GY6 150cc Scooter', 'Cigüeñal balanceado, compatible con scooters GY6 150cc. Incluye biela y rodamientos.'],
  ['// 1000319', 'Cigüeñal Apache 160', ''],
  ['// LA1A-3801-22', '', 'Llanta AXUS tubo tipo calle, 80/90-17 trasera. Compatible Honda CG125/150.'],
];
const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = [{ wch: 18 }, { wch: 50 }, { wch: 80 }];
XLSX.utils.book_append_sheet(wb, ws, 'Overrides');

XLSX.writeFile(wb, SRC);
console.log('✓ Hoja "Overrides" agregada a', SRC);
console.log('  Hojas ahora:', wb.SheetNames.join(', '));

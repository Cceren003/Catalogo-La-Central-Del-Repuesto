#!/usr/bin/env node
// Parsea el índice del PDF VINI (páginas 2-5) y devuelve:
//   · lista de secciones: [{ nombre, pgStart, pgEnd }, ...]
//   · map<pagina, seccion>
// El índice tiene formato:
//   NOMBRE DEL PRODUCTO··········PAGINA
//   NOMBRE MULTI-LINEA··········· INICIO~FIN
const { execFileSync } = require('child_process');
const path = require('path');

const POPPLER = 'C:/Users/cgcer/AppData/Local/Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin';
const PDFTOTEXT = POPPLER + '/pdftotext.exe';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const pdfPath = args[0] ||
  'C:/Users/cgcer/OneDrive/MOTOS/CATALOGOS MOTOS GENERAL/CATALAGOS GENERAL/catalogo vini 2026 feb.pdf';

// Extraer texto de páginas 2-5 con layout preservado
const out = execFileSync(PDFTOTEXT, ['-f', '2', '-l', '5', '-layout', pdfPath, '-'],
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

// Normalizar puntos rellenos (····· ········) y múltiples espacios
// Patrón típico de cada entrada: NOMBRE<puntos><espacios>NUM o NUM~NUM
// Entradas pueden estar en 2 columnas; separadas por tabulación larga.
const rawLines = out.split('\n').map(l => l.trim()).filter(Boolean);

// Reemplazar puntos del directorio (· y ········) con espacios
function clean(s) {
  return s.replace(/[·\u00B7]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Extrae entradas: busca líneas con texto + números al final (con o sin ~)
// Formato: "NOMBRE DEL PRODUCTO NUM" o "NOMBRE DEL PRODUCTO NUM~NUM"
const entries = [];
// Una entrada puede ocupar varias líneas del texto (wrap) si el nombre es largo.
// Heurística: cada "entrada" termina con un número al final (con o sin ~).
// Partimos buffer de texto acumulado y cortamos cada vez que aparece un número final.
let buffer = [];
for (const raw of rawLines) {
  const line = clean(raw);
  if (!line) continue;
  if (/^directorio$/i.test(line)) { buffer = []; continue; }
  // ¿Termina en número o rango? → cierra entrada
  const m = line.match(/^(.+?)\s+(\d+(?:\s*~\s*\d+)?)$/);
  if (m) {
    const nombre = (buffer.join(' ') + ' ' + m[1]).replace(/\s+/g, ' ').trim();
    const rango = m[2].replace(/\s+/g, '');
    let pgStart, pgEnd;
    if (rango.includes('~')) {
      const [a, b] = rango.split('~').map(n => parseInt(n, 10));
      pgStart = a; pgEnd = b;
    } else {
      pgStart = pgEnd = parseInt(rango, 10);
    }
    entries.push({ nombre, pgStart, pgEnd });
    buffer = [];
  } else {
    // Parte del nombre que wrapea a la siguiente línea
    buffer.push(line);
  }
}

// El índice tiene 2 columnas; el parser layout las separa con muchos espacios.
// Pero por el orden de lectura `pdftotext -layout`, las procesa fila-a-fila
// mezclando columnas. Detectamos líneas con DOS entradas (dos números finales).
// Rehacemos con una estrategia más simple: dividir cada línea por espacios largos
// y procesar cada "columna" por separado.

function parseTwoColumnLine(s) {
  // Partir cuando hay 3+ espacios consecutivos (separador de columnas)
  const parts = s.split(/\s{3,}/).map(p => p.trim()).filter(Boolean);
  return parts;
}

const entriesFull = [];
let bufferL = [], bufferR = [];
for (const raw of rawLines) {
  const line = clean(raw);
  if (!line) continue;
  if (/^directorio$/i.test(line)) { bufferL = []; bufferR = []; continue; }
  const cols = parseTwoColumnLine(line.replace(/[·]+/g, '·').replace(/·/g, '···'));
  // parseTwoColumnLine ya recibió línea limpiada; re-split más preciso por 3+ espacios
  const colsRaw = raw.trim().replace(/[·\u00B7]+/g, ' · ').split(/\s{3,}/).map(c => c.trim()).filter(Boolean);
  // normalizar puntos y ver número final
  function tryParse(text) {
    const t = text.replace(/[·\u00B7]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    const m = t.match(/^(.+?)\s+(\d+(?:\s*~\s*\d+)?)$/);
    if (!m) return { cont: t };
    let pgStart, pgEnd;
    const rango = m[2].replace(/\s+/g, '');
    if (rango.includes('~')) {
      const [a, b] = rango.split('~').map(n => parseInt(n, 10));
      pgStart = a; pgEnd = b;
    } else {
      pgStart = pgEnd = parseInt(rango, 10);
    }
    return { nombre: m[1].trim(), pgStart, pgEnd };
  }

  if (colsRaw.length >= 2) {
    const left = tryParse(colsRaw[0]);
    const right = tryParse(colsRaw.slice(1).join(' '));
    if (left) {
      if (left.nombre) {
        const nombre = (bufferL.join(' ') + ' ' + left.nombre).replace(/\s+/g, ' ').trim();
        entriesFull.push({ nombre, pgStart: left.pgStart, pgEnd: left.pgEnd });
        bufferL = [];
      } else if (left.cont) bufferL.push(left.cont);
    }
    if (right) {
      if (right.nombre) {
        const nombre = (bufferR.join(' ') + ' ' + right.nombre).replace(/\s+/g, ' ').trim();
        entriesFull.push({ nombre, pgStart: right.pgStart, pgEnd: right.pgEnd });
        bufferR = [];
      } else if (right.cont) bufferR.push(right.cont);
    }
  } else if (colsRaw.length === 1) {
    const res = tryParse(colsRaw[0]);
    if (res) {
      if (res.nombre) {
        const nombre = (bufferL.join(' ') + ' ' + res.nombre).replace(/\s+/g, ' ').trim();
        entriesFull.push({ nombre, pgStart: res.pgStart, pgEnd: res.pgEnd });
        bufferL = [];
      } else if (res.cont) bufferL.push(res.cont);
    }
  }
}

// Deduplicar por nombre+pgStart
const seen = new Set();
const unique = entriesFull.filter(e => {
  const k = e.nombre + '|' + e.pgStart;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

// Ordenar por pgStart
unique.sort((a, b) => a.pgStart - b.pgStart);

console.log('═══════════════════════════════════════════════');
console.log('  Índice VINI parseado');
console.log('═══════════════════════════════════════════════');
console.log(`Total secciones: ${unique.length}`);
console.log('');
console.log('Secciones:');
unique.forEach(e => {
  const pg = e.pgStart === e.pgEnd ? String(e.pgStart) : `${e.pgStart}-${e.pgEnd}`;
  console.log(`  ${pg.padEnd(8)}  ${e.nombre}`);
});

// Exportar para uso posterior
if (process.argv.includes('--json')) {
  const fs = require('fs');
  fs.writeFileSync(path.join(__dirname, 'vini-index.json'), JSON.stringify(unique, null, 2));
  console.log('\n✓ Guardado en sync/vini-index.json');
}

module.exports = { parseViniIndex: () => unique };

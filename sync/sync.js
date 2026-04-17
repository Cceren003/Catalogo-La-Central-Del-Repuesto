#!/usr/bin/env node
// Sync del inventario LCR → catalogo.json
// Flujo: login → descargar Excel → parsear → escribir catalogo.json

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const XLSX = require('xlsx');

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`ERROR: falta ${CONFIG_PATH}. Copia config.example.json → config.json y llena tus credenciales.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function round2(n) {
  if (n === null || n === undefined || n === '' || isNaN(n)) return null;
  return Math.round(parseFloat(n) * 100) / 100;
}

function stockStatus(n) {
  const s = parseInt(n, 10);
  if (isNaN(s) || s <= 0) return 'out_of_stock';
  if (s <= 5) return 'low_stock';
  return 'in_stock';
}

async function makeClient(baseUrl) {
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    baseURL: baseUrl,
    jar,
    withCredentials: true,
    maxRedirects: 5,
    timeout: 60000,
    validateStatus: () => true,
  }));
  return { client, jar };
}

async function login(client, username, password) {
  console.log('→ GET login.php (obtener PHPSESSID)');
  const pre = await client.get('/login.php');
  if (pre.status >= 400) throw new Error(`GET login.php fallo con status ${pre.status}`);

  console.log('→ POST login.php con credenciales');
  const form = new URLSearchParams();
  form.append('username', username);
  form.append('password', password);

  const res = await client.post('/login.php', form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  // Validar: al ser exitoso, la session queda autenticada y un GET a dashboard.php NO redirige a login
  const check = await client.get('/dashboard.php');
  const finalUrl = check.request?.res?.responseUrl || check.config.url;
  if (/login\.php/i.test(String(finalUrl)) || /login/i.test(check.data?.slice?.(0, 2000) || '')) {
    throw new Error('Login fallido: el sistema sigue pidiendo login. Revisa credenciales.');
  }
  console.log('✓ Login OK');
}

async function downloadExcel(client, sucursal) {
  console.log(`→ POST reporte_inventario_xls.php (sucursal=${sucursal})`);
  const form = new URLSearchParams();
  form.append('sucursal', String(sucursal));
  form.append('id_sucursal', String(sucursal));

  const res = await client.post('/reporte_inventario_xls.php', form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    responseType: 'arraybuffer',
  });

  if (res.status !== 200) throw new Error(`Excel download HTTP ${res.status}`);
  const buf = Buffer.from(res.data);
  if (buf.length < 5000) {
    // probablemente redirigió a HTML de login u otra página — dump para debug
    throw new Error(`Excel recibido es sospechosamente pequeño (${buf.length} bytes). Primeros 200 chars: ${buf.toString('utf8', 0, 200)}`);
  }
  console.log(`✓ Excel recibido: ${buf.length} bytes`);
  return buf;
}

function parseExcel(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // Lee como array de arrays para controlar los headers y saltar filas meta (1-4)
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

  // Validar fila de headers (fila 5 en Excel = índice 4)
  const headers = rows[4].map(h => (h || '').toString().trim().toUpperCase());
  const expected = ['CODIGO', 'PRODUCTO', 'MARCA', 'CATEGORIA', 'PRESENTACION', 'DESCRIPCION', 'UBICACION', 'COSTO', 'EXISTENCIA', 'TOTAL($)', 'PRECIO 1', 'PRECIO 2', 'PRECIO 3', 'PRECIO 4', 'PRECIO 5', 'PRECIO 6', 'PRECIO 7'];
  for (let i = 0; i < expected.length; i++) {
    if (headers[i] !== expected[i]) {
      throw new Error(`Header inesperado en columna ${i + 1}: esperaba "${expected[i]}", encontré "${headers[i]}". ¿Cambió el Excel de OSS?`);
    }
  }

  const productos = [];
  for (let r = 5; r < rows.length; r++) {
    const row = rows[r];
    const codigo = (row[0] || '').toString().trim();
    if (!codigo) continue;
    if (codigo.toUpperCase() === 'TOTALES') continue;

    const precioPublico = round2(row[11]);       // PRECIO 2 = col L (index 11)
    const precioTaller = round2(row[13]);        // PRECIO 4 = col N (index 13)
    const precioDist = round2(row[15]);          // PRECIO 6 = col P (index 15)

    const stock = parseInt(row[8], 10) || 0;     // EXISTENCIA = col I

    productos.push({
      sku: codigo,
      nombre: (row[1] || '').toString().trim(),
      marca: (row[2] || '').toString().trim(),
      categoria: (row[3] || '').toString().trim(),
      presentacion: (row[4] || '').toString().trim(),
      empaque: (row[5] || '').toString().trim(),
      precios: {
        publico: precioPublico,
        taller: precioTaller,
        distribuidor: precioDist,
      },
      stock,
      stock_status: stockStatus(stock),
      disponible: stock > 0,
      imagen: `img/${codigo}.jpg`,
      activo: true,
    });
  }
  return productos;
}

function buildCatalog(productos) {
  return {
    generated_at: new Date().toISOString(),
    count: productos.length,
    productos,
  };
}

async function main() {
  const cfg = loadConfig();
  console.log(`Sync LCR → catalogo.json${DRY_RUN ? ' (DRY RUN)' : ''}`);

  const { client } = await makeClient(cfg.baseUrl);
  await login(client, cfg.username, cfg.password);
  const buf = await downloadExcel(client, cfg.sucursal ?? 0);

  if (DRY_RUN) {
    const dbgPath = path.join(__dirname, 'last_download.xls');
    fs.writeFileSync(dbgPath, buf);
    console.log(`✓ Guardado Excel crudo en ${dbgPath} (dry-run)`);
  }

  console.log('→ Parseando Excel');
  const productos = parseExcel(buf);
  console.log(`✓ ${productos.length} productos parseados`);

  const catalog = buildCatalog(productos);
  const outPath = path.resolve(__dirname, cfg.output || '../catalogo.json');

  if (DRY_RUN) {
    console.log(`DRY RUN — NO se escribe ${outPath}. Primeros 3 productos:`);
    console.log(JSON.stringify(catalog.productos.slice(0, 3), null, 2));
    return;
  }

  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`✓ Escrito ${outPath} (${productos.length} productos)`);
}

main().catch(err => {
  console.error('\n✗ ERROR:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

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

// Lee el archivo de bodega central del proveedor si existe.
// Soporta .csv (columna "sku" o "codigo"), .xlsx y .xls.
// Retorna un Set de SKUs (uppercase) disponibles en bodega central.
function loadBodegaCentral() {
  const candidates = ['bodega_central.csv', 'bodega_central.xlsx', 'bodega_central.xls'];
  for (const name of candidates) {
    const p = path.join(__dirname, name);
    if (!fs.existsSync(p)) continue;
    console.log(`→ Leyendo bodega central desde ${name}`);
    const wb = XLSX.readFile(p);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });
    const skus = new Set();
    for (const r of rows) {
      // Busca columna sku / codigo / code (case-insensitive)
      const keys = Object.keys(r);
      const k = keys.find(k => /^(sku|codigo|code|cod)$/i.test(k.trim()));
      if (!k) continue;
      const v = (r[k] || '').toString().trim().toUpperCase();
      if (v) skus.add(v);
    }
    console.log(`✓ ${skus.size} SKUs marcados como bodega central`);
    return skus;
  }
  console.log('ℹ No hay archivo bodega_central.{csv,xlsx,xls} — ningún producto se marca como "a pedido"');
  return new Set();
}

function round2(n) {
  if (n === null || n === undefined || n === '' || isNaN(n)) return null;
  return Math.round(parseFloat(n) * 100) / 100;
}

// Carga el índice de imágenes disponibles en ../imagenes/ (sin extensión).
// Se llama una vez al arrancar el sync y se reusa para matching O(1).
let _imgIndex = null;
function getImgIndex() {
  if (_imgIndex) return _imgIndex;
  const imgDir = path.join(__dirname, '..', 'imagenes');
  if (!fs.existsSync(imgDir)) { _imgIndex = new Map(); return _imgIndex; }
  const files = fs.readdirSync(imgDir);
  _imgIndex = new Map();
  for (const f of files) {
    const m = f.match(/^(.+)\.(jpg|jpeg|png|webp)$/i);
    if (!m) continue;
    _imgIndex.set(m[1].toUpperCase(), `imagenes/${f}`);
  }
  console.log(`→ Índice de imágenes: ${_imgIndex.size} archivos en imagenes/`);
  return _imgIndex;
}

// Devuelve la ruta relativa a la imagen si existe un archivo imagenes/<sku>.(jpg|png|webp), o '' si no.
function findImage(sku) {
  const idx = getImgIndex();
  return idx.get((sku || '').toString().trim().toUpperCase()) || '';
}

function stockStatus(n) {
  const s = parseInt(n, 10);
  if (isNaN(s) || s <= 0) return 'out_of_stock';
  if (s <= 5) return 'low_stock';
  return 'in_stock';
}

// "NRP - JPN" → "NRP" — toma la primera palabra antes de separador
function cleanMarca(s) {
  return (s || '').toString().split(/[\-\/,]/)[0].trim().toUpperCase();
}

// Parsea "$59.65" o " $ 59.65 " o "59.65" → 59.65
function parseMoney(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = v.toString().replace(/[\$\s,]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Infiere categoría del nombre del producto con reglas regex.
// Cubre ~80% de los casos. Default REPUESTOS.
function inferCategoria(nombre) {
  const n = (nombre || '').toString().toUpperCase();
  const rules = [
    [/\b(ACEITE|LUBRICANTE|ATF)\b/, 'ACEITES'],
    [/\bFILTRO\b/, 'FILTROS'],
    [/\b(ZAPATA|PASTILLA|BALATA|DISCO DE FRENO|CALIPER|BOMBIN DE FRENO|BANDA DE FRENO)\b/, 'FRENOS'],
    [/\b(CASCO|VISOR|MICA DE CASCO)\b/, 'CASCOS'],
    [/\b(BUJIA|BUJ[IÍ]A)\b/, 'BUJIAS'],
    [/\b(BATER[IÍ]A|ACUMULADOR)\b/, 'BATERIAS'],
    [/\b(FOCO|BOMBILLO|BOMBILLA|L[AÁ]MPARA|LED|HALOGENO|REFLECTOR|CHICOTE|CLAXON|BOCINA|CDI|REGULADOR|RECTIFICADOR|STATOR|BOBINA|SENSOR|RELAY|REL[EÉ])\b/, 'ELECTRICOS'],
    [/\b(CADENA|PI[ÑN][OÓ]N|CATARINA|KIT DE ARRASTRE|EMBRAGUE|CLUTCH|DISCO DE CLUTCH)\b/, 'TRANSMISION'],
    [/\b(LLANTA|NEUM[AÁ]TICO|C[AÁ]MARA DE LLANTA|RIN|ARO)\b/, 'LLANTAS'],
    [/\bCABLE\b/, 'CABLES'],
    [/\b(ESPEJO|RETROVISOR)\b/, 'ESPEJOS'],
    [/\b(MOFLE|ESCAPE|SILENCIADOR|SILENC)\b/, 'ESCAPES'],
    [/\b(CARBURADOR|INYECTOR|PIST[OÓ]N|ANILLO DE PIST|BIELA|CIG[ÜU]E[ÑN]AL|CAMISA|V[AÁ]LVULA|EMPAQUE DE CABEZA|JUNTA DE CULATA|ARBOL DE LEVAS|BALANCIN|MUELLE DE VALVULA|RETEN|SELLO)\b/, 'MOTOR'],
    [/\b(AMORTIGUADOR|HORQUILLA|RESORTE DE SUSPENSION|BARRA DE DIRECCI[OÓ]N|CONO DE DIRECCION|TIJA)\b/, 'SUSPENSION'],
    [/\b(MANUBRIO|MANILLAR|EMPU[ÑN]ADURA|PU[ÑN]O|PERILLA|ACELERADOR)\b/, 'MANUBRIOS'],
    [/\b(TORNILLO|TUERCA|PERNO|ARANDELA|SEEGER|GRAPA|HEBILLA)\b/, 'TORNILLERIA'],
    [/\b(RODAJE|BALINERA|RODAMIENTO|RETEN|SELLO DE |COLL[AÁ]R)\b/, 'REPUESTOS MOTOR'],
    [/\b(GUANTE|CHUMPA|CHALECO|ZAPATO|RODILLERA|CODERA|PROTECTOR|COLUMPIO DE )\b/, 'EQUIPAMIENTO'],
    [/\b(ABRILLANTADOR|LIMPIADOR|DESENGRASANTE|LUSTRADOR)\b/, 'LIMPIEZA'],
    [/\b(KIT DE HERRAMIENTA|LLAVE ALLEN|LLAVE T|DESTORNILLADOR|ALICATE|PINZA|MARTILLO|CALIPER DIGITAL|EXTRACTOR)\b/, 'HERRAMIENTA'],
    [/\b(STICKER|CALCOMAN[IÍ]A|EMBLEMA|LOGO|ETIQUETA)\b/, 'ACCESORIOS'],
    [/\bACCESORIO\b/, 'ACCESORIOS'],
  ];
  for (const [rx, cat] of rules) if (rx.test(n)) return cat;
  return 'REPUESTOS';
}

// Parsea archivo NRP (Moto Partes): sku = col C (CÓDIGO CORTO), precio = col L (GRAL)
function parseNRP(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`ℹ No existe ${path.basename(filePath)} — se omite`);
    return [];
  }
  console.log(`→ Parseando ${path.basename(filePath)}`);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

  const productos = [];
  // Headers en fila 4 (idx 3), data desde fila 5 (idx 4)
  for (let r = 4; r < rows.length; r++) {
    const row = rows[r];
    const sku = (row[2] || '').toString().trim(); // col C = CÓDIGO CORTO
    if (!sku) continue;
    const nombre = (row[3] || '').toString().trim();
    if (!nombre) continue;
    const subgrupo = (row[4] || '').toString().trim();
    const marca = cleanMarca(row[5]);              // col F = MARCA
    const precio = parseMoney(row[11]);            // col L = GRAL
    if (!precio) continue;                          // sin precio no publico

    productos.push({
      sku,
      nombre,
      marca,
      categoria: inferCategoria(nombre) || subgrupo.split(/\s*-\s*/)[0].toUpperCase() || 'REPUESTOS',
      presentacion: (row[6] || 'UND').toString().trim(),
      empaque: '',
      precios: {
        publico: round2(precio),
        taller: round2(precio),
        distribuidor: round2(precio),
      },
      stock: 0,
      stock_status: 'out_of_stock',
      disponible: false,
      bodega_central: true,
      disponibilidad: 'a_pedido',
      fuente: 'NRP',
      imagen: findImage(sku),
      activo: true,
    });
  }
  console.log(`✓ ${productos.length} productos NRP "a pedido"`);
  return productos;
}

// Parsea archivo VINI: sku = col B, costo = col G. Aplica margen 1.7 → precio público.
function parseVINI(filePath, margen = 1.7) {
  if (!fs.existsSync(filePath)) {
    console.log(`ℹ No existe ${path.basename(filePath)} — se omite`);
    return [];
  }
  console.log(`→ Parseando ${path.basename(filePath)} (margen x${margen})`);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

  const productos = [];
  // Data desde fila 13 (idx 12). Entre productos hay filas en blanco.
  for (let r = 12; r < rows.length; r++) {
    const row = rows[r];
    const sku = (row[1] || '').toString().trim();       // col B = Codigo
    if (!sku) continue;
    // Skip filas de pie de reporte ("Usuario:", "VALOR DE INVENTARIO", "PAG...")
    if (/^(usuario|pag|valor)/i.test(sku)) continue;
    const nombre = (row[2] || '').toString().trim();    // descripción (merged C)
    if (!nombre) continue;
    const costo = parseMoney(row[6]);                    // col G = Costo
    if (!costo || costo <= 0) continue;
    const precio = costo * margen;

    productos.push({
      sku,
      nombre,
      marca: 'VINI',
      categoria: inferCategoria(nombre),
      presentacion: 'UND',
      empaque: '',
      precios: {
        publico: round2(precio),
        taller: round2(precio),
        distribuidor: round2(precio),
      },
      stock: 0,
      stock_status: 'out_of_stock',
      disponible: false,
      bodega_central: true,
      disponibilidad: 'a_pedido',
      fuente: 'VINI',
      imagen: findImage(sku),
      activo: true,
    });
  }
  console.log(`✓ ${productos.length} productos VINI "a pedido"`);
  return productos;
}

// Mapeo MEK "GRUPO" → categoría del catálogo web
const MEK_GRUPO_TO_CATEGORIA = {
  'MotorA': 'MOTOR', 'MotorB': 'MOTOR',
  'Electrico': 'ELECTRICOS', 'Luces': 'ELECTRICOS',
  'Freno': 'FRENOS',
  'Filtros': 'FILTROS',
  'Cable': 'CABLES',
  'Traccion': 'TRANSMISION', 'Transmisión': 'TRANSMISION',
  'Balinera': 'REPUESTOS MOTOR',
  'Sellos': 'REPUESTOS MOTOR',
  'Accesorios': 'ACCESORIOS',
  'Carroceria': 'CARROCERIA',
  'Control': 'CONTROLES',
};

// Parsea inventario MEK (Excel): sku=col A, descripcion=col E, grupo=col D
function parseMEK(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`ℹ No existe ${path.basename(filePath)} — se omite`);
    return [];
  }
  console.log(`→ Parseando ${path.basename(filePath)}`);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['REPUESTOS'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

  const productos = [];
  // Data desde fila 3 (índice 2). Rows 1-2 son headers.
  for (let r = 2; r < rows.length; r++) {
    const sku = (rows[r][0] || '').toString().trim();
    const grupo = (rows[r][3] || '').toString().trim();
    const nombre = (rows[r][4] || '').toString().trim();
    if (!sku || !nombre) continue;
    // SKU MEK es numérico (ej. "1001205")
    if (!/^\d+$/.test(sku.replace(/\s/g, ''))) continue;

    productos.push({
      sku,
      nombre,
      marca: 'MEK',
      categoria: MEK_GRUPO_TO_CATEGORIA[grupo] || inferCategoria(nombre) || 'REPUESTOS',
      presentacion: 'UND',
      empaque: '',
      // Sin precios visibles (decisión del usuario: a_pedido no muestra precio)
      precios: { publico: null, taller: null, distribuidor: null },
      stock: 0,
      stock_status: 'out_of_stock',
      disponible: false,
      bodega_central: true,
      disponibilidad: 'a_pedido',
      fuente: 'MEK',
      imagen: findImage(sku),
      activo: true,
    });
  }
  console.log(`✓ ${productos.length} productos MEK "a pedido"`);
  return productos;
}

// Parsea catálogo AXUS (PDF MOV Llantas): extrae SKU LA*-*-* + descripción siguiente
function parseAXUS(pdfPath) {
  if (!fs.existsSync(pdfPath)) {
    console.log(`ℹ No existe ${path.basename(pdfPath)} — se omite`);
    return [];
  }
  console.log(`→ Parseando ${path.basename(pdfPath)}`);
  // pdf-parse es async, pero para mantener sync.js como está, retornamos la promesa al caller
  return new Promise((resolve, reject) => {
    const pdf = require('pdf-parse');
    pdf(fs.readFileSync(pdfPath)).then(data => {
      const productos = [];
      const lines = data.text.split('\n');
      const skuLineRx = /^(LA[0-9][A-Z]?-\d+-\d+)\s+(\d+)\s+(\S+)\s+(\S+)/;
      const stopRx = /^(Δ\s*)?(\d+\+?|\$\s*[\d.,]+|\d+%|[\d.,]+%)/;

      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(skuLineRx);
        if (!m) continue;
        const sku = m[1];
        // Recolectar líneas de descripción (siguientes 1-5 líneas hasta que empiece con stock/precio)
        const descParts = [];
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const l = lines[j].trim();
          if (!l) continue;
          if (stopRx.test(l)) break;
          if (skuLineRx.test(l)) break; // otro SKU
          descParts.push(l);
          if (descParts.length >= 4) break;
        }
        const descripcion = descParts.join(' ').replace(/\s+/g, ' ').trim();
        if (!descripcion) continue;

        productos.push({
          sku,
          nombre: descripcion,
          marca: 'AXUS',
          categoria: 'LLANTAS',
          presentacion: 'UND',
          empaque: '',
          precios: { publico: null, taller: null, distribuidor: null },
          stock: 0,
          stock_status: 'out_of_stock',
          disponible: false,
          bodega_central: true,
          disponibilidad: 'a_pedido',
          fuente: 'AXUS',
          imagen: findImage(sku),
          activo: true,
        });
      }
      console.log(`✓ ${productos.length} productos AXUS "a pedido"`);
      resolve(productos);
    }).catch(reject);
  });
}

// Fusiona local + proveedores:
//  - SKUs en LCR: se mantienen con data LCR, pero se les setea bodega_central=true si también están en proveedor.
//  - SKUs solo en proveedor: se agregan como productos nuevos "a pedido".
//  - Si mismo SKU está en varios proveedores: gana el primero (NRP antes que VINI por orden).
function mergeProductos(local, proveedores /* array de arrays */) {
  const lcrSkus = new Set(local.map(p => p.sku.toUpperCase()));
  const flat = proveedores.flat();
  const proveedorSkus = new Set(flat.map(p => p.sku.toUpperCase()));

  // 1. Marcar productos LCR que también están en proveedor como bodega_central
  for (const p of local) {
    if (proveedorSkus.has(p.sku.toUpperCase())) {
      p.bodega_central = true;
      if (p.stock === 0) {
        p.disponibilidad = 'a_pedido';
        p.stock_status = 'out_of_stock'; // visual sigue siendo "a pedido" via disponibilidad
      }
    }
  }

  // 2. Agregar SKUs solo-proveedor (dedup entre proveedores)
  const added = new Set(lcrSkus);
  const extra = [];
  for (const p of flat) {
    const k = p.sku.toUpperCase();
    if (added.has(k)) continue;
    added.add(k);
    extra.push(p);
  }
  return { productos: [...local, ...extra], extraCount: extra.length };
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

function parseExcel(buf, bodegaSet = new Set()) {
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

    const enBodegaCentral = bodegaSet.has(codigo.toUpperCase());
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
      bodega_central: enBodegaCentral,
      // 3 estados: 'inmediato' (stock > 0), 'a_pedido' (stock=0 y bodega_central=true), 'agotado' (stock=0 y !bodega_central)
      disponibilidad: stock > 0 ? 'inmediato' : (enBodegaCentral ? 'a_pedido' : 'agotado'),
      imagen: findImage(codigo),
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

  const bodegaSet = loadBodegaCentral();
  console.log('→ Parseando Excel LCR');
  const localProductos = parseExcel(buf, bodegaSet);
  console.log(`✓ ${localProductos.length} productos locales (LCR)`);

  // Proveedores externos — archivos Excel dropeados en sync/
  const nrpList = parseNRP(path.join(__dirname, 'inventario_nrp.xlsx'));
  const viniList = parseVINI(path.join(__dirname, 'inventario_vini.XLS'));
  const mekList = parseMEK(path.join(__dirname, 'inventario_mek.xlsx'));
  const axusList = await parseAXUS(path.join(__dirname, 'inventario_axus.pdf'));

  const { productos, extraCount } = mergeProductos(localProductos, [nrpList, viniList, mekList, axusList]);
  const aPedido = productos.filter(p => p.disponibilidad === 'a_pedido').length;
  console.log(`✓ Merge: ${localProductos.length} LCR + ${extraCount} nuevos de proveedor = ${productos.length} total (${aPedido} "a pedido")`);

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

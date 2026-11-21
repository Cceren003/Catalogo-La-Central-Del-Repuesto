// ═══════════════════════════════════════════
// POST /api/cotizacion
//
// Emite una cotización con número verificable. El cliente arma el PDF,
// pero los precios y el número salen del servidor — no del localStorage.
//
// Body:
//   {
//     cliente: { nombre, tel, email, tipo, nit?, nrc?, giro?, dir? },
//     notas?: string,
//     items: [{ sku: string, qty: integer }]
//   }
//
// Respuesta OK:
//   {
//     ok: true,
//     numero: "261121-ABCD",           // guardado en D1, el PDF lo incluye
//     generated_at: <iso>,
//     nivel: "publico"|"taller"|...,
//     items: [{sku, nombre, marca, qty, precio_unit, subtotal}],
//     subtotal_sin_iva, iva, total_con_iva
//   }
//
// El admin puede buscar luego por `numero` en /admin → Cotizaciones y
// comparar vs el PDF que trajo el cliente.
// ═══════════════════════════════════════════

import { getSession } from '../_lib/auth.js';
import { logAccess } from '../_lib/db.js';
import { ok, err, json, getClientIp, getUserAgent } from '../_lib/http.js';

const IVA_RATE = 0.13;

// Cache en memoria del catalogo durante la vida del isolate.
// Cloudflare Workers tiene isolates efímeros — cada N minutos se recrea.
// Esto nos ahorra fetches repetidos a ASSETS en la misma invocación-cluster.
let CATALOG_CACHE = null;
let MAYORISTA_CACHE = null;

async function readJsonAsset(env, request, path) {
  const origin = new URL(request.url).origin;
  const r = await env.ASSETS.fetch(new Request(`${origin}${path}`));
  if (!r.ok) throw new Error(`asset ${path}: HTTP ${r.status}`);
  return r.json();
}

async function getCatalog(env, request) {
  if (!CATALOG_CACHE) CATALOG_CACHE = await readJsonAsset(env, request, '/catalogo.json');
  return CATALOG_CACHE;
}
async function getMayorista(env, request) {
  if (!MAYORISTA_CACHE) MAYORISTA_CACHE = await readJsonAsset(env, request, '/_sync/mayorista.json');
  return MAYORISTA_CACHE;
}

// Genera número: YYMMDD-XXXX (hex de 4 caracteres de un random de 16 bits)
function generateNumero() {
  const d = new Date();
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const randBytes = crypto.getRandomValues(new Uint8Array(2));
  const hex = Array.from(randBytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${yy}${mm}${dd}-${hex}`;
}

function round2(n) { return Math.round(n * 100) / 100; }

async function createWithUniqueNumero(db, data, attempt = 0) {
  if (attempt > 5) throw new Error('No se pudo generar un número único');
  const numero = generateNumero();
  try {
    const r = await db.prepare(`
      INSERT INTO cotizaciones (
        numero, session_user_id, session_codigo, session_nivel,
        cliente_nombre, cliente_tel, cliente_email, cliente_tipo,
        cliente_nit, cliente_nrc, cliente_giro, cliente_dir, notas,
        items_json, subtotal_sin_iva, iva, total_con_iva,
        ip, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id, ts
    `).bind(
      numero,
      data.session_user_id, data.session_codigo, data.session_nivel,
      data.cliente_nombre, data.cliente_tel, data.cliente_email, data.cliente_tipo,
      data.cliente_nit, data.cliente_nrc, data.cliente_giro, data.cliente_dir, data.notas,
      data.items_json, data.subtotal_sin_iva, data.iva, data.total_con_iva,
      data.ip, data.user_agent,
    ).first();
    return { numero, id: r.id, ts: r.ts };
  } catch (e) {
    // UNIQUE constraint: colisión → retry con otro número
    if (/UNIQUE/i.test(e.message || '')) return createWithUniqueNumero(db, data, attempt + 1);
    throw e;
  }
}

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  if (!db) return err('server_not_configured', 500);

  let body;
  try { body = await request.json(); }
  catch { return err('JSON inválido', 400); }

  const cliente = body?.cliente || {};
  const items = Array.isArray(body?.items) ? body.items : [];
  const notas = body?.notas ? String(body.notas).trim().slice(0, 1000) : null;

  // ─── Validación cliente ───
  if (!cliente.nombre || typeof cliente.nombre !== 'string' || !cliente.nombre.trim()) {
    return err('cliente.nombre requerido', 400);
  }
  if (!cliente.tel || !String(cliente.tel).trim()) {
    return err('cliente.tel requerido', 400);
  }
  const tipo = String(cliente.tipo || '').trim();
  if (!['Consumidor Final', 'Crédito Fiscal'].includes(tipo)) {
    return err('cliente.tipo debe ser "Consumidor Final" o "Crédito Fiscal"', 400);
  }
  if (tipo === 'Crédito Fiscal') {
    const faltan = [];
    for (const k of ['nit', 'nrc', 'giro', 'dir', 'email']) {
      if (!cliente[k] || !String(cliente[k]).trim()) faltan.push(k);
    }
    if (faltan.length) return err(`Crédito Fiscal requiere: ${faltan.join(', ')}`, 400);
  }

  if (items.length === 0) return err('items vacío', 400);
  if (items.length > 500) return err('Demasiados items (max 500)', 400);

  // ─── Sesión actual ───
  const session = await getSession(request, env);
  const nivel = session?.nivel || 'publico';
  const session_user_id = session?.sub ?? null;
  const session_codigo  = session?.codigo ?? null;

  // ─── Resolver precios desde fuentes autoritativas del server ───
  let catalog, catalogBySku, mayoristaBySku = {};
  try {
    catalog = await getCatalog(env, request);
    catalogBySku = new Map();
    for (const p of catalog.productos || []) catalogBySku.set(p.sku, p);
  } catch (e) {
    return err('No se pudo leer catálogo: ' + e.message, 500);
  }
  if (nivel === 'taller' || nivel === 'distribuidor' || nivel === 'admin') {
    try {
      const m = await getMayorista(env, request);
      mayoristaBySku = m.precios || {};
    } catch (e) {
      console.warn('No se pudo leer mayorista:', e.message);
    }
  }

  // ─── Construir resolved items ───
  const resolved = [];
  const errores = [];
  let totalConIva = 0;

  for (const raw of items) {
    const sku = String(raw?.sku || '').trim();
    const qty = parseInt(raw?.qty, 10);
    if (!sku) { errores.push({ sku: null, error: 'sku vacío' }); continue; }
    if (!qty || qty < 1) { errores.push({ sku, error: 'qty inválida' }); continue; }
    if (qty > 10000) { errores.push({ sku, error: 'qty > 10000' }); continue; }

    const p = catalogBySku.get(sku);
    if (!p) { errores.push({ sku, error: 'SKU no existe en catálogo' }); continue; }

    // Pick price por nivel. Fallback graceful: si no hay mayorista para ese SKU, usa publico.
    let precio_unit;
    if (nivel === 'taller') {
      precio_unit = mayoristaBySku[sku]?.taller ?? p.precios?.publico;
    } else if (nivel === 'distribuidor') {
      precio_unit = mayoristaBySku[sku]?.distribuidor ?? p.precios?.publico;
    } else {
      precio_unit = p.precios?.publico;
    }
    if (precio_unit == null) { errores.push({ sku, error: 'sin precio disponible' }); continue; }

    const subtotal = round2(precio_unit * qty);
    totalConIva += subtotal;

    resolved.push({
      sku,
      nombre: p.nombre,
      marca: p.marca || null,
      presentacion: p.presentacion || null,
      qty,
      precio_unit: round2(precio_unit),
      subtotal,
    });
  }

  if (resolved.length === 0) {
    return json({
      ok: false,
      error: 'Ningún item resolvió a precio válido',
      code: 'no_items_valid',
      errores,
    }, 400);
  }

  totalConIva = round2(totalConIva);
  const subtotalSinIva = round2(totalConIva / (1 + IVA_RATE));
  const iva = round2(totalConIva - subtotalSinIva);

  // ─── Guardar en D1 ───
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  let saved;
  try {
    saved = await createWithUniqueNumero(db, {
      session_user_id,
      session_codigo,
      session_nivel: nivel,
      cliente_nombre: cliente.nombre.trim().slice(0, 200),
      cliente_tel:    String(cliente.tel).trim().slice(0, 50),
      cliente_email:  cliente.email ? String(cliente.email).trim().slice(0, 200) : null,
      cliente_tipo:   tipo,
      cliente_nit:    cliente.nit  ? String(cliente.nit).trim().slice(0, 50)  : null,
      cliente_nrc:    cliente.nrc  ? String(cliente.nrc).trim().slice(0, 50)  : null,
      cliente_giro:   cliente.giro ? String(cliente.giro).trim().slice(0, 300) : null,
      cliente_dir:    cliente.dir  ? String(cliente.dir).trim().slice(0, 300) : null,
      notas,
      items_json: JSON.stringify(resolved),
      subtotal_sin_iva: subtotalSinIva,
      iva,
      total_con_iva: totalConIva,
      ip, user_agent: ua,
    });
  } catch (e) {
    return err('No se pudo guardar la cotización: ' + e.message, 500);
  }

  // Access log (no bloqueante)
  logAccess(db, {
    userId: session_user_id,
    codigo: session_codigo,
    ip, ua,
    accion: 'cotizacion_emit',
    ok: true,
    detalle: `${saved.numero} · ${resolved.length} items · $${totalConIva.toFixed(2)} · nivel=${nivel}${errores.length ? ' · skipped=' + errores.length : ''}`,
  }).catch(() => {});

  return ok({
    numero: saved.numero,
    generated_at: new Date(saved.ts * 1000).toISOString(),
    nivel,
    items: resolved,
    errores: errores.length ? errores : undefined,
    subtotal_sin_iva: subtotalSinIva,
    iva,
    total_con_iva: totalConIva,
  });
}

export async function onRequest(ctx) {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'POST' } });
}

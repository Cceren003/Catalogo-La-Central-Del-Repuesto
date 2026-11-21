// ═══════════════════════════════════════════
// GET /api/catalogo/mayorista
// Devuelve los precios mayoristas correspondientes al nivel del usuario autenticado.
// Para taller:       { sku: { taller: N } }
// Para distribuidor: { sku: { distribuidor: N } }
// Para admin:        { sku: { taller: N, distribuidor: N } }
//
// La fuente es /_sync/mayorista.json (archivo bloqueado al público,
// accesible desde esta función via env.ASSETS.fetch que bypassa el routing).
// ═══════════════════════════════════════════

import { requireSession } from '../../_lib/auth.js';
import { logAccess } from '../../_lib/db.js';
import { ok, err, getClientIp, getUserAgent } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  let session;
  try {
    session = await requireSession(request, env);
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  // Leer archivo protegido via env.ASSETS (saltea el bloqueador de /_sync/*)
  let data;
  try {
    const origin = new URL(request.url).origin;
    const assetResp = await env.ASSETS.fetch(new Request(`${origin}/_sync/mayorista.json`));
    if (!assetResp.ok) {
      return err('mayorista_file_missing', 500, 'no_source');
    }
    data = await assetResp.json();
  } catch (e) {
    return err('cannot_read_mayorista', 500, 'read_error');
  }

  const precios = data?.precios || {};
  const nivel = session.nivel;

  // Filtrar según el nivel de la sesión
  let filtered;
  if (nivel === 'taller') {
    filtered = {};
    for (const [sku, p] of Object.entries(precios)) {
      if (p?.taller != null) filtered[sku] = { taller: p.taller };
    }
  } else if (nivel === 'distribuidor') {
    filtered = {};
    for (const [sku, p] of Object.entries(precios)) {
      if (p?.distribuidor != null) filtered[sku] = { distribuidor: p.distribuidor };
    }
  } else if (nivel === 'admin') {
    filtered = precios; // admin ve todo
  } else {
    return err('nivel_invalido', 403);
  }

  // Log del fetch (para auditoría)
  if (env.DB) {
    env.DB.prepare(
      'INSERT INTO access_log (user_id, codigo, ip, user_agent, accion, ok, detalle) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      session.sub ?? null,
      session.codigo ?? null,
      getClientIp(request),
      getUserAgent(request),
      'fetch_mayorista',
      1,
      `nivel=${nivel} count=${Object.keys(filtered).length}`,
    ).run().catch(() => { /* no bloquear respuesta por falla de log */ });
  }

  return ok({
    nivel,
    generated_at: data.generated_at,
    count: Object.keys(filtered).length,
    precios: filtered,
  });
}

export async function onRequest(ctx) {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { 'Allow': 'GET' },
  });
}

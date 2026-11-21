// ═══════════════════════════════════════════
// GET /api/admin/cotizaciones
//   Query params:
//     limit (default 50, max 500)
//     search (match en numero o cliente_nombre o session_codigo)
//     nivel (publico | taller | distribuidor | admin)
//     since (unix seconds, default: últimos 30 días)
// Requiere nivel admin.
// ═══════════════════════════════════════════

import { requireSession } from '../../_lib/auth.js';
import { ok, err } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  try { await requireSession(request, env, { nivelesPermitidos: ['admin'] }); }
  catch (r) { if (r instanceof Response) return r; throw r; }

  const db = env.DB;
  if (!db) return err('server_not_configured', 500);

  const url = new URL(request.url);
  const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '50', 10) || 50);
  const search = (url.searchParams.get('search') || '').trim();
  const nivel = url.searchParams.get('nivel');
  const sinceParam = parseInt(url.searchParams.get('since') || '0', 10);
  const since = sinceParam || (Math.floor(Date.now() / 1000) - 30 * 86400);

  const where = ['ts >= ?'];
  const binds = [since];

  if (search) {
    where.push('(numero LIKE ? OR cliente_nombre LIKE ? OR session_codigo LIKE ?)');
    const like = `%${search}%`;
    binds.push(like, like, like);
  }
  if (nivel && ['publico', 'taller', 'distribuidor', 'admin'].includes(nivel)) {
    where.push('session_nivel = ?');
    binds.push(nivel);
  }

  binds.push(limit);

  const sql = `
    SELECT id, numero, session_codigo, session_nivel,
           cliente_nombre, cliente_tel, cliente_tipo,
           subtotal_sin_iva, iva, total_con_iva,
           ts, ip
    FROM cotizaciones
    WHERE ${where.join(' AND ')}
    ORDER BY ts DESC
    LIMIT ?
  `;

  const { results } = await db.prepare(sql).bind(...binds).all();
  return ok({ count: (results || []).length, cotizaciones: results || [] });
}

export async function onRequest(ctx) {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'GET' } });
}

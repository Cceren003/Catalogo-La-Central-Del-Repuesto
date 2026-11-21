// ═══════════════════════════════════════════
// GET /api/admin/access-log?codigo=TAL-DURAN&limit=100
// Lista las últimas acciones del access_log. Requiere nivel admin.
// ═══════════════════════════════════════════

import { requireSession } from '../../_lib/auth.js';
import { recentAccessLog } from '../../_lib/db.js';
import { ok, err } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  try { await requireSession(request, env, { nivelesPermitidos: ['admin'] }); }
  catch (r) { if (r instanceof Response) return r; throw r; }

  const db = env.DB;
  if (!db) return err('server_not_configured', 500);

  const url = new URL(request.url);
  const codigo = url.searchParams.get('codigo');
  const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '100', 10) || 100);

  const entries = await recentAccessLog(db, { codigo, limit });
  return ok({ count: entries.length, entries });
}

export async function onRequest(ctx) {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'GET' } });
}

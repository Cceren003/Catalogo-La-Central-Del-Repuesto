// ═══════════════════════════════════════════
// POST /api/auth/logout
// Borra la cookie de sesión y loguea el logout.
// ═══════════════════════════════════════════

import { getSession, clearCookie, COOKIE_NAME } from '../../_lib/auth.js';
import { logAccess } from '../../_lib/db.js';
import { ok, getClientIp, getUserAgent } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  const session = await getSession(request, env);
  if (session && db) {
    await logAccess(db, {
      userId: session.sub ?? null,
      codigo: session.codigo ?? null,
      ip: getClientIp(request),
      ua: getUserAgent(request),
      accion: 'logout',
      ok: true,
    });
  }
  return ok({}, { 'Set-Cookie': clearCookie(COOKIE_NAME) });
}

export async function onRequest(ctx) {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { 'Allow': 'POST' },
  });
}

// ═══════════════════════════════════════════
// GET /api/auth/me
// Devuelve la sesión actual (si existe), o 401.
// Usado por el frontend al cargar la página para saber si ya hay sesión activa.
// ═══════════════════════════════════════════

import { getSession } from '../../_lib/auth.js';
import { ok, err } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return err('no_session', 401);
  return ok({
    codigo: session.codigo,
    nivel: session.nivel,
    nombre: session.nombre,
    exp: session.exp,
  });
}

export async function onRequest(ctx) {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { 'Allow': 'GET' },
  });
}

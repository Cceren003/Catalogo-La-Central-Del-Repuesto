// ═══════════════════════════════════════════
// POST /api/auth/login
// Body JSON: { codigo: string, password: string }
// Respuesta OK: { ok: true, nivel, nombre, codigo } + cookie httpOnly
// Respuesta ERROR: 401 { ok: false, error }, 429 si rate-limited
// ═══════════════════════════════════════════

import { getUserByCodigo, updateLastAccess, logAccess, recordLoginAttempt } from '../../_lib/db.js';
import { verifyPassword } from '../../_lib/password.js';
import { issueSession } from '../../_lib/auth.js';
import { checkLoginRateLimit, RATE_LIMIT_CONFIG } from '../../_lib/rate-limit.js';
import { ok, err, getClientIp, getUserAgent } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);
  const db = env.DB;

  if (!db || !env.JWT_SECRET) {
    return err('server_not_configured', 500);
  }

  // Rate limit por IP
  const rl = await checkLoginRateLimit(db, ip);
  if (!rl.allowed) {
    return err(
      `Demasiados intentos fallidos. Intentá de nuevo en ${Math.ceil(rl.retryAfter / 60)} minutos.`,
      429, 'rate_limited'
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return err('JSON inválido', 400);
  }

  const codigo = (body?.codigo || '').toString().trim().toUpperCase();
  const password = (body?.password || '').toString();

  if (!codigo || !password) {
    return err('código y contraseña son requeridos', 400);
  }

  // Timing-safe: siempre consultamos la DB y hacemos verifyPassword aunque el user no exista,
  // para que el response time no filtre "este código existe".
  const user = await getUserByCodigo(db, codigo);
  const storedHash = user?.password_hash || 'pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const passOk = await verifyPassword(password, storedHash);

  const userOk = user && user.activo === 1 && passOk;

  // Registrar intento (para rate limit) y access_log
  await recordLoginAttempt(db, ip, codigo, userOk);
  await logAccess(db, {
    userId: user?.id ?? null,
    codigo,
    ip, ua,
    accion: userOk ? 'login' : 'login_fail',
    ok: userOk,
    detalle: !user ? 'codigo_no_existe' : !user.activo ? 'desactivado' : !passOk ? 'password_mala' : null,
  });

  if (!userOk) {
    return err('Credenciales inválidas', 401, 'bad_credentials');
  }

  await updateLastAccess(db, user.id);

  const cookie = await issueSession({
    userId: user.id,
    codigo: user.codigo,
    nivel: user.nivel,
    nombre: user.nombre,
  }, env);

  return ok({
    nivel: user.nivel,
    codigo: user.codigo,
    nombre: user.nombre,
  }, { 'Set-Cookie': cookie });
}

// Rechaza otros métodos con 405
export async function onRequest({ request }) {
  if (request.method === 'POST') return onRequestPost(arguments[0]);
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { 'Allow': 'POST' },
  });
}

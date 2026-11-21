// ═══════════════════════════════════════════
// Session helpers — extraer/setear cookie firmada JWT.
// ═══════════════════════════════════════════

import { verifyJWT, signJWT } from './jwt.js';

export const COOKIE_NAME = 'lcr_sess';
const DEFAULT_MAX_AGE_SEC = 86400; // 24h

export function getCookie(request, name) {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

export function buildCookie(name, value, { maxAgeSec = DEFAULT_MAX_AGE_SEC } = {}) {
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSec}`,
  ].join('; ');
}

export function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function getSession(request, env) {
  const secret = env.JWT_SECRET;
  if (!secret) return null;
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return null;
  return verifyJWT(token, secret);
}

export async function issueSession({ userId, codigo, nivel, nombre }, env, { maxAgeSec = DEFAULT_MAX_AGE_SEC } = {}) {
  const secret = env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET no configurada');
  const token = await signJWT({ sub: userId, codigo, nivel, nombre }, secret, maxAgeSec);
  return buildCookie(COOKIE_NAME, token, { maxAgeSec });
}

// Guard rápido: devuelve la sesión si el usuario está autenticado y tiene nivel permitido.
// Si no, lanza una Response lista para devolver (401 o 403).
export async function requireSession(request, env, { nivelesPermitidos } = {}) {
  const session = await getSession(request, env);
  if (!session) {
    throw new Response(JSON.stringify({ ok: false, error: 'no_session' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (nivelesPermitidos && !nivelesPermitidos.includes(session.nivel)) {
    throw new Response(JSON.stringify({ ok: false, error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  return session;
}

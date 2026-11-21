// ═══════════════════════════════════════════
// /api/admin/users
//   GET  → lista todos los usuarios (incluye inactivos)
//   POST → crea un usuario y devuelve la contraseña generada (ÚNICA vez)
// Requiere nivel admin.
// ═══════════════════════════════════════════

import { requireSession } from '../../_lib/auth.js';
import { listUsers, createUser, logAccess } from '../../_lib/db.js';
import { hashPassword, generateRandomPassword } from '../../_lib/password.js';
import { ok, err, getClientIp, getUserAgent } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  let session;
  try { session = await requireSession(request, env, { nivelesPermitidos: ['admin'] }); }
  catch (r) { if (r instanceof Response) return r; throw r; }

  const db = env.DB;
  if (!db) return err('server_not_configured', 500);

  const users = await listUsers(db, { includeInactive: true });
  return ok({ users });
}

export async function onRequestPost({ request, env }) {
  let session;
  try { session = await requireSession(request, env, { nivelesPermitidos: ['admin'] }); }
  catch (r) { if (r instanceof Response) return r; throw r; }

  const db = env.DB;
  if (!db) return err('server_not_configured', 500);

  let body;
  try { body = await request.json(); }
  catch { return err('JSON inválido', 400); }

  const codigo = (body?.codigo || '').toString().trim().toUpperCase();
  const nivel = (body?.nivel || '').toString().trim();
  const nombre = body?.nombre ? String(body.nombre).trim() : null;
  const telefono = body?.telefono ? String(body.telefono).trim() : null;
  const notas = body?.notas ? String(body.notas).trim() : null;

  if (!codigo || !/^[A-Z0-9][-A-Z0-9_]{1,30}$/i.test(codigo)) {
    return err('Código inválido. Usá letras, números y guión (2-32 caracteres).', 400);
  }
  if (!['taller', 'distribuidor', 'admin'].includes(nivel)) {
    return err('Nivel inválido. Debe ser taller, distribuidor o admin.', 400);
  }

  // Verificar unicidad
  const existing = await db.prepare('SELECT id FROM users WHERE codigo = ?').bind(codigo).first();
  if (existing) return err(`El código "${codigo}" ya existe.`, 409);

  const password = generateRandomPassword();
  const passwordHash = await hashPassword(password);

  let created;
  try {
    created = await createUser(db, { codigo, passwordHash, nivel, nombre, telefono, notas });
  } catch (e) {
    return err('No se pudo crear el usuario: ' + e.message, 500);
  }

  await logAccess(db, {
    userId: session.sub ?? null,
    codigo: session.codigo ?? null,
    ip: getClientIp(request),
    ua: getUserAgent(request),
    accion: 'admin_create',
    ok: true,
    detalle: `creó ${codigo} (${nivel})`,
  });

  return ok({
    id: created.id,
    codigo,
    nivel,
    password, // ÚNICA vez que se devuelve en claro
    nombre, telefono, notas,
  });
}

export async function onRequest(ctx) {
  const m = ctx.request.method;
  if (m === 'GET')  return onRequestGet(ctx);
  if (m === 'POST') return onRequestPost(ctx);
  return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'GET, POST' } });
}

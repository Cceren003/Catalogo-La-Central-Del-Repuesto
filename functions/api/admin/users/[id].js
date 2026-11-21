// ═══════════════════════════════════════════
// /api/admin/users/:id
//   PATCH body: { activo? | nombre? | telefono? | notas? | reset_password? }
//     reset_password: true → genera y devuelve nueva contraseña (ÚNICA vez)
// Requiere nivel admin.
// ═══════════════════════════════════════════

import { requireSession } from '../../../_lib/auth.js';
import {
  getUserById,
  updateUserActivo,
  updateUserPassword,
  updateUserFields,
  logAccess,
} from '../../../_lib/db.js';
import { hashPassword, generateRandomPassword } from '../../../_lib/password.js';
import { ok, err, getClientIp, getUserAgent } from '../../../_lib/http.js';

export async function onRequestPatch({ request, env, params }) {
  let session;
  try { session = await requireSession(request, env, { nivelesPermitidos: ['admin'] }); }
  catch (r) { if (r instanceof Response) return r; throw r; }

  const db = env.DB;
  if (!db) return err('server_not_configured', 500);

  const id = parseInt(params.id, 10);
  if (!id) return err('id inválido', 400);

  const target = await getUserById(db, id);
  if (!target) return err('Usuario no existe', 404);

  let body;
  try { body = await request.json(); }
  catch { return err('JSON inválido', 400); }

  // Evitar que un admin se auto-desactive accidentalmente
  if (body.activo === false && target.id === session.sub) {
    return err('No podés desactivarte a vos mismo', 400);
  }

  const changes = [];
  const result = { id: target.id, codigo: target.codigo };

  if (body.activo !== undefined) {
    await updateUserActivo(db, id, !!body.activo);
    changes.push(body.activo ? 'activado' : 'desactivado');
    result.activo = !!body.activo;
  }

  if (body.nombre !== undefined || body.telefono !== undefined || body.notas !== undefined) {
    // Merge: mantener los valores que no vinieron en el body
    await updateUserFields(db, id, {
      nombre:   body.nombre   !== undefined ? body.nombre   : target.nombre,
      telefono: body.telefono !== undefined ? body.telefono : target.telefono,
      notas:    body.notas    !== undefined ? body.notas    : target.notas,
    });
    changes.push('datos editados');
  }

  if (body.reset_password === true) {
    const newPass = generateRandomPassword();
    const hash = await hashPassword(newPass);
    await updateUserPassword(db, id, hash);
    changes.push('password reset');
    result.password = newPass; // ÚNICA vez
  }

  if (changes.length === 0) {
    return err('Nada que actualizar', 400);
  }

  await logAccess(db, {
    userId: session.sub ?? null,
    codigo: session.codigo ?? null,
    ip: getClientIp(request),
    ua: getUserAgent(request),
    accion: body.reset_password ? 'admin_reset_pw' : 'admin_edit',
    ok: true,
    detalle: `${target.codigo}: ${changes.join(', ')}`,
  });

  return ok(result);
}

export async function onRequest(ctx) {
  if (ctx.request.method === 'PATCH') return onRequestPatch(ctx);
  return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'PATCH' } });
}

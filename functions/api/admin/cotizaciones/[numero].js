// ═══════════════════════════════════════════
// GET /api/admin/cotizaciones/:numero
// Devuelve el detalle completo de la cotización emitida por el server.
// Usado cuando el admin quiere verificar una cotización que trae un cliente.
// Requiere nivel admin.
// ═══════════════════════════════════════════

import { requireSession } from '../../../_lib/auth.js';
import { ok, err } from '../../../_lib/http.js';

export async function onRequestGet({ request, env, params }) {
  try { await requireSession(request, env, { nivelesPermitidos: ['admin'] }); }
  catch (r) { if (r instanceof Response) return r; throw r; }

  const db = env.DB;
  if (!db) return err('server_not_configured', 500);

  const numero = String(params.numero || '').trim().toUpperCase();
  if (!/^\d{6}-[A-F0-9]{4}$/.test(numero)) {
    return err('Formato de número inválido. Esperado: YYMMDD-XXXX', 400);
  }

  const row = await db.prepare(`
    SELECT * FROM cotizaciones WHERE numero = ?
  `).bind(numero).first();

  if (!row) return err('Cotización no encontrada', 404);

  // Parsear items_json a objeto para respuesta más útil al admin
  let items = [];
  try { items = JSON.parse(row.items_json); } catch {}

  return ok({
    numero: row.numero,
    emitida_en: row.ts,
    nivel: row.session_nivel,
    session_codigo: row.session_codigo,
    cliente: {
      nombre: row.cliente_nombre,
      tel: row.cliente_tel,
      email: row.cliente_email,
      tipo: row.cliente_tipo,
      nit: row.cliente_nit,
      nrc: row.cliente_nrc,
      giro: row.cliente_giro,
      dir: row.cliente_dir,
    },
    notas: row.notas,
    items,
    totales: {
      subtotal_sin_iva: row.subtotal_sin_iva,
      iva: row.iva,
      total_con_iva: row.total_con_iva,
    },
    metadata: {
      ip: row.ip,
      user_agent: row.user_agent,
    },
  });
}

export async function onRequest(ctx) {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'GET' } });
}

// ═══════════════════════════════════════════
// Helpers para respuestas JSON + extracción de IP cliente.
// ═══════════════════════════════════════════

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

export function ok(data = {}, extraHeaders = {}) {
  return json({ ok: true, ...data }, 200, extraHeaders);
}

export function err(message, status = 400, code = null) {
  return json({ ok: false, error: message, code }, status);
}

export function getClientIp(request) {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf;
  const xff = request.headers.get('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

export function getUserAgent(request) {
  return (request.headers.get('User-Agent') || '').slice(0, 500);
}

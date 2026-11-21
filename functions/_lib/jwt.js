// ═══════════════════════════════════════════
// JWT HS256 firma + verificación.
// Usado para el token de sesión guardado en cookie httpOnly.
// ═══════════════════════════════════════════

function bufToUrlB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function urlB64ToBuf(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - s.length % 4) % 4);
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function strToUrlB64(s) {
  return bufToUrlB64(new TextEncoder().encode(s).buffer);
}

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bufToUrlB64(sig);
}

function constantTimeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signJWT(payload, secret, expiresInSec = 86400) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSec };
  const h = strToUrlB64(JSON.stringify(header));
  const p = strToUrlB64(JSON.stringify(fullPayload));
  const sig = await hmacSign(secret, `${h}.${p}`);
  return `${h}.${p}.${sig}`;
}

export async function verifyJWT(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = await hmacSign(secret, `${h}.${p}`);
  if (!constantTimeEqualStr(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(urlB64ToBuf(p)));
  } catch {
    return null;
  }
  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}

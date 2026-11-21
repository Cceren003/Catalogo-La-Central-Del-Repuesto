// ═══════════════════════════════════════════
// Hash de contraseñas — PBKDF2-SHA256 con 210k iteraciones.
// Formato guardado: pbkdf2$<iters>$<salt_b64>$<hash_b64>
// Native crypto.subtle (sin dependencias externas).
// Recomendación OWASP 2023: PBKDF2-SHA256 ≥ 600k iter, o scrypt/argon2id si disponibles.
// CF Workers no soporta scrypt nativo, por eso usamos PBKDF2 con 210k
// (compromiso entre seguridad y latencia en Workers free tier).
// ═══════════════════════════════════════════

const ITERATIONS  = 210000;
const HASH_LENGTH = 32; // bytes (SHA-256 = 32 bytes)
const SALT_LENGTH = 16; // bytes

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function deriveKey(password, salt, iterations) {
  const enc = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey(
    'raw', enc, { name: 'PBKDF2' }, false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    HASH_LENGTH * 8
  );
}

// Comparación timing-safe sobre strings de base64.
function constantTimeEqualBytes(a, b) {
  const aArr = new Uint8Array(a);
  const bArr = new Uint8Array(b);
  if (aArr.length !== bArr.length) return false;
  let diff = 0;
  for (let i = 0; i < aArr.length; i++) diff |= aArr[i] ^ bArr[i];
  return diff === 0;
}

export async function hashPassword(password) {
  if (!password || typeof password !== 'string') throw new Error('password requerida');
  if (password.length < 8) throw new Error('password muy corta (mínimo 8 caracteres)');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKey(password, salt.buffer, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${bufToB64(salt.buffer)}$${bufToB64(key)}`;
}

export async function verifyPassword(password, stored) {
  if (!password || !stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iters = parseInt(parts[1], 10);
  if (!iters || iters < 10000) return false;
  let saltBuf, storedKey;
  try {
    saltBuf   = b64ToBuf(parts[2]);
    storedKey = b64ToBuf(parts[3]);
  } catch {
    return false;
  }
  const key = await deriveKey(password, saltBuf, iters);
  return constantTimeEqualBytes(key, storedKey);
}

// ═══════════════════════════════════════════
// Rate limit básico para login — usa D1 directamente.
// 5 intentos fallidos / 15 minutos / IP. Si excede: 429.
// ═══════════════════════════════════════════

import { countRecentFailedLogins } from './db.js';

const WINDOW_SEC   = 900; // 15 min
const MAX_ATTEMPTS = 5;

export async function checkLoginRateLimit(db, ip) {
  const failed = await countRecentFailedLogins(db, ip, WINDOW_SEC);
  if (failed >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfter: WINDOW_SEC, failed };
  }
  return { allowed: true, remaining: MAX_ATTEMPTS - failed };
}

export const RATE_LIMIT_CONFIG = { WINDOW_SEC, MAX_ATTEMPTS };

// ═══════════════════════════════════════════
// Auth — login + role level (publico / taller / distribuidor)
// Passwords hardcoded v1 (no backend). Session in localStorage.
// API: window.Auth.{currentLevel, currentRole, login, logout, subscribe}
// ═══════════════════════════════════════════

(() => {
  const KEY = 'lcr_auth_v1';
  const listeners = new Set();

  // Tabla password → rol. Cambiar en config centralizada cuando haya backend.
  const PASSWORDS = {
    'MAYOR2024': { level: 'taller',       label: 'Taller'       },
    'DIST2024':  { level: 'distribuidor', label: 'Distribuidor' },
  };

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)); }
    catch { return null; }
  }
  function save(session) {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
    listeners.forEach(fn => fn(session));
  }

  let session = load();

  function login(password) {
    const entry = PASSWORDS[(password || '').trim()];
    if (!entry) return { ok: false, error: 'Contraseña inválida' };
    session = { level: entry.level, label: entry.label, at: Date.now() };
    save(session);
    return { ok: true, session };
  }

  function logout() {
    session = null;
    save(null);
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn(session);
    return () => listeners.delete(fn);
  }

  window.Auth = {
    get currentLevel() { return session ? session.level : 'publico'; },
    get currentRole() { return session; },
    login, logout, subscribe,
  };
})();

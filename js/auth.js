// ═══════════════════════════════════════════
// Auth — DESHABILITADO temporalmente por motivos de seguridad.
// El sistema de acceso con contraseña hardcoded fue retirado (passwords
// quedaron expuestas). Mientras se implementa auth real con servidor
// (Cloudflare Pages Functions), el nivel de precio siempre es 'publico'.
// Los precios mayoristas se atienden exclusivamente por WhatsApp.
// API: window.Auth.{currentLevel, currentRole, login, logout, subscribe}
// ═══════════════════════════════════════════

(() => {
  const KEY = 'lcr_auth_v1';
  const listeners = new Set();

  // Al cargar, limpiamos cualquier sesión vieja en localStorage.
  // Los visitantes que tenían sesión activa quedan como 'publico' hasta
  // que vuelva el login con backend.
  try { localStorage.removeItem(KEY); } catch {}

  function login() {
    return {
      ok: false,
      error: 'Acceso mayorista temporalmente deshabilitado por mantenimiento. ' +
             'Los precios de taller y distribuidor se atienden por WhatsApp: ' +
             '7030-1941 (ventas).',
    };
  }

  function logout() {
    listeners.forEach(fn => fn(null));
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn(null);
    return () => listeners.delete(fn);
  }

  window.Auth = {
    get currentLevel() { return 'publico'; },
    get currentRole() { return null; },
    login, logout, subscribe,
  };
})();

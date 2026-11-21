// ═══════════════════════════════════════════
// Auth — sesión validada en SERVIDOR (Cloudflare Pages Functions + D1).
// Reemplaza el stub inseguro anterior. Las contraseñas NO viajan al cliente:
// cada login hace POST /api/auth/login y el server devuelve una cookie
// httpOnly firmada JWT (24h) que el browser presenta en pedidos siguientes.
//
// API pública:
//   window.Auth.currentLevel   → 'publico' | 'taller' | 'distribuidor' | 'admin'
//   window.Auth.currentSession → { codigo, nivel, nombre, exp } | null
//   window.Auth.login(codigo, password) → Promise<{ok, error?, session?}>
//   window.Auth.logout() → Promise<void>
//   window.Auth.subscribe(fn) → fn(session|null) al suscribir y en cada cambio
//   window.Auth.ready → Promise que resuelve cuando terminó el check inicial
// ═══════════════════════════════════════════

(() => {
  const listeners = new Set();
  let session = null;
  let readyResolve;
  const ready = new Promise(r => { readyResolve = r; });

  function notify() {
    listeners.forEach(fn => { try { fn(session); } catch (e) { console.error(e); } });
  }

  async function check() {
    try {
      const r = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      if (r.ok) {
        const data = await r.json();
        if (data && data.ok) {
          session = { codigo: data.codigo, nivel: data.nivel, nombre: data.nombre, exp: data.exp };
        }
      }
    } catch (e) {
      // offline o servidor caído — asumimos sin sesión
      console.warn('Auth.check() falló:', e.message);
    } finally {
      readyResolve();
      notify();
    }
  }

  async function login(codigo, password) {
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ codigo, password }),
      });
      const data = await r.json().catch(() => ({ ok: false, error: 'respuesta_inválida' }));
      if (!r.ok || !data.ok) {
        return {
          ok: false,
          error: data.error || `Error ${r.status}`,
          code: data.code,
          status: r.status,
        };
      }
      session = { codigo: data.codigo, nivel: data.nivel, nombre: data.nombre };
      notify();
      return { ok: true, session };
    } catch (e) {
      return { ok: false, error: 'Sin conexión. Reintentá en un momento.' };
    }
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {}
    session = null;
    notify();
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn(session);
    return () => listeners.delete(fn);
  }

  window.Auth = {
    get currentLevel() { return session?.nivel || 'publico'; },
    get currentSession() { return session; },
    get currentRole() { return session; }, // alias de compat
    ready,
    login, logout, subscribe,
  };

  check();
})();

// Defense-in-depth: aunque CF Pages NO debería servir módulos JS como assets,
// bloqueamos explícitamente cualquier intento de acceder a /_lib/* por URL.
// Las funciones las importan como módulos — no las exponemos como rutas.
export function onRequest() {
  return new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

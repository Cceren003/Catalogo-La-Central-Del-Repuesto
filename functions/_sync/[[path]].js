// Bloquea cualquier acceso público a los archivos internos del sync.
// El directorio /_sync/ almacena estado interno (mapping SKU→proveedor,
// etc) que el sync en GH Actions lee para preservar productos de proveedor.
// NO debe ser accesible por visitantes.
export function onRequest() {
  return new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

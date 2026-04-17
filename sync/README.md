# sync — Pipeline de catálogo LCR

Genera `catalogo.json` (en la raíz del repo) a partir del inventario en `dev.oss.com.sv/central_repuestos`.

## Flujo

1. Login en `login.php` con usuario/clave (form `username`, `password`).
2. POST a `reporte_inventario_xls.php` con `sucursal=0&id_sucursal=0` (consolidado entre sucursales).
3. Parsea el Excel descargado (`xlsx`).
4. Mapea columnas del Excel → schema limpio de `catalogo.json`:
   - `CODIGO` → `sku`
   - `PRODUCTO` → `nombre`
   - `MARCA` → `marca_repuesto`
   - `CATEGORIA` → `categoria` (slug) + `categoria_label`
   - `PRESENTACION` → `specs.presentacion`
   - `DESCRIPCION` → `specs.empaque`
   - `EXISTENCIA` → `stock` + `stock_status` (in_stock / low_stock / out_of_stock)
   - `PRECIO 2` → `precios.publico`
   - `PRECIO 4` → `precios.taller`
   - `PRECIO 6` → `precios.distribuidor`
5. **Descarta:** `UBICACION`, `COSTO`, `TOTAL($)`, `PRECIO 1/3/5/7` (decisión de Fase 1 — ver `FASE1_EXPLORACION.md`).

## Setup

```bash
cd sync
npm install
cp config.example.json config.json
# editar config.json con credenciales reales (NO se sube al repo, está en .gitignore)
```

## Uso

```bash
# Sync completo (escribe ../catalogo.json)
node sync.js

# Dry-run: descarga + parsea pero NO escribe catalogo.json, solo imprime los primeros 3 productos
node sync.js --dry-run
```

Debug extra (stack traces):
```bash
DEBUG=1 node sync.js
```

## Estructura de salida

```json
{
  "generated_at": "2026-04-17T20:30:00.000Z",
  "count": 1972,
  "productos": [
    {
      "sku": "LM120106",
      "nombre": "ACEITE 20W50 SEMISINTETICO 5100 MOTUL",
      "marca_repuesto": "MOTUL",
      "categoria": "aceites",
      "categoria_label": "ACEITES",
      "specs": { "presentacion": "UNIDAD", "empaque": "1*1" },
      "precios": { "publico": 11.00, "taller": 9.17, "distribuidor": 8.67 },
      "stock": 61,
      "stock_status": "in_stock",
      "activo": true,
      "imagenes": [],
      "compatibilidades": []
    }
  ]
}
```

Los campos `imagenes` y `compatibilidades` quedan vacíos en Fase 2 — se enriquecen en Fase 3/4.

## Bodega central (productos "a pedido")

El proveedor envía periódicamente un listado de SKUs que están disponibles en su bodega aunque LCR no los tenga en stock local. Para que aparezcan como "A pedido" en el catálogo web:

1. Guardá el archivo del proveedor en `sync/bodega_central.csv` (también acepta `.xlsx` o `.xls`).
2. El archivo debe tener una columna llamada `sku` (o `codigo` / `code` / `cod`) con los códigos internos LCR. El resto de columnas se ignoran.
3. Corré `node sync.js` — el reporte cargará cuántos SKUs se marcaron como "a pedido".
4. En el sitio, esos productos (si tienen stock local 0) aparecen con badge azul "A pedido" y un CTA "Consultar tiempo por WhatsApp" que abre un chat con Sala de Ventas.

Sin archivo `bodega_central.*`, el sync funciona normal y ningún producto se marca como "a pedido".

**Nota:** actualmente el flujo asume que los SKUs del archivo ya existen en el sistema LCR (están en el reporte de inventario). SKUs que el proveedor ofrezca pero LCR no stockee aún, quedan fuera del catálogo web hasta que se den de alta en el sistema LCR.

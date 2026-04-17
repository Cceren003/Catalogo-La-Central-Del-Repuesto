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

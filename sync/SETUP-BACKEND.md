# Setup del backend de auth (H3/H4)

Esta guía es para dar de alta la infraestructura de Cloudflare D1 + secrets la **primera vez**. Después del setup, todo corre solo.

## Prerequisitos

- `wrangler` instalado globalmente (`npm install -g wrangler`)
- Cuenta de Cloudflare activa (la misma donde vive el Pages project `lacentraldelrepuesto`)

## Pasos

### 1. Autenticar wrangler (1 vez)

```powershell
wrangler login
```

Abre el navegador → clickeá **Allow**. Listo.

### 2. Crear la base de datos D1

```powershell
wrangler d1 create lcr-auth
```

El output imprime algo como:

```
✅ Successfully created DB 'lcr-auth'
[[d1_databases]]
binding = "DB"
database_name = "lcr-auth"
database_id = "abc123-def456-..."
```

Copiá el valor de `database_id` y pegálo en `wrangler.toml` del repo (reemplazá `PENDIENTE_WRANGLER_D1_CREATE`).

### 3. Aplicar el schema

```powershell
wrangler d1 execute lcr-auth --remote --file=sync/schema.sql
```

Crea las 3 tablas: `users`, `access_log`, `login_attempts`.

Verificar:

```powershell
wrangler d1 execute lcr-auth --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
```

### 4. Generar y guardar el JWT_SECRET

Generá un string random fuerte (64+ caracteres) y guardalo como secret del Pages project:

```powershell
# Generar random
$secret = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
Write-Host "GUARDÁ ESTE SECRET EN LASTPASS:"
Write-Host $secret

# Setearlo en Cloudflare Pages
wrangler pages secret put JWT_SECRET --project-name=lacentraldelrepuesto
# (va a pedirte que pegues el valor — pegá $secret de arriba)
```

### 5. Commit + push

Con el `database_id` ya en `wrangler.toml`:

```powershell
git add wrangler.toml
git commit -m "chore: database_id de D1"
git push
```

El deploy automático corre solo.

### 6. Dar de alta al primer usuario (admin para vos)

```powershell
node sync/admin.js create ADMIN admin "Admin LCR" 7030-1941 "Cuenta de administrador del sistema"
```

El CLI genera una contraseña aleatoria segura — **guardala en tu password manager AHORA**.

### 7. Probar end-to-end

1. Abrí https://lacentraldelrepuesto.com
2. Click **INICIAR SESIÓN**
3. Pegá tu código `ADMIN` + la contraseña del paso 6
4. Deberías ver "ADMIN ✕" en el botón y los precios deberían cambiar en el modal de detalle

Si falla: revisá los logs de deploy en GitHub Actions y los logs de la Function en https://dash.cloudflare.com/ → Pages → lacentraldelrepuesto → Functions.

## Uso diario del CLI admin

```powershell
# Dar de alta un cliente taller nuevo
node sync/admin.js create TAL-DURAN taller "Duran Motos SV" 70301941

# Dar de alta un distribuidor
node sync/admin.js create DIS-MOTOCO distribuidor "MotoCo Centroamerica" 77841234

# Ver todos los usuarios
node sync/admin.js list

# Ver detalle de uno
node sync/admin.js show TAL-DURAN

# Resetear contraseña (ej. si la perdieron)
node sync/admin.js reset-password TAL-DURAN

# Desactivar (cliente dejó de serlo)
node sync/admin.js revoke TAL-DURAN

# Reactivar
node sync/admin.js activate TAL-DURAN

# Ver log de accesos
node sync/admin.js log
node sync/admin.js log TAL-DURAN
```

## Troubleshooting

### "wrangler d1 execute" dice "database not found"

Confirmá que el `database_id` en `wrangler.toml` matchee el que devolvió `wrangler d1 create`. Y que estés corriendo con `--remote` (sin `--remote` usa una DB local que no existe en CF).

### Login desde el browser dice "server_not_configured"

Falta el `JWT_SECRET`. Volvé a correr:

```powershell
wrangler pages secret list --project-name=lacentraldelrepuesto
```

Si no aparece `JWT_SECRET`, repetí el paso 4.

### Login funciona pero no aparecen precios mayoristas

Chequeá que exista `_sync/mayorista.json` en el repo:

```powershell
git ls-files _sync/
```

Si falta, corré `cd sync && node sync.js` para regenerarlo.

### Rate limit me pescó mientras probaba

Limpiá la tabla:

```powershell
wrangler d1 execute lcr-auth --remote --command="DELETE FROM login_attempts WHERE ip = 'TU_IP'"
```

(O esperá 15 minutos — el límite se auto-resetea.)

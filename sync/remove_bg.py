#!/usr/bin/env python3
"""
Pipeline de background removal para img/.

Soporta dos backends:
  --backend=rembg       → local (U2Net por default), gratis, ~15-30s/img CPU
  --backend=removebg    → API remove.bg, rápido (~2s/img red), consume créditos

Uso:
  # Local (gratis)
  python remove_bg.py img --backend=rembg --model=u2net

  # Modelos rembg:
  #   u2net          — general (default, 176MB)
  #   u2netp         — ligero (4.7MB, más rápido, menos preciso)
  #   isnet-general-use — alta calidad (176MB)
  #   birefnet-general — state-of-the-art (423MB)

  # API remove.bg (paid)
  export REMOVE_BG_API_KEY="tu_api_key"
  python remove_bg.py img --backend=removebg

  # Opcional: procesar solo N imágenes para probar
  python remove_bg.py img --backend=rembg --limit=10
"""
import argparse, os, sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed


def run_rembg(files, model_name: str = "u2net", workers: int = 2, bgcolor=(255, 255, 255, 255)):
    """Procesa imágenes con rembg local."""
    from rembg import new_session, remove
    from PIL import Image
    import io

    print(f"→ Backend rembg, modelo: {model_name}, workers: {workers}")
    print(f"→ Fondo de salida: RGB{bgcolor[:3]}")
    print(f"→ Primera imagen descarga el modelo (~180MB para u2net)")

    session = new_session(model_name)

    def process_one(path: Path):
        try:
            with open(path, "rb") as f:
                data = f.read()
            out = remove(data, session=session, bgcolor=bgcolor)
            # rembg devuelve PNG por default. Convertimos a JPG preservando el sku.
            img = Image.open(io.BytesIO(out)).convert("RGB")
            img.save(str(path), "JPEG", quality=90)
            return (path.name, True, None)
        except Exception as e:
            return (path.name, False, str(e)[:120])

    done = 0
    errors = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = [ex.submit(process_one, p) for p in files]
        for fut in as_completed(futures):
            name, ok, err = fut.result()
            done += 1
            if not ok:
                errors += 1
            if done % 25 == 0 or done == len(files):
                print(f"  {done}/{len(files)} | errors: {errors}")
    return done, errors


def run_removebg(files, api_key: str):
    """Procesa imágenes vía API remove.bg."""
    from removebg import RemoveBg
    rmbg = RemoveBg(api_key, "error.log")

    print(f"→ Backend remove.bg API, key: {api_key[:6]}***")
    print(f"→ Total imágenes: {len(files)} (consume 1 crédito cada una)")

    done = 0
    errors = 0
    for p in files:
        try:
            # Escribe <name>_no_bg.png junto al original
            rmbg.remove_background_from_img_file(str(p))
            # Si queremos reemplazar el original con la versión sin fondo + blanco:
            # TODO: convertir PNG transparente → JPG fondo blanco
        except Exception as e:
            errors += 1
            print(f"  ERR {p.name}: {str(e)[:120]}")
        done += 1
        if done % 10 == 0 or done == len(files):
            print(f"  {done}/{len(files)} | errors: {errors}")
    return done, errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input_dir")
    ap.add_argument("--backend", choices=["rembg", "removebg"], required=True)
    ap.add_argument("--model", default="u2net",
                    help="Solo para rembg: u2net | u2netp | isnet-general-use | birefnet-general")
    ap.add_argument("--workers", type=int, default=2, help="Hilos concurrentes (solo rembg)")
    ap.add_argument("--limit", type=int, default=None, help="Procesar solo N imágenes (prueba)")
    ap.add_argument("--api-key", default=None, help="API key remove.bg (o env REMOVE_BG_API_KEY)")
    args = ap.parse_args()

    input_dir = Path(args.input_dir)
    if not input_dir.is_dir():
        print(f"ERROR: {input_dir} no es un directorio")
        sys.exit(1)

    files = sorted([p for p in input_dir.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")])
    if args.limit:
        files = files[:args.limit]
    print(f"→ Total archivos a procesar: {len(files)}")

    if args.backend == "rembg":
        done, errors = run_rembg(files, model_name=args.model, workers=args.workers)
    else:
        api_key = args.api_key or os.environ.get("REMOVE_BG_API_KEY")
        if not api_key:
            print("ERROR: falta API key. Seteá REMOVE_BG_API_KEY o pasá --api-key=...")
            sys.exit(1)
        done, errors = run_removebg(files, api_key=api_key)

    print(f"\n✓ Procesadas: {done}")
    print(f"✗ Errores: {errors}")


if __name__ == "__main__":
    main()

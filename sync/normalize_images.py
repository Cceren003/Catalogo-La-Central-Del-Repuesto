#!/usr/bin/env python3
"""
Normaliza imágenes con fondo plano (negro O blanco) a WebP 800x800 con fondo blanco puro.

Pipeline:
  1. Auto-detecta color de fondo analizando las 4 esquinas
  2. Crea máscara del producto (pixels != fondo)
  3. getbbox sobre la máscara → recorta whitespace/blackspace
  4. Agrega padding (~8%) para que el producto ocupe ~85% del canvas
  5. Centra sobre canvas 800x800 fondo BLANCO (#FFFFFF)
  6. Guarda como WebP calidad 90

NO usa rembg/IA. NO altera el color del producto.

Uso:
  python normalize_images.py <input_dir> <output_dir> [--size=800] [--pad-pct=0.08]
                             [--quality=90] [--limit=N] [--workers=4]
                             [--dark-thresh=30] [--light-thresh=245]
"""
import argparse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
from PIL import Image


def detect_bg(arr: np.ndarray) -> str:
    """Devuelve 'dark' o 'light' según las 4 esquinas de la imagen."""
    h, w = arr.shape[:2]
    corners = np.concatenate([
        arr[:10, :10].reshape(-1, arr.shape[-1]),
        arr[:10, -10:].reshape(-1, arr.shape[-1]),
        arr[-10:, :10].reshape(-1, arr.shape[-1]),
        arr[-10:, -10:].reshape(-1, arr.shape[-1]),
    ])
    avg_brightness = corners[:, :3].mean()  # sólo RGB
    return "dark" if avg_brightness < 100 else "light"


def build_product_mask(arr: np.ndarray, bg_kind: str,
                       dark_thresh: int = 30, light_thresh: int = 245) -> np.ndarray:
    """
    Retorna máscara booleana: True = producto, False = fondo.
    - bg dark  → producto = cualquier canal RGB > dark_thresh
    - bg light → producto = cualquier canal RGB < light_thresh
    """
    rgb = arr[:, :, :3]
    if bg_kind == "dark":
        return np.any(rgb > dark_thresh, axis=-1)
    else:
        return np.any(rgb < light_thresh, axis=-1)


def find_bbox(mask: np.ndarray):
    """Retorna (left, top, right, bottom) o None si la máscara está vacía."""
    if not mask.any():
        return None
    rows_any = np.any(mask, axis=1)
    cols_any = np.any(mask, axis=0)
    rmin, rmax = np.where(rows_any)[0][[0, -1]]
    cmin, cmax = np.where(cols_any)[0][[0, -1]]
    return int(cmin), int(rmin), int(cmax) + 1, int(rmax) + 1


def normalize(input_path: Path, output_path: Path,
              canvas_size: int = 800, pad_pct: float = 0.08,
              quality: int = 90, dark_thresh: int = 30,
              light_thresh: int = 245) -> dict:
    img = Image.open(input_path).convert("RGB")
    arr = np.asarray(img)

    # 1) Detectar fondo
    bg_kind = detect_bg(arr)
    # 2) Máscara del producto
    mask = build_product_mask(arr, bg_kind, dark_thresh, light_thresh)
    # 3) BBox
    bbox = find_bbox(mask)

    if bbox is None:
        canvas = Image.new("RGB", (canvas_size, canvas_size), (255, 255, 255))
        canvas.save(output_path, "WEBP", quality=quality, method=6)
        return {"file": input_path.name, "empty": True, "bg": bg_kind}

    # 4) Si bg = dark: reemplazar pixels fondo con BLANCO antes de crop
    if bg_kind == "dark":
        arr_clean = arr.copy()
        arr_clean[~mask] = [255, 255, 255]
        img_clean = Image.fromarray(arr_clean)
    else:
        img_clean = img

    cropped = img_clean.crop(bbox)
    cw, ch = cropped.size

    # 5) Padding = pad_pct del lado mayor del producto. Escalar PERMITIENDO upscale
    #    para que el producto llene el canvas (~80% cuando pad_pct=0.125).
    pad = int(max(cw, ch) * pad_pct)
    padded_w = cw + 2 * pad
    padded_h = ch + 2 * pad
    scale = min(canvas_size / padded_w, canvas_size / padded_h)
    new_w = max(1, int(cw * scale))
    new_h = max(1, int(ch * scale))
    if (new_w, new_h) != cropped.size:
        cropped = cropped.resize((new_w, new_h), Image.LANCZOS)

    # 6) Canvas blanco + paste centrado
    canvas = Image.new("RGB", (canvas_size, canvas_size), (255, 255, 255))
    px = (canvas_size - new_w) // 2
    py = (canvas_size - new_h) // 2
    canvas.paste(cropped, (px, py))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, "WEBP", quality=quality, method=6)
    return {
        "file": input_path.name, "bg": bg_kind, "bbox": bbox,
        "orig": img.size, "placed": (new_w, new_h),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input_dir")
    ap.add_argument("output_dir")
    ap.add_argument("--size", type=int, default=800)
    ap.add_argument("--pad-pct", type=float, default=0.125)  # producto ~80% del canvas
    ap.add_argument("--quality", type=int, default=90)
    ap.add_argument("--dark-thresh", type=int, default=30)
    ap.add_argument("--light-thresh", type=int, default=245)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    files = sorted([p for p in input_dir.iterdir()
                    if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")])
    if args.limit:
        files = files[:args.limit]

    print(f"→ {len(files)} archivos | canvas {args.size}x{args.size} | pad {args.pad_pct*100:.0f}% | WebP q={args.quality}")
    print(f"  Fondo auto: dark_thresh={args.dark_thresh}, light_thresh={args.light_thresh}")

    done = 0; errors = 0; empty = 0
    bg_dark = 0; bg_light = 0

    def worker(p: Path):
        out = output_dir / f"{p.stem}.webp"
        return normalize(p, out, args.size, args.pad_pct, args.quality,
                         args.dark_thresh, args.light_thresh)

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(worker, p): p for p in files}
        for fut in as_completed(futures):
            p = futures[fut]
            try:
                r = fut.result()
                done += 1
                if r.get("empty"): empty += 1
                if r.get("bg") == "dark": bg_dark += 1
                elif r.get("bg") == "light": bg_light += 1
            except Exception as e:
                errors += 1
                print(f"  ERR {p.name}: {str(e)[:100]}")
            if (done + errors) % 200 == 0 or (done + errors) == len(files):
                print(f"  {done+errors}/{len(files)} | ok {done} (dark bg:{bg_dark}, light bg:{bg_light}) | empty {empty} | err {errors}")

    print(f"\n✓ Procesadas: {done}")
    print(f"  Fondo negro detectado: {bg_dark}")
    print(f"  Fondo claro detectado: {bg_light}")
    print(f"  Vacías: {empty}")
    print(f"✗ Errores: {errors}")
    print(f"→ Output: {output_dir}")


if __name__ == "__main__":
    main()

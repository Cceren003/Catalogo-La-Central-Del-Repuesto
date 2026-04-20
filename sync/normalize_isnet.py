#!/usr/bin/env python3
"""
Normaliza imágenes con rembg (modelo isnet-general-use) → canvas 800x800 WebP fondo blanco.

Pipeline:
  1. rembg con isnet-general-use (entrena mejor que u2net para objetos industriales/metálicos)
  2. Extrae alpha mask → bbox del producto
  3. Crop + padding 12.5% (producto ~80% del canvas)
  4. Alpha composite sobre canvas 800x800 blanco puro
  5. WebP calidad 90

Uso:
  python normalize_isnet.py <input_dir> <output_dir> [--limit=N] [--workers=2]
                            [--model=isnet-general-use] [--size=800]
                            [--pad-pct=0.125] [--quality=90]
"""
import argparse, io
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from PIL import Image
from rembg import remove, new_session


def process_one(input_path: Path, output_path: Path, session,
                canvas_size: int = 800, pad_pct: float = 0.125,
                quality: int = 90) -> dict:
    # 1) rembg con alpha matting para bordes limpios
    with open(input_path, "rb") as f:
        input_bytes = f.read()
    out_bytes = remove(
        input_bytes,
        session=session,
        alpha_matting=True,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=15,
        alpha_matting_erode_size=3,
    )
    rgba = Image.open(io.BytesIO(out_bytes)).convert("RGBA")

    # 2) Extraer alpha → bbox
    alpha = rgba.split()[3]
    bbox = alpha.getbbox()
    if bbox is None:
        canvas = Image.new("RGB", (canvas_size, canvas_size), (255, 255, 255))
        canvas.save(output_path, "WEBP", quality=quality, method=6)
        return {"file": input_path.name, "empty": True}

    cropped = rgba.crop(bbox)
    cw, ch = cropped.size

    # 3) Padding
    pad = int(max(cw, ch) * pad_pct)
    padded_w = cw + 2 * pad
    padded_h = ch + 2 * pad
    scale = min(canvas_size / padded_w, canvas_size / padded_h)
    if scale > 1.0:
        scale = 1.0
    new_w = max(1, int(cw * scale))
    new_h = max(1, int(ch * scale))
    if (new_w, new_h) != cropped.size:
        cropped = cropped.resize((new_w, new_h), Image.LANCZOS)

    # 4) Alpha composite sobre white
    canvas = Image.new("RGB", (canvas_size, canvas_size), (255, 255, 255))
    px = (canvas_size - new_w) // 2
    py = (canvas_size - new_h) // 2
    canvas.paste(cropped, (px, py), cropped)  # usa alpha como máscara

    # 5) Save WebP
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, "WEBP", quality=quality, method=6)
    return {"file": input_path.name, "placed": (new_w, new_h)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input_dir")
    ap.add_argument("output_dir")
    ap.add_argument("--model", default="isnet-general-use")
    ap.add_argument("--size", type=int, default=800)
    ap.add_argument("--pad-pct", type=float, default=0.125)
    ap.add_argument("--quality", type=int, default=90)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--files", nargs="*", default=None)
    args = ap.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.files:
        files = [input_dir / f for f in args.files if (input_dir / f).exists()]
    else:
        files = sorted([p for p in input_dir.iterdir()
                        if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")])
    if args.limit:
        files = files[:args.limit]

    print(f"→ {len(files)} archivos | modelo {args.model} | canvas {args.size}x{args.size} | pad {args.pad_pct*100:.1f}% | WebP q={args.quality}")
    session = new_session(args.model)
    print(f"  (primera imagen descarga el modelo {args.model}, ~180MB)")

    done = 0; errors = 0; empty = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(process_one, p, output_dir / f"{p.stem}.webp", session,
                             args.size, args.pad_pct, args.quality): p for p in files}
        for fut in as_completed(futures):
            p = futures[fut]
            try:
                r = fut.result()
                done += 1
                if r.get("empty"): empty += 1
            except Exception as e:
                errors += 1
                print(f"  ERR {p.name}: {str(e)[:120]}")
            if (done + errors) % 10 == 0 or (done + errors) == len(files):
                print(f"  {done+errors}/{len(files)} | ok {done} | empty {empty} | err {errors}")

    print(f"\n✓ Procesadas: {done}")
    print(f"  Vacías: {empty}")
    print(f"✗ Errores: {errors}")
    print(f"→ Output: {output_dir}")


if __name__ == "__main__":
    main()

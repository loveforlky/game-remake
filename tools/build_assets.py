#!/usr/bin/env python3
"""把一组图片整理成游戏用的形象素材，并生成 manifest.js。

用法：
    python tools/build_assets.py 图片文件夹
    python tools/build_assets.py 图片文件夹 --names "小芽,团子,小橘"
    python tools/build_assets.py 图片文件夹 --size 512 --quality 92

规则：
  * 文件名按自然顺序排序（1.png, 2.png, ..., 10.png 不会乱）。
  * 带透明通道的图：自动裁掉四周空白，保留透明边缘（crop: none）。
  * 不透明照片：居中裁成正方形，游戏里会裁成圆形（crop: circle）。
  * 同时从每张图里取一个主色，晕染特效会跟着图片走。
  * 生成 assets/items/01.webp ... 和 assets/items/manifest.js。

图片数量不必是 11：游戏会按数量重新计算大小与合成链。
"""
from __future__ import annotations

import argparse
import colorsys
import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("需要 Pillow：python -m pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "assets" / "items"
EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".avif", ".tif", ".tiff"}
MAX_ITEMS = 20


def natural_key(path: Path):
    return [int(t) if t.isdigit() else t.lower()
            for t in re.split(r"(\d+)", path.stem)]


def clean_name(stem: str) -> str:
    name = re.sub(r"^[\s_\-.0-9]+", "", stem).strip()
    name = re.sub(r"[_\-.]+", " ", name).strip()
    if not name:
        name = "形态 " + stem
    return name[:12]


def fit_alpha(im: Image.Image, size: int) -> Image.Image:
    """裁掉透明边，等比缩进 size 画布，留 4% 呼吸空间。"""
    alpha = im.getchannel("A")
    box = alpha.getbbox()
    if box:
        im = im.crop(box)
    inner = int(size * 0.92)
    im.thumbnail((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return canvas


def fit_opaque(im: Image.Image, size: int) -> Image.Image:
    im = ImageOps.exif_transpose(im)
    side = min(im.width, im.height)
    left = (im.width - side) // 2
    top = (im.height - side) // 2
    im = im.crop((left, top, left + side, top + side))
    return im.resize((size, size), Image.LANCZOS)


def dominant_colors(im: Image.Image):
    """返回 (浅, 深) 两个十六进制颜色，供粒子和备用圆形使用。"""
    small = im.convert("RGBA").resize((32, 32), Image.LANCZOS)
    px = small.load()
    rs = gs = bs = 0.0
    weight = 0.0
    for y in range(32):
        for x in range(32):
            r, g, b, a = px[x, y]
            if a < 90:
                continue
            w = a / 255.0
            rs += r * w
            gs += g * w
            bs += b * w
            weight += w
    if not weight:
        return "#ffd9c4", "#ff7d6b"

    r, g, b = rs / weight / 255.0, gs / weight / 255.0, bs / weight / 255.0
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    s = min(1.0, max(0.32, s * 1.15))
    v = min(1.0, max(0.62, v))

    def hexof(hh, ss, vv):
        rr, gg, bb = colorsys.hsv_to_rgb(hh, ss, vv)
        return "#%02x%02x%02x" % (round(rr * 255), round(gg * 255), round(bb * 255))

    light = hexof(h, max(0.0, s * 0.55), min(1.0, v + 0.30))
    deep = hexof(h, min(1.0, s * 1.05), max(0.2, v - 0.12))
    return light, deep


def main() -> None:
    ap = argparse.ArgumentParser(description="整理图片并生成合成游戏素材")
    ap.add_argument("source", help="存放图片的文件夹")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="输出目录（默认 assets/items）")
    ap.add_argument("--size", type=int, default=512, help="单张输出边长（默认 512）")
    ap.add_argument("--quality", type=int, default=92, help="WebP 质量（默认 92）")
    ap.add_argument("--names", default="", help="逗号分隔的名字，按顺序覆盖默认名字")
    args = ap.parse_args()

    src = Path(args.source)
    if not src.is_dir():
        sys.exit(f"找不到文件夹：{src}")

    files = sorted(
        [p for p in src.iterdir() if p.is_file() and p.suffix.lower() in EXTS],
        key=natural_key,
    )
    if not files:
        sys.exit(f"这个文件夹里没有图片：{src}")
    if len(files) > MAX_ITEMS:
        print(f"提示：找到 {len(files)} 张，只取前 {MAX_ITEMS} 张")
        files = files[:MAX_ITEMS]

    names = [n.strip() for n in args.names.split(",") if n.strip()] if args.names else []

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    entries = []
    for i, path in enumerate(files):
        try:
            im = Image.open(path)
            im = ImageOps.exif_transpose(im)
        except Exception as exc:
            print(f"跳过（打不开）：{path.name} -> {exc}")
            continue

        im = im.convert("RGBA")
        alpha_min, _ = im.getchannel("A").getextrema()
        transparent = alpha_min < 250

        if transparent:
            tile = fit_alpha(im, args.size)
            crop = "none"
        else:
            tile = fit_opaque(im, args.size)
            crop = "circle"

        light, deep = dominant_colors(tile)
        idx = len(entries) + 1
        filename = f"{idx:02d}.webp"
        pngname = f"{idx:02d}.png"
        tile.save(out / filename, "WEBP", quality=args.quality, method=6)
        tile.resize((min(384, args.size), min(384, args.size)), Image.LANCZOS).save(
            out / pngname, "PNG", optimize=True
        )

        if i < len(names):
            name = names[i]
        else:
            name = clean_name(path.stem)

        entries.append({
            "name": name,
            "file": f"assets/items/{filename}",
            "fallback": f"assets/items/{pngname}",
            "crop": crop,
            "c1": light,
            "c2": deep,
        })
        print(f"{filename:<10} {name:<10} {crop:<7} {path.name}")

    if not entries:
        sys.exit("没有可用的图片。")

    lines = [
        "/* 由 tools/build_assets.py 生成。",
        " * 想换名字/裁切方式，直接改下面的 name / crop 即可。",
        " * crop: 'circle' 圆形裁切（照片），'none' 保留透明边缘（立绘）。",
        " */",
        "window.ITEM_ASSETS = [",
    ]
    for e in entries:
        lines.append(
            "  { name: %s, file: %s, fallback: %s, crop: %s, c1: %s, c2: %s },"
            % tuple(
                "'" + str(e[k]).replace("'", "\\'") + "'"
                for k in ("name", "file", "fallback", "crop", "c1", "c2")
            )
        )
    lines.append("];")
    (out / "manifest.js").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"\n完成：{len(entries)} 个形象 -> {out}")
    print(f"清单：{out / 'manifest.js'}")


if __name__ == "__main__":
    main()

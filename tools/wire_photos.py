import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 从最小 -> 最大 的顺序（用文件名里的编号指认）
ORDER = ['222', '210', '214', '213', '225', '221', '223', '211', '212', '215', '224']

files = [f for f in os.listdir(ROOT)
         if f.lower().endswith('.png') and '微信图片' in f]

def code_of(fname):
    # 提取形如 _\d{3}_146.png 里的三位编号
    import re
    m = re.search(r'_(\d{3})_146', fname)
    return m.group(1) if m else None

by_code = {}
for f in files:
    c = code_of(f)
    if c:
        by_code[c] = f

for i, code in enumerate(ORDER, start=1):
    src = by_code.get(code)
    if not src:
        print('MISSING', code, [ (code_of(x),x) for x in files ])
        sys.exit(1)
    print(i, '->', src)

# 调用 build_assets 的逻辑处理这些文件
from build_assets import fit_opaque, dominant_colors
from PIL import Image, ImageDraw, ImageOps

out = os.path.join(ROOT, 'assets', 'items')
os.makedirs(out, exist_ok=True)
# 清理旧的 webp
for old in os.listdir(out):
    if old.endswith('.webp'):
        os.remove(os.path.join(out, old))

def circle_bake(im, size=512):
    """方形照片 -> 圆形 webp：照片铺满整个圆（cover），圆的 100% 都是照片，
    不留任何白边。
    做法：取中心方裁 -> alpha 裁边 -> cover 缩放到刚好盖住圆 -> 圆形蒙版裁边。
    """
    im = im.convert('RGBA')
    side = min(im.width, im.height)
    cx, cy = im.width // 2, im.height // 2
    im = im.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2))

    # 1) 裁掉透明/白边
    a = im.getchannel('A')
    bbox = a.getbbox()
    if bbox:
        im = im.crop(bbox)

    # 2) cover 缩放：缩放到「盖住 80% 的圆」，圆内 100% 是照片，
    #    但脸不会被切成两半；边缘那一圈同色背景也看不出来
    w, h = im.size
    scale = (size * 0.80) / min(w, h)
    new_w, new_h = int(w * scale), int(h * scale)
    im = im.resize((new_w, new_h), Image.LANCZOS)

    # 3) 居中放到方形画布，再裁成圆形
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(im, ((size - new_w) // 2, (size - new_h) // 2), im)

    mask = Image.new('L', (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([0, 0, size, size], fill=255)
    result = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    result.paste(canvas, (0, 0), mask)
    return result

manifest_entries = []
for i, code in enumerate(ORDER, start=1):
    src_path = os.path.join(ROOT, by_code[code])
    im = Image.open(src_path)
    im = ImageOps.exif_transpose(im).convert('RGBA')
    tile = circle_bake(im, 512)
    light, deep = dominant_colors(tile)
    fname = '{:02d}.webp'.format(i)
    tile.save(os.path.join(out, fname), 'WEBP', quality=92, method=6)
    manifest_entries.append(
        "  { name: '形态 %s', file: 'assets/items/%s', crop: 'none', c1: '%s', c2: '%s' },"
        % (code, fname, light, deep)
    )
    print('saved', fname, light, deep)

lines = [
    '/* 形象清单：从最小到最大，全部圆形裁切真人照片。',
    " * 名字用的是原图编号（形态 222 = 最小的那一颗）。",
    " * 想改名字，把 name 改成你想要的即可。",
    " */",
    "window.ITEM_ASSETS = [",
] + manifest_entries + ['];']
with open(os.path.join(out, 'manifest.js'), 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(lines) + '\n')

print('\nDONE', len(manifest_entries), 'entries')

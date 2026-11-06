from pathlib import Path
root = Path(r"C:\Users\Lenovo\Desktop\hecheng")

for name in ("index.html", "play.html"):
    p = root / name
    s = p.read_text(encoding="utf-8")
    s = s.replace("v=20261106d", "v=20261106e")
    p.write_text(s, encoding="utf-8")

idx = (root / "index.html").read_text(encoding="utf-8")
v2 = idx.replace(
    '<script src="assets/items/manifest.js?v=20261106e"></script>',
    '<script src="assets/items/embedded.js?v=20261106e"></script>'
)
v2 = v2.replace("<title>合成大作战</title>", "<title>合成大作战 · 内嵌版</title>")
(root / "v2.html").write_text(v2, encoding="utf-8")
print("v2 written", len(v2))
print("has embedded:", "embedded.js" in v2)

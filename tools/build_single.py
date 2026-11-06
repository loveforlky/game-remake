import re
from pathlib import Path

root = Path(r"C:\Users\Lenovo\Desktop\hecheng")
html = (root / "v2.html").read_text(encoding="utf-8")
css = (root / "style.css").read_text(encoding="utf-8")
embedded = (root / "assets/items/embedded.js").read_text(encoding="utf-8")
game = (root / "game.js").read_text(encoding="utf-8")

for name, text in (("css", css), ("embedded", embedded), ("game", game)):
    if "</style" in text.lower() or "</script" in text.lower():
        raise SystemExit(f"{name} contains a closing tag, abort")

html = re.sub(
    r'<link rel="stylesheet" href="style\.css[^"]*">',
    "<style>\n" + css + "\n</style>",
    html,
)
html = re.sub(
    r'<script src="assets/items/embedded\.js[^"]*"></script>',
    "<script>\n" + embedded + "\n</script>",
    html,
)
html = re.sub(
    r'<script src="game\.js[^"]*"></script>',
    "<script>\n" + game + "\n</script>",
    html,
)

out = root / "hecheng.html"
out.write_text(html, encoding="utf-8")
print("written", out)
print("size KB", out.stat().st_size // 1024)
print("external refs:", re.findall(r'(?:src|href)="(?!#|data:)([^"]+)"', html)[:20])

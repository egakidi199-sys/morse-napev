# Рисует PNG-иконки PWA (точка + тире) через Pillow.
from pathlib import Path
from PIL import Image, ImageDraw

BG, FG = (20, 22, 28, 255), (242, 179, 61, 255)
OUT = Path(__file__).resolve().parent.parent / "icons"

def draw(size, maskable=False):
    s = 4  # суперсэмплинг для гладких краёв
    S = size * s
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, S, S], fill=BG)
        k = 0.72  # знак внутри безопасной зоны
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 112 / 512), fill=BG)
        k = 1.0
    def p(v):
        return S / 2 + (v - 256) / 512 * S * k
    d.ellipse([p(104), p(210), p(196), p(302)], fill=FG)
    d.rounded_rectangle([p(234), p(210), p(412), p(302)], radius=int(46 / 512 * S * k), fill=FG)
    return img.resize((size, size), Image.LANCZOS)

draw(192).save(OUT / "icon-192.png")
draw(512).save(OUT / "icon-512.png")
draw(512, maskable=True).save(OUT / "icon-maskable-512.png")
print("ok")

#!/usr/bin/env python3
"""生成训练日志 PWA 图标：钢蓝底 + 白色杠铃。"""
import os
from PIL import Image, ImageDraw

BG = (43, 91, 170, 255)      # 钢蓝 #2B5BAA
WHITE = (255, 255, 255, 255)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "icons")
os.makedirs(OUT, exist_ok=True)


def draw_barbell(size, scale=1.0):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    W = size
    cx = cy = W / 2.0

    # 尺寸比例（scale 用于 maskable 缩小到安全区）
    shaft_half = 0.40 * W * scale
    shaft_thick = 0.085 * W * scale
    plate_r = 0.155 * W * scale
    plate_off = 0.28 * W * scale
    hole_r = 0.055 * W * scale

    # 杠铃杆
    d.rounded_rectangle(
        [cx - shaft_half, cy - shaft_thick / 2, cx + shaft_half, cy + shaft_thick / 2],
        radius=shaft_thick / 2,
        fill=WHITE,
    )
    # 两侧杠铃片（带孔）
    for pc in (cx - plate_off, cx + plate_off):
        d.ellipse([pc - plate_r, cy - plate_r, pc + plate_r, cy + plate_r], fill=WHITE)
        d.ellipse([pc - hole_r, cy - hole_r, pc + hole_r, cy + hole_r], fill=BG)
    return img


draw_barbell(180, 1.0).save(os.path.join(OUT, "apple-touch-icon.png"))
draw_barbell(192, 1.0).save(os.path.join(OUT, "icon-192.png"))
draw_barbell(512, 1.0).save(os.path.join(OUT, "icon-512.png"))
draw_barbell(512, 0.82).save(os.path.join(OUT, "icon-maskable-512.png"))
print("icons generated:", os.listdir(OUT))

#!/usr/bin/env python3
"""Generate FareFlow install QR codes (plain + branded posters) for Android & iPhone."""
import qrcode
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from qrcode.constants import ERROR_CORRECT_M

import sys
BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://fog-trek-xhtml-compounds.trycloudflare.com/")
TARGETS = {
    "android": BASE + "?src=qr-android",
    "apple": BASE + "?src=qr-apple",
}
OUT = "public/qr"

# brand
BG = (10, 15, 26)        # #0A0F1A
CARD = (255, 255, 255)
INK = (13, 22, 38)
SUB = (148, 163, 184)    # slate-ish
SKY = (56, 189, 248)     # #38BDF8 brand accent
LIME = (163, 230, 53)    # #A3E635
ANDROID = (61, 220, 132) # android green

FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

META = {
    "android": ("ANDROID", ANDROID, (4, 18, 31), [
        "Open the link in Chrome, then tap", "Install app \u2014 done in 10 seconds"]),
    "apple": ("iPHONE", (255, 255, 255), (4, 18, 31), [
        "Opens in Safari \u2192 Share \u2192", "Add to Home Screen \u2192 Add"]),
}

def make_qr(url, box=34):
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_M, box_size=box, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    return img

def rounded(draw, xy, r, fill):
    draw.rounded_rectangle(xy, radius=r, fill=fill)

def poster(key):
    url = TARGETS[key]
    label, chip_bg, chip_fg, steps = META[key]
    W, H = 1242, 1660
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # soft brand glows
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W-520, -360, W+140, 300], fill=(14, 116, 164))
    gd.ellipse([-420, H-560, 180, H+40], fill=(18, 90, 130) if key == "android" else (30, 60, 110))
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    img = Image.blend(img, Image.composite(glow, img, glow.convert("L").point(lambda v: min(120, v))), 0.5)
    d = ImageDraw.Draw(img)

    cx = W // 2
    f_logo = ImageFont.truetype(FB, 88)
    f_chip = ImageFont.truetype(FB, 44)
    f_title = ImageFont.truetype(FB, 108)
    f_step = ImageFont.truetype(FR, 40)
    f_url = ImageFont.truetype(FR, 34)

    # app icon + wordmark
    icon = Image.open("public/icons/icon-192.png").convert("RGBA").resize((112, 112), Image.LANCZOS)
    img.paste(icon, (cx - 56, 74), icon)
    d.text((cx, 232), "FareFlow", font=f_logo, fill="white", anchor="mm")

    # platform chip
    tw = d.textlength(label, font=f_chip)
    chip_w, chip_h = tw + 84, 86
    rounded(d, (cx - chip_w/2, 316, cx + chip_w/2, 316 + chip_h), chip_h/2, chip_bg)
    d.text((cx, 316 + chip_h/2 + 2), label, font=f_chip, fill=chip_fg, anchor="mm")

    # title
    d.text((cx, 520), "SCAN TO INSTALL", font=f_title, fill="white", anchor="mm")

    # white card with QR
    card_x0, card_y0, card_x1, card_y1 = 106, 610, W - 106, 1432
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((card_x0, card_y0 + 14, card_x1, card_y1 + 14), 48, fill=(0, 0, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(24))
    img.paste(Image.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, 0)), sh).convert("RGB"), (0, 0), sh)
    d = ImageDraw.Draw(img)
    rounded(d, (card_x0, card_y0, card_x1, card_y1), 48, CARD)

    qr = make_qr(url, box=26)
    qs = 640
    qr = qr.resize((qs, qs), Image.NEAREST)
    img.paste(qr, (cx - qs//2, card_y0 + 34))

    # steps inside card
    y = card_y0 + 34 + qs + 40
    for i, line in enumerate(steps):
        d.text((cx, y), line, font=f_step, fill=INK, anchor="mm")
        y += 54

    # footer url + note
    short = "fareflow \u00b7 scan with your phone camera"
    d.text((cx, 1470), short, font=f_step, fill=SUB, anchor="mm")
    d.text((cx, 1534), BASE.replace("https://", "").rstrip("/"), font=f_url, fill=SKY, anchor="mm")

    img.save(f"{OUT}/poster-{key}.png")
    return img

def main():
    import os
    os.makedirs(OUT, exist_ok=True)
    posters = []
    for key, url in TARGETS.items():
        qr = make_qr(url, box=40)
        qr.save(f"{OUT}/qr-{key}.png")
        posters.append(poster(key))
    both = Image.new("RGB", (posters[0].width * 2 + 60, posters[0].height), (5, 8, 14))
    both.paste(posters[0], (0, 0)); both.paste(posters[1], (posters[0].width + 60, 0))
    both.save(f"{OUT}/poster-both.png")
    print("wrote:", ", ".join(sorted(os.listdir(OUT))))

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Generates the PWA app icons for pwa/public/icons/.

Design: a bold two-color crosshair/reticle mark (outer ring + four corner
ticks + a center lock-on dot) on the app's dark theme background. Chosen
because it reads instantly as "shooter" at any size, stays legible down to
favicon-ish scale, and needs no fine detail (unlike a character silhouette,
which turns to mud at 48px).

Produces two purposes per size, per current (2026) installability guidance:
  - "any" icons: the mark is drawn large, right up near the edges of the
    square, since these are shown un-cropped.
  - "maskable" icons: the same mark, scaled down so every pixel of it sits
    inside the safe-zone circle (centered, 80% of the square's diameter),
    since OSes crop these to a shape (circle, squircle, etc.) of their
    choosing. Never reuse an "any" image as maskable (and vice versa) --
    the padding requirements conflict, per web.dev's icon guidance.

Regenerate with: python3 pwa/scripts/generate-icons.py
Requires Pillow (`pip install pillow`).
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "icons"

# Matches manifest.json background_color / theme_color and index.html's
# <meta name="theme-color">, so the icon reads as part of the same app shell.
BG_COLOR = (11, 11, 18)  # #0b0b12
ACCENT_COLOR = (255, 77, 61)  # #ff4d3d -- aggressive red-orange, PvP energy
DOT_COLOR = (255, 255, 255)  # white lock-on dot, pops against the accent ring

SUPERSAMPLE = 2048  # draw large, downsample for clean anti-aliasing


def draw_reticle(size: int, content_scale: float) -> Image.Image:
	"""Draws the crosshair mark on a size x size canvas.

	content_scale controls how far the ring/ticks extend from center, as a
	fraction of size. 1.0 is used for "any" icons (fills most of the square);
	a smaller value is used for "maskable" icons so the mark clears the
	safe-zone circle after OS cropping.
	"""
	img = Image.new("RGB", (size, size), BG_COLOR)
	draw = ImageDraw.Draw(img)
	cx = cy = size / 2

	def scaled(fraction: float) -> float:
		return size * fraction * content_scale

	ring_radius = scaled(0.33)
	ring_width = scaled(0.055)
	tick_inner = scaled(0.42)
	tick_outer = scaled(0.49)
	tick_width = scaled(0.055)
	dot_radius = scaled(0.085)

	# Outer ring.
	draw.ellipse(
		[cx - ring_radius, cy - ring_radius, cx + ring_radius, cy + ring_radius],
		outline=ACCENT_COLOR,
		width=round(ring_width),
	)

	# Four ticks (top/bottom/left/right), each capped with a small circle so
	# the flat PIL line reads as round-capped instead of squared-off.
	half_w = tick_width / 2
	ticks = [
		(cx, cy - tick_outer, cx, cy - tick_inner),  # top
		(cx, cy + tick_inner, cx, cy + tick_outer),  # bottom
		(cx - tick_outer, cy, cx - tick_inner, cy),  # left
		(cx + tick_inner, cy, cx + tick_outer, cy),  # right
	]
	for x0, y0, x1, y1 in ticks:
		draw.line([x0, y0, x1, y1], fill=ACCENT_COLOR, width=round(tick_width))
		for x, y in ((x0, y0), (x1, y1)):
			draw.ellipse([x - half_w, y - half_w, x + half_w, y + half_w], fill=ACCENT_COLOR)

	# Center lock-on dot.
	draw.ellipse(
		[cx - dot_radius, cy - dot_radius, cx + dot_radius, cy + dot_radius],
		fill=DOT_COLOR,
	)

	return img


def render(size: int, content_scale: float) -> Image.Image:
	hi_res = draw_reticle(SUPERSAMPLE, content_scale)
	return hi_res.resize((size, size), Image.LANCZOS)


def main() -> None:
	OUT_DIR.mkdir(parents=True, exist_ok=True)

	targets = [
		("icon-192.png", 192, 1.0),
		("icon-512.png", 512, 1.0),
		# Maskable safe zone = centered circle at 80% of the square's diameter
		# (radius 0.40). content_scale 0.8 keeps our tick tips (which reach
		# 0.49 * content_scale at full scale) at radius ~0.39, just inside it.
		("icon-192-maskable.png", 192, 0.8),
		("icon-512-maskable.png", 512, 0.8),
	]

	for filename, size, content_scale in targets:
		out_path = OUT_DIR / filename
		render(size, content_scale).save(out_path, "PNG")
		print(f"wrote {out_path} ({size}x{size}, content_scale={content_scale})")


if __name__ == "__main__":
	main()

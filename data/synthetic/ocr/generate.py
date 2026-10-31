"""Generate synthetic OCR documents. Requires Pillow; contains no real personal data."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent

def font(size):
    for candidate in ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "Arial.ttf", "DejaVuSans.ttf"]:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    raise RuntimeError("Install Arial or DejaVu Sans before generating test documents.")

def report(name, village, people, male, female):
    image = Image.new("RGB", (1600, 1200), "white")
    draw = ImageDraw.Draw(image)
    lines = ["LAPORAN SINTETIS UNTUK UJI OCR", f"Posko {name}", f"Desa {village}",
             f"Jumlah jiwa: {people}", f"Laki-laki: {male}", f"Perempuan: {female}",
             "Lansia: 12", "Disabilitas: 0", "Kebutuhan: air bersih dan beras."]
    for i, line in enumerate(lines):
        draw.text((100, 90 + i * 105), line, font=font(48), fill="black")
    return image

if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    first = report("Harapan", "Sukamaju", 100, 40, 60)
    second = report("Melati", "Cibening", 80, 30, 50)
    first.save(ROOT / "laporan-posko.png")
    first.save(ROOT / "laporan-posko.jpg", quality=95)
    first.save(ROOT / "laporan-dua-halaman.pdf", save_all=True, append_images=[second], resolution=150.0)
    first.save(ROOT / "enam-halaman-ditolak.pdf", save_all=True, append_images=[first] * 5, resolution=150.0)
    Image.new("RGB", (300, 300), "white").save(ROOT / "gambar-kosong.png")
    print("Generated synthetic PNG, JPEG, two-page scan, six-page scan and blank image.")

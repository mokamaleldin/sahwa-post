"""Extract the original Sahwa logo/symbol and obtain the full open IBM fonts.

Usage: python3 scripts/prepare-brand-guide.py /path/to/sahwa-guide.pdf
The reference is the six-page guide supplied for this project. Heading font
programs are not present in the PDF and are never reconstructed from subsets.
"""
from pathlib import Path
import argparse
import io
import json
import urllib.request

import fitz
from fontTools.ttLib import TTFont
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('guide', type=Path)
args = parser.parse_args()
assets = Path(__file__).resolve().parents[1] / 'dist' / 'assets'
assets.mkdir(parents=True, exist_ok=True)

with fitz.open(args.guide) as document:
    if len(document) != 6:
        raise ValueError('Expected the original six-page Sahwa brand guide.')
    for page_index, image_index, filename in [(3, 0, 'sahwa-symbol.png'), (0, 3, 'sahwa-logo.png')]:
        page = document[page_index]
        xref = page.get_image_info(xrefs=True)[image_index]['xref']
        image_record = next(image for image in page.get_images(full=True) if image[0] == xref)
        pixmap = fitz.Pixmap(document, xref)
        if image_record[1]:
            pixmap = fitz.Pixmap(pixmap, fitz.Pixmap(document, image_record[1]))
        pixmap.save(assets / filename)

for weight in ['Regular', 'Thin']:
    url = f'https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsansarabic/IBMPlexSansArabic-{weight}.ttf'
    data = urllib.request.urlopen(url, timeout=30).read()
    font = TTFont(io.BytesIO(data))
    if not all(ord(letter) in font.getBestCmap() for letter in 'صحوةالعنوانالتاريخـ') or 'GSUB' not in font:
        raise ValueError(f'Incomplete Arabic font: {weight}')
    (assets / f'IBMPlexSansArabic-{weight}.ttf').write_bytes(data)

Image.new('RGB', (1080, 1300), '#f2e9e2').save(assets / 'guide-paper.png', optimize=True)
brand = {
    'version': 1,
    'source': 'دليل صحوة، الصفحات 2–6',
    'colors': {'primary': '#752026', 'dark': '#350e15', 'gold': '#d6ad63', 'paper': '#f2e9e2'},
    'typography': {
        'title': ['Asal Arabic Bold', 'Milan Display Black'],
        'text': {'family': 'IBM Plex Sans Arabic', 'weight': 400},
        'information': {'family': 'IBM Plex Sans Arabic', 'weight': 100},
    },
    'rules': {
        'background': 'off-white instead of pure white',
        'logo': 'original Sahwa logo at upper left',
        'symbol': 'original Sahwa symbol in background or at element corner',
        'lighting': 'preserve soft upper-left light',
        'layout': 'retain balanced title/image areas and protected text spaces',
    },
    'heading_font_status': 'Full Asal or Milan file must be supplied locally; the PDF does not contain either font program.',
}
(assets / 'brand-guide.json').write_text(json.dumps(brand, ensure_ascii=False, indent=2) + '\n')
print('Prepared the Sahwa brand assets and complete IBM Regular/Thin fonts.')

"""Extract the fixed artwork from the supplied Illustrator PDF, without redrawing it."""
from pathlib import Path
import base64
import copy
import json
import urllib.request
import xml.etree.ElementTree as ET

import fitz
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'design' / 'template.ai'
OUT = ROOT / 'dist' / 'assets'
OUT.mkdir(parents=True, exist_ok=True)
NS = 'http://www.w3.org/2000/svg'
XLINK = '{http://www.w3.org/1999/xlink}href'
ET.register_namespace('', NS)
ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')

doc = fitz.open(SOURCE)
page = doc[0]
original = ET.fromstring(page.get_svg_image(text_as_path=True))
page.get_pixmap(matrix=fitz.Matrix(180 / page.rect.width, 180 / page.rect.width), alpha=False).save(OUT / 'basic-thumbnail.png')

def serialize(node):
    return ET.tostring(node, encoding='utf-8', xml_declaration=True)

def data_uri(mime, data):
    return f'data:{mime};base64,' + base64.b64encode(data).decode('ascii')

def prune_fonts(node):
    for parent in list(node.iter()):
        for child in list(parent):
            if child.get('id', '').startswith('font_'):
                parent.remove(child)

def empty_svg():
    root = ET.Element(f'{{{NS}}}svg', {
        'width': '259.2', 'height': '312', 'viewBox': '0 0 259.2 312',
    })
    return root

base = copy.deepcopy(original)
badge_masks = {'url(#mask_6)', 'url(#mask_9)', 'url(#mask_10)'}
removed_text = 0
for parent in list(base.iter()):
    for child in list(parent):
        if 'data-text' in child.attrib:
            parent.remove(child)
            removed_text += 1
        elif child.get('mask') in badge_masks:
            parent.remove(child)
prune_fonts(base)
base_svg = serialize(base)
(OUT / 'fixed-artwork.svg').write_bytes(base_svg)
base_doc = fitz.open(stream=base_svg, filetype='svg')
base_page = base_doc[0]
pix = base_page.get_pixmap(matrix=fitz.Matrix(1080 / base_page.rect.width, 1080 / base_page.rect.width), alpha=False)
pix.save(OUT / 'fixed-artwork.png')

# Original headline outlines remain available for the initial untouched template.
title = empty_svg()
title.set('width', '1080')
title.set('height', '1300')
defs = ET.SubElement(title, f'{{{NS}}}defs')
for node in original.iter():
    if node.get('id', '').startswith('font_2_'):
        defs.append(copy.deepcopy(node))
for node in original.iter():
    if 'data-text' in node.attrib and node.get(XLINK, '').startswith('#font_2_'):
        title.append(copy.deepcopy(node))
title_svg = serialize(title)
(OUT / 'original-headline.svg').write_bytes(title_svg)

# Isolate the exact gold information marker, including its original transparency mask.
badge = empty_svg()
badge.set('viewBox', '171.40749 197.44976 13.170104 13.170104')
badge.set('width', '54.875433')
badge.set('height', '54.875433')
badge_defs = copy.deepcopy(original.find(f'{{{NS}}}defs'))
prune_fonts(badge_defs)
badge.append(badge_defs)
for node in original.iter():
    if node.get('mask') == 'url(#mask_6)':
        badge.append(copy.deepcopy(node))
        break
badge_svg = serialize(badge)
(OUT / 'gold-marker.svg').write_bytes(badge_svg)
marker_info = next(info for info in page.get_images(full=True) if info[0] == 38)
marker_pixmap = fitz.Pixmap(doc, marker_info[0])
if marker_info[1]:
    marker_pixmap = fitz.Pixmap(marker_pixmap, fitz.Pixmap(doc, marker_info[1]))
marker_pixmap.save(OUT / 'gold-marker.png')

font_sources = {
    'extraLight': ('IBMPlexSansArabic-ExtraLight.ttf', 'https://fonts.gstatic.com/s/ibmplexsansarabic/v15/Qw3NZRtWPQCuHme67tEYUIx3Kh0PHR9N6YPy_dCT.ttf'),
    'light': ('IBMPlexSansArabic-Light.ttf', 'https://fonts.gstatic.com/s/ibmplexsansarabic/v15/Qw3NZRtWPQCuHme67tEYUIx3Kh0PHR9N6YOW_tCT.ttf'),
    'bold': ('IBMPlexSansArabic-Bold.ttf', 'https://fonts.gstatic.com/s/ibmplexsansarabic/v15/Qw3NZRtWPQCuHme67tEYUIx3Kh0PHR9N6YOG-dCT.ttf'),
}
font_data = {}
for key, (filename, url) in font_sources.items():
    dest = OUT / filename
    if not dest.exists():
        with urllib.request.urlopen(url, timeout=30) as response:
            dest.write_bytes(response.read())
    font = TTFont(dest)
    cmap = font.getBestCmap() or {}
    assert all(ord(c) in cmap for c in 'صحوةالعنوانمرحباتاريخ'), filename
    font_data[key] = data_uri('font/ttf', dest.read_bytes())

license_path = OUT / 'IBM-Plex-OFL.txt'
if not license_path.exists():
    with urllib.request.urlopen('https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsansarabic/OFL.txt', timeout=30) as response:
        license_path.write_bytes(response.read())

bundle = {
    'background': data_uri('image/png', (OUT / 'fixed-artwork.png').read_bytes()),
    'originalTitle': data_uri('image/svg+xml', title_svg),
    'badge': data_uri('image/png', (OUT / 'gold-marker.png').read_bytes()),
    'fonts': font_data,
}
(ROOT / 'dist' / 'template-assets.js').write_text('window.SAHWA_ASSETS = ' + json.dumps(bundle) + ';\n')
print(json.dumps({'removed_placeholder_glyphs': removed_text, 'artboard': [1080, 1300], 'fixed_render': [pix.width, pix.height], 'original_title_glyphs': len(title) - 1, 'fonts': list(font_data), 'template_bundle_bytes': (ROOT / 'dist' / 'template-assets.js').stat().st_size}))

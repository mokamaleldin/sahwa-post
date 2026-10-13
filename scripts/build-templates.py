"""Bundle the prepared template artwork and fonts for hosted and offline use."""
from pathlib import Path
import base64
import json

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
ASSETS = DIST / 'assets'


def data_uri(path, mime='image/png'):
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode('ascii')


bundle = {
    'background': data_uri(ASSETS / 'fixed-artwork.png'),
    'originalTitle': data_uri(ASSETS / 'original-headline.svg', 'image/svg+xml'),
    'badge': data_uri(ASSETS / 'gold-marker.png'),
    'thumbnail': data_uri(ASSETS / 'basic-thumbnail.png'),
    'brand': json.loads((ASSETS / 'brand-guide.json').read_text()),
    'symbol': data_uri(ASSETS / 'sahwa-symbol.png'),
    'logo': data_uri(ASSETS / 'sahwa-logo.png'),
    'fonts': {
        key: data_uri(ASSETS / f'IBMPlexSansArabic-{weight}.ttf', 'font/ttf')
        for key, weight in [('regular', 'Regular'), ('thin', 'Thin'), ('bold', 'Bold')]
    },
    'templates': [],
}

names = {
    'psb2': ('قالب المحاضرة', 'صورة الأستاذ و٣ معلومات'),
    'psb3': ('قالب الصورة', 'عنوان وصورة كبيرة'),
}
aliases = {'originalSpeakerName': 'originalSpeaker', 'marker': 'badge'}
for template_id in ['psb2', 'psb3']:
    metadata = json.loads((ASSETS / template_id / 'metadata.json').read_text())
    template = {key: metadata[key] for key in ['id', 'name', 'description', 'width', 'height', 'color', 'defaults', 'fields', 'layout']}
    template['name'], template['summary'] = names[template_id]
    template['typography'] = {'textFamily': 'SahwaBodyRegular', 'textWeight': 400, 'informationFamily': 'SahwaBodyThin', 'informationWeight': 100}
    template['assets'] = {}
    for key, relative_path in metadata['assets'].items():
        if key in ['originalSubtitle', 'originalSpeakerName'] or key.startswith('originalInformation'):
            continue  # Body text is now drawn with the weights specified in the brand guide.
        source = data_uri(DIST / relative_path)
        if key == 'thumbnail':
            template['thumbnail'] = source
        else:
            template['assets'][aliases.get(key, key)] = source
    for key in ['title', 'subtitle']:
        spec = template['layout'][key]
        if spec.get('align') == 'center':
            spec['right'] = (spec['bounds'][0] + spec['bounds'][2]) / 2
    template['layout']['subtitle']['maxLines'] = 2
    template['layout']['subtitle']['min'] = template['layout']['subtitle']['max']
    template['layout']['subtitle']['lineHeight'] = round(template['layout']['subtitle']['max'] * 1.45, 2)
    if template_id == 'psb2':
        template['layout']['photoCircle'] = {'x': 4, 'y': 563, 'width': 476, 'height': 486, 'shape': 'ellipse', 'fit': 'cover'}
        template['fields']['imageHint'] = 'الصورة العادية تبقى داخل الدائرة. للشخص المفرغ اختر «صورة مفرغة» أو استخدم التفريغ التلقائي.'
        template['layout']['symbol'] = {'x': 416, 'y': 506, 'width': 90, 'height': 90, 'opacity': 0.55, 'layer': 'behind-photo'}
    else:
        template['assets']['background'] = data_uri(ASSETS / 'guide-paper.png')
        template['layout']['symbol'] = {'x': 914, 'y': 72, 'width': 104, 'height': 104, 'opacity': 0.13, 'layer': 'background'}
    template['assets']['symbol'] = bundle['symbol']
    template['example'] = {
        **template['defaults'], 'title': 'لقاء\nصحوة',
        'subtitle': 'مساحة نتعلم فيها ونترك أثرًا',
        'speakerName': 'أحمد محمد' if template_id == 'psb2' else '',
        **({
            'info1Value': 'المكان: مركز بلاد الشام',
            'info2Value': 'السبت، الساعة 17:00',
            'info3Value': 'التفاصيل في وصف المنشور',
        } if template_id == 'psb2' else {}),
    }
    bundle['templates'].append(template)

destination = DIST / 'template-assets.js'
destination.write_text('window.SAHWA_ASSETS = ' + json.dumps(bundle, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(json.dumps({'templates': 3, 'bundle_bytes': destination.stat().st_size}))

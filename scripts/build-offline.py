"""Produce the same app as one self-contained HTML file for local use."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
html = (dist / 'index.html').read_text()
html = re.sub(r'<link rel="stylesheet" href="styles\.css(?:\?[^\"]*)?">', lambda _: '<style>\n' + (dist / 'styles.css').read_text() + '\n</style>', html)
for filename in ['template-assets.js', 'arabic-joining.js', 'engine.js', 'portrait.js', 'app.js']:
    script = (dist / filename).read_text().replace('</script', '<\\/script')
    html = re.sub(r'<script src="' + re.escape(filename) + r'(?:\?[^\"]*)?"></script>', lambda _: '<script>\n' + script + '\n</script>', html)
html = html.replace('<a href="offline.html" download="sahwa-studio.html" class="offline-link">نسخة بدون إنترنت <span aria-hidden="true">↙</span></a>', '<span class="offline-link">نسخة بدون إنترنت</span>')
(dist / 'offline.html').write_text(html)
print('offline.html:', (dist / 'offline.html').stat().st_size, 'bytes')

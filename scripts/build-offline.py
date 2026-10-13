"""Produce the same app as one self-contained HTML file for local use."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
html = (dist / 'index.html').read_text()
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + (dist / 'styles.css').read_text() + '\n</style>')
for filename in ['template-assets.js', 'engine.js', 'app.js']:
    script = (dist / filename).read_text().replace('</script', '<\\/script')
    html = html.replace(f'<script src="{filename}"></script>', '<script>\n' + script + '\n</script>')
html = html.replace('<a href="offline.html" download="sahwa-studio.html" class="offline-link">نسخة بدون إنترنت <span aria-hidden="true">↙</span></a>', '<span class="offline-link">نسخة بدون إنترنت</span>')
(dist / 'offline.html').write_text(html)
print('offline.html:', (dist / 'offline.html').stat().st_size, 'bytes')

(async function () {
  'use strict';
  const Engine = window.SahwaEngine;
  const ASSETS = window.SAHWA_ASSETS;
  const form = document.getElementById('post-form');
  const canvas = document.getElementById('poster');
  const ctx = canvas.getContext('2d');
  const downloadButton = document.getElementById('download-button');
  const exportNote = document.getElementById('export-note');
  const renderStatus = document.getElementById('render-status');
  const generalError = document.getElementById('general-error');
  const trialButton = document.getElementById('trial-button');
  const fontMessage = document.getElementById('font-message');
  const storageKey = 'sahwa-simple-v1-input';
  let images = null, result = null, customFace = null, mode = 'original';
  let raf = null, toastTimer = null, saveTimer = null, databasePromise = null;

  function readInput() { return Object.fromEntries(Engine.KEYS.map(key => [key, form.elements.namedItem(key).value])); }
  function putInput(input) { Engine.KEYS.forEach(key => { form.elements.namedItem(key).value = String(input[key] ?? ''); }); }
  function toast(message) {
    const el = document.getElementById('toast'); el.textContent = message; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('تعذّر تحميل أحد عناصر القالب. أعد فتح الصفحة.'));
      image.src = src;
    });
  }
  function db() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('حفظ الخط غير متاح في هذا المتصفح.')); return; }
      const request = indexedDB.open('sahwa-studio-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('fonts');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return databasePromise;
  }
  async function storedFont(action, value) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('fonts', action === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('fonts');
      const request = action === 'get' ? store.get('title') : action === 'put' ? store.put(value, 'title') : store.delete('title');
      let output;
      request.onsuccess = () => { output = request.result; };
      transaction.oncomplete = () => resolve(output);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  function showFontState() {
    const indicator = document.getElementById('font-indicator');
    const summary = document.getElementById('font-summary');
    const description = document.getElementById('font-description');
    indicator.classList.toggle('ready', mode === 'custom');
    trialButton.classList.toggle('active', mode === 'trial');
    trialButton.setAttribute('aria-pressed', String(mode === 'trial'));
    document.getElementById('remove-font-button').hidden = !customFace;
    if (mode === 'custom') {
      summary.textContent = 'خط العنوان الأصلي جاهز';
      description.textContent = 'Asal Arabic Bold مرفوع. العنوان الجديد سيُكتب بهذا الخط، والمعلومات بخط IBM Plex Sans Arabic.';
      trialButton.textContent = 'تجربة الخط المؤقت';
    } else if (mode === 'trial') {
      summary.textContent = 'وضع التجربة — خط عنوان مؤقت';
      description.textContent = 'العنوان الجديد يُكتب مؤقتًا بخط IBM Plex Sans Arabic Bold. ارفع Asal Arabic Bold لاستخدام خط القالب الأصلي.';
      trialButton.textContent = customFace ? 'العودة للخط الأصلي' : 'إلغاء الخط المؤقت';
    } else {
      summary.textContent = 'خط العنوان الأصلي';
      description.textContent = 'العنوان الأصلي محفوظ كما هو. لتغييره بنفس الخط، ارفع Asal Arabic Bold، أو جرّب الأداة بخط مؤقت.';
      trialButton.textContent = 'تجربة بخط مؤقت';
    }
  }
  function showErrors(errors) {
    for (const key of Engine.KEYS) {
      const input = form.elements.namedItem(key);
      input.removeAttribute('aria-invalid');
      const el = document.getElementById(`${key}-error`);
      if (el) el.textContent = '';
    }
    for (const error of errors) {
      const input = form.elements.namedItem(error.field);
      if (input) input.setAttribute('aria-invalid', 'true');
      const el = document.getElementById(`${error.field}-error`);
      if (el) el.textContent = error.message;
    }
  }
  function draw() {
    raf = null;
    if (!images) return;
    try {
      const input = readInput();
      result = Engine.render(ctx, input, { images, titleMode: mode });
      canvas.setAttribute('aria-label', `معاينة بوست صحوة. العنوان: ${input.title}. ${input.subtitle}. ${[1, 2, 3].map(i => `${input[`info${i}Label`]} ${input[`info${i}Value`]}`).join('. ')}`);
      document.getElementById('title-count').textContent = `${Array.from(input.title).length} / 100`;
      showErrors(result.errors);
      document.getElementById('trial-badge').hidden = result.originalTitle || mode === 'custom' || !input.title.trim();
      downloadButton.disabled = !result.valid;
      renderStatus.textContent = result.valid ? 'جاهز للتنزيل' : result.errors.every(error => error.field === 'titleFont') ? 'بانتظار خط العنوان' : 'راجع الحقول';
      renderStatus.classList.toggle('ready', result.valid);
      if (!result.valid) exportNote.textContent = result.errors[0].message;
      else if (result.temporaryFont) exportNote.textContent = 'النسخة التجريبية تستخدم خط عنوان مؤقتًا؛ الخلفية والشعار محفوظان.';
      else if (result.originalTitle && mode !== 'custom') exportNote.textContent = 'العنوان الأصلي محفوظ. يمكنك تعديل الجملة الثانوية والمعلومات وتنزيل التصميم.';
      else exportNote.textContent = 'صورة PNG بالحجم الأصلي، بدون إضافات على التصميم.';
      generalError.hidden = true;
    } catch (error) {
      downloadButton.disabled = true; result = null;
      generalError.hidden = false; generalError.textContent = 'تعذّر تحديث المعاينة. أعد تحميل الصفحة وجرب مرة أخرى.';
      renderStatus.textContent = 'المعاينة غير جاهزة';
    }
  }
  function scheduleDraw() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  }
  function saveInput() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(readInput()));
        document.getElementById('save-status').innerHTML = '<span class="save-dot"></span> حُفظت الحقول على هذا الجهاز';
      } catch {
        document.getElementById('save-status').textContent = 'الحقول محفوظة أثناء فتح الصفحة فقط';
      }
    }, 450);
  }
  async function applyTitleFont(buffer, persist, filename) {
    const names = Engine.parseFontNames(buffer);
    if (!Engine.isOriginalFont(names)) throw new Error('هذا ليس خط Asal Arabic Bold المستخدم في القالب. ارفع ملفه الأصلي بصيغة TTF أو OTF.');
    const face = new FontFace('SahwaTitle', buffer, { weight: '700', style: 'normal' });
    await face.load();
    document.fonts.add(face);
    if (customFace) document.fonts.delete(customFace);
    customFace = face; mode = 'custom';
    showFontState(); draw();
    if (persist) {
      try {
        await storedFont('put', { buffer, filename });
        fontMessage.textContent = 'الخط الأصلي جاهز ومحفوظ على هذا الجهاز.';
      } catch { fontMessage.textContent = 'الخط جاهز لهذه الجلسة. قد تحتاج إلى رفعه مجددًا عند إعادة فتح الصفحة.'; }
    }
  }

  putInput(Engine.DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved === 'object' && Engine.KEYS.every(key => typeof saved[key] === 'string')) putInput(saved);
  } catch { /* Local storage is optional, including when opened as a local file. */ }
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', event => {
    if (Engine.KEYS.includes(event.target.name)) { scheduleDraw(); saveInput(); }
  });
  document.getElementById('example-button').addEventListener('click', () => {
    putInput(Engine.EXAMPLE); draw(); saveInput();
    if (mode === 'original') {
      document.getElementById('font-settings').open = true;
      toast('تم ملء المثال. ارفع خط العنوان، أو اضغط «تجربة بخط مؤقت» لتنزيله الآن.');
    } else toast('تم ملء بيانات مثال؛ يمكنك تعديل أي حقل.');
  });
  document.getElementById('clear-button').addEventListener('click', () => {
    putInput({}); draw(); saveInput(); form.elements.namedItem('title').focus();
  });
  trialButton.addEventListener('click', () => {
    mode = mode === 'trial' ? (customFace ? 'custom' : 'original') : 'trial';
    fontMessage.textContent = ''; showFontState(); draw();
  });
  document.getElementById('font-upload-button').addEventListener('click', () => document.getElementById('font-file').click());
  document.getElementById('font-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    fontMessage.textContent = 'جارٍ فحص الخط…';
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('ملف الخط كبير جدًا. الحد الأقصى 12 ميجابايت.');
      await applyTitleFont(await file.arrayBuffer(), true, file.name);
    } catch (error) { fontMessage.textContent = error.message || 'تعذّر قراءة الخط. جرّب ملفًا أصليًا آخر.'; }
    event.target.value = '';
  });
  document.getElementById('remove-font-button').addEventListener('click', async () => {
    if (customFace) document.fonts.delete(customFace);
    customFace = null; mode = 'original';
    try { await storedFont('delete'); } catch { /* Storage may be unavailable. */ }
    fontMessage.textContent = 'أُزيل الخط من هذا الجهاز.'; showFontState(); draw();
  });
  downloadButton.addEventListener('click', async () => {
    draw(); if (!result?.valid) return;
    downloadButton.disabled = true;
    const filenamePrefix = result.temporaryFont ? 'sahwa-demo' : 'sahwa-post';
    const text = downloadButton.querySelector('span'); text.textContent = 'جارٍ تجهيز الصورة…';
    try {
      const blob = await new Promise((resolve, reject) => canvas.toBlob(output => output ? resolve(output) : reject(new Error('تعذّر إنشاء الصورة.')), 'image/png'));
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast(result.temporaryFont ? 'تم تنزيل الصورة التجريبية بخط العنوان المؤقت.' : 'تم تنزيل التصميم بالحجم الأصلي.');
    } catch (error) { toast(error.message || 'تعذّر تنزيل الصورة. أعد المحاولة.'); }
    finally { text.textContent = 'تنزيل التصميم PNG'; downloadButton.disabled = !result?.valid; }
  });

  try {
    if (!ctx || !window.FontFace) throw new Error('هذا المتصفح لا يدعم توليد التصميم. استخدم إصدارًا حديثًا من Chrome أو Firefox أو Safari.');
    const fontSpecifications = [
      ['SahwaBodyExtraLight', ASSETS.fonts.extraLight, '200'],
      ['SahwaBodyLight', ASSETS.fonts.light, '300'],
      ['SahwaBodyBold', ASSETS.fonts.bold, '700']
    ];
    const faces = await Promise.all(fontSpecifications.map(async ([family, source, weight]) => {
      const face = new FontFace(family, `url(${source})`, { weight, style: 'normal' }); await face.load(); return face;
    }));
    faces.forEach(face => document.fonts.add(face));
    const imageEntries = await Promise.all(['background', 'originalTitle', 'badge'].map(async key => [key, await loadImage(ASSETS[key])]));
    images = Object.fromEntries(imageEntries);
    try {
      const saved = await storedFont('get');
      if (saved?.buffer) await applyTitleFont(saved.buffer, false, saved.filename);
    } catch { /* A saved title font is optional. */ }
    showFontState(); draw();
  } catch (error) {
    generalError.hidden = false; generalError.textContent = error.message || 'تعذّر تجهيز القالب. أعد تحميل الصفحة.';
    renderStatus.textContent = 'تعذّر تحميل القالب';
    exportNote.textContent = 'التنزيل متوقف حتى يكتمل تحميل القالب.'; downloadButton.disabled = true;
  }
})();

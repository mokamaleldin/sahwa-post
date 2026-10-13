(async function () {
  'use strict';
  const Engine = window.SahwaEngine;
  const ASSETS = window.SAHWA_ASSETS;
  const Portrait = window.SahwaPortrait;
  const templates = [{
    ...Engine.BASIC_TEMPLATE, thumbnail: ASSETS.thumbnail,
    assets: { background: ASSETS.background, originalTitle: ASSETS.originalTitle, badge: ASSETS.badge }
  }, ...(ASSETS.templates || [])];
  const form = document.getElementById('post-form');
  const canvas = document.getElementById('poster');
  const ctx = canvas.getContext('2d');
  const downloadButton = document.getElementById('download-button');
  const exportNote = document.getElementById('export-note');
  const renderStatus = document.getElementById('render-status');
  const generalError = document.getElementById('general-error');
  const trialButton = document.getElementById('trial-button');
  const fontMessage = document.getElementById('font-message');
  const photoError = document.getElementById('photo-error');
  const storageKey = 'sahwa-studio-v2';
  const imageCache = new Map(), photos = new Map();
  const state = { selected: templates[0].id, quality: 3, drafts: {} };
  let template = templates[0], images = null, result = null, customFace = null, mode = 'trial';
  let raf = null, toastTimer = null, saveTimer = null, databasePromise = null;
  let selectionVersion = 0, photoVersion = 0, ready = false, exporting = false, processingPhotoId = null;

  function readInput() { return Object.fromEntries(Engine.KEYS.map(key => [key, form.elements.namedItem(key).value])); }
  function putInput(input) { Engine.KEYS.forEach(key => { form.elements.namedItem(key).value = String(input[key] ?? ''); }); }
  function settings() {
    return {
      infoEnabled: [1, 2, 3].map(i => form.elements.namedItem(`info${i}Enabled`).checked),
      titleKashida: form.elements.titleKashida.checked,
      photoMode: form.elements.photoMode.value,
      grayscale: form.elements.photoGrayscale.checked
    };
  }
  function putSettings(draft = {}) {
    for (let i = 1; i <= 3; i++) form.elements.namedItem(`info${i}Enabled`).checked = draft.infoEnabled?.[i - 1] !== false;
    form.elements.titleKashida.checked = draft.titleKashida !== false;
    form.elements.photoMode.value = draft.photoMode === 'cutout' ? 'cutout' : 'circle';
    form.elements.photoGrayscale.checked = draft.grayscale === true;
  }
  function updateInformationStates() {
    document.querySelectorAll('.information-row').forEach((row, index) => {
      const enabled = form.elements.namedItem(`info${index + 1}Enabled`).checked;
      row.classList.toggle('disabled', !enabled);
      row.querySelectorAll('.information-inputs input').forEach(input => { input.disabled = !enabled; });
    });
  }
  function updateExportSize() {
    const dimensions = Engine.exportDimensions(template, state.quality);
    document.getElementById('export-size').textContent = `${dimensions.width} × ${dimensions.height}`;
  }
  function transform() {
    return { zoom: Number(form.elements.photoZoom.value), x: Number(form.elements.photoX.value), y: Number(form.elements.photoY.value) };
  }
  function putTransform(value = {}) {
    form.elements.photoZoom.value = String(value.zoom || 1);
    form.elements.photoX.value = String(value.x || 0);
    form.elements.photoY.value = String(value.y || 0);
    document.getElementById('photo-zoom-value').textContent = `${Math.round(Number(form.elements.photoZoom.value) * 100)}%`;
  }
  function toast(message) {
    const el = document.getElementById('toast'); el.textContent = message; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('تعذّر تحميل الصورة أو أحد عناصر القالب. جرّب مجددًا.'));
      image.src = src;
    });
  }
  async function loadPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      if (!image.width || !image.height) throw new Error('هذه الصورة غير صالحة.');
      const analyzed = file.type === 'image/png' ? Portrait.trimPhoto(image) : { image, hasTransparency: false };
      return { ...analyzed, rawImage: image, file, name: file.name || 'الصورة المرفوعة' };
    } finally { URL.revokeObjectURL(url); }
  }
  function db() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('الحفظ غير متاح في هذا المتصفح.')); return; }
      const request = indexedDB.open('sahwa-studio-v1', 2);
      request.onupgradeneeded = () => {
        for (const name of ['fonts', 'photos']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('أغلق النسخ الأخرى من الأداة ثم جرّب الحفظ مجددًا.'));
    });
    return databasePromise;
  }
  async function stored(storeName, key, action, value) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, action === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = action === 'get' ? store.get(key) : action === 'put' ? store.put(value, key) : store.delete(key);
      let output;
      request.onsuccess = () => { output = request.result; };
      transaction.oncomplete = () => resolve(output);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  function captureDraft() {
    state.drafts[template.id] = { input: readInput(), photoTransform: transform(), ...settings() };
  }
  function persistDrafts() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      document.getElementById('save-status').innerHTML = '<span class="save-dot"></span> حُفظت مسودة هذا القالب على الجهاز';
    } catch {
      document.getElementById('save-status').textContent = 'المسودة محفوظة أثناء فتح الصفحة فقط';
    }
  }
  function saveInput() {
    captureDraft(); clearTimeout(saveTimer);
    saveTimer = setTimeout(persistDrafts, 450);
  }
  function showFontState() {
    document.getElementById('font-indicator').classList.toggle('ready', mode === 'custom');
    trialButton.classList.toggle('active', mode === 'trial');
    trialButton.setAttribute('aria-pressed', String(mode === 'trial'));
    document.getElementById('remove-font-button').hidden = !customFace;
    const summary = document.getElementById('font-summary');
    const description = document.getElementById('font-description');
    if (mode === 'custom') {
      summary.textContent = 'خط العنوان الأصلي جاهز';
      description.textContent = 'Asal Arabic Bold جاهز للقوالب الثلاثة. الجملة الثانوية والمعلومات بخطوط IBM Plex Sans Arabic الأصلية.';
      trialButton.textContent = 'تجربة الخط المؤقت';
    } else if (mode === 'trial') {
      summary.textContent = 'خط العناوين الجديدة مؤقت';
      description.textContent = 'يمكنك العمل والتنزيل الآن بخط IBM Plex Sans Arabic Bold. العنوان الافتراضي محفوظ من القالب، وستستخدم العناوين الجديدة Asal Arabic Bold عند رفعه.';
      trialButton.textContent = customFace ? 'العودة للخط الأصلي' : 'انتظار الخط الأصلي';
    } else {
      summary.textContent = 'بانتظار خط العنوان الأصلي';
      description.textContent = 'العنوان الافتراضي محفوظ. ارفع Asal Arabic Bold لكتابة عنوان جديد بنفس الخط، أو فعّل الخط المؤقت الآن.';
      trialButton.textContent = 'استخدام خط مؤقت';
    }
  }
  function showPhotoState() {
    const photo = photos.get(template.id);
    document.getElementById('photo-name').textContent = photo?.name || 'الصورة الأصلية';
    document.getElementById('photo-controls').hidden = !photo;
    document.getElementById('photo-original-button').hidden = !photo;
    const busy = processingPhotoId === template.id;
    form.elements.photoMode.querySelector('option[value="cutout"]').disabled = !!photo && !photo.hasTransparency;
    if (photo && !photo.hasTransparency && form.elements.photoMode.value === 'cutout') form.elements.photoMode.value = 'circle';
    document.getElementById('photo-remove-background').disabled = !photo || busy || photo.hasTransparency;
    document.getElementById('photo-remove-background').title = photo?.hasTransparency ? 'الصورة مفرغة بالفعل.' : 'تفريغ الشخص داخل المتصفح';
    document.getElementById('photo-undo-background').hidden = !photo?.removedBackground;
    document.getElementById('photo-undo-background').disabled = busy;
    document.getElementById('photo-original-button').disabled = busy;
    document.getElementById('photo-upload-button').disabled = !images || busy;
  }
  function showErrors(errors) {
    for (const key of Engine.KEYS) {
      form.elements.namedItem(key).removeAttribute('aria-invalid');
      const el = document.getElementById(`${key}-error`); if (el) el.textContent = '';
    }
    for (const error of errors) {
      const input = form.elements.namedItem(error.field);
      if (input) input.setAttribute('aria-invalid', 'true');
      const el = document.getElementById(`${error.field}-error`); if (el) el.textContent = error.message;
    }
  }
  function draw() {
    raf = null;
    if (!ready || !images) return;
    try {
      const input = readInput();
      const preferences = settings();
      result = Engine.render(ctx, input, { images, template, titleMode: mode, photoImage: photos.get(template.id)?.image, photoTransform: transform(), ...preferences });
      const spokenFields = [input.title, input.subtitle];
      if (template.fields.speakerName) spokenFields.push(input.speakerName);
      for (let i = 1; i <= template.fields.informationCount; i++) if (preferences.infoEnabled[i - 1]) spokenFields.push(`${template.fields.labels ? input[`info${i}Label`] : ''} ${input[`info${i}Value`]}`);
      canvas.setAttribute('aria-label', `معاينة ${template.name}. ${spokenFields.join('. ')}`);
      document.getElementById('title-count').textContent = `${Array.from(input.title).length} / 100`;
      document.getElementById('photo-zoom-value').textContent = `${Math.round(transform().zoom * 100)}%`;
      showErrors(result.errors);
      document.getElementById('trial-badge').hidden = !input.title.trim() || result.originalTitle || mode === 'custom';
      downloadButton.disabled = exporting || processingPhotoId === template.id || !result.valid;
      renderStatus.textContent = result.valid ? 'جاهز للتنزيل' : result.errors.every(error => error.field === 'titleFont') ? 'بانتظار خط العنوان' : 'راجع الحقول';
      renderStatus.classList.toggle('ready', result.valid);
      if (!result.valid) exportNote.textContent = result.errors[0].message;
      else if (result.temporaryFont) exportNote.textContent = 'PNG بدون فقد في الضغط. خط العنوان مؤقت لحد رفع الخط الأصلي.';
      else exportNote.textContent = 'PNG بدون فقد في الضغط، وبدون إضافات على التصميم.';
      generalError.hidden = true;
    } catch {
      downloadButton.disabled = true; result = null;
      generalError.hidden = false; generalError.textContent = 'تعذّر تحديث المعاينة. أعد تحميل الصفحة وجرب مرة أخرى.';
      renderStatus.textContent = 'المعاينة غير جاهزة';
    }
  }
  function scheduleDraw() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  }
  function updateFields() {
    document.getElementById('subtitle-field').hidden = !template.fields.subtitle;
    document.getElementById('speaker-field').hidden = !template.fields.speakerName;
    document.getElementById('information-section').hidden = !template.fields.informationCount;
    document.getElementById('photo-settings').hidden = !template.fields.image;
    document.getElementById('portrait-options').hidden = !template.layout.photoCircle;
    document.getElementById('photo-hint').textContent = template.fields.imageHint || '';
    document.getElementById('template-name').textContent = template.name;
    document.getElementById('template-description').textContent = template.summary || template.description;
    document.getElementById('template-image-tag').textContent = template.fields.image ? 'مع صورة' : 'بدون صورة';
    document.querySelectorAll('.information-row').forEach((row, index) => {
      row.hidden = index >= template.fields.informationCount;
      const columns = row.querySelector('.information-inputs');
      columns.classList.toggle('no-labels', !template.fields.labels);
      columns.firstElementChild.hidden = !template.fields.labels;
    });
    document.querySelectorAll('.template-card').forEach(button => {
      const selected = button.dataset.templateId === template.id;
      button.setAttribute('aria-checked', String(selected)); button.tabIndex = selected ? 0 : -1;
    });
    updateInformationStates(); updateExportSize(); showPhotoState(); showErrors([]); photoError.textContent = '';
  }
  async function selectTemplate(id, capture = true) {
    const next = templates.find(item => item.id === id);
    if (!next || (capture && template.id === id)) return;
    if (capture) captureDraft();
    template = next; state.selected = id;
    const token = ++selectionVersion;
    ++photoVersion;
    const draft = state.drafts[id]; putInput(draft?.input || next.defaults); putTransform(draft?.photoTransform); putSettings(draft);
    updateFields(); images = null; result = null; downloadButton.disabled = true;
    document.getElementById('photo-upload-button').disabled = true;
    renderStatus.textContent = 'جارٍ تجهيز القالب…'; renderStatus.classList.remove('ready');
    persistDrafts();
    try {
      if (!imageCache.has(id)) imageCache.set(id, Promise.all(Object.entries(next.assets).map(async ([key, src]) => [key, await loadImage(src)])).then(entries => Object.fromEntries(entries)));
      const loadedImages = await imageCache.get(id);
      if (!photos.has(id) && next.fields.image) {
        let photo = null;
        try {
          const saved = await stored('photos', id, 'get');
          if (saved?.file) photo = { ...await loadPhoto(saved.file), originalFile: saved.originalFile, removedBackground: saved.removedBackground === true };
        } catch { /* Device storage is optional. */ }
        if (!photos.has(id)) photos.set(id, photo);
      }
      if (token !== selectionVersion) return;
      images = loadedImages; canvas.width = next.width; canvas.height = next.height;
      document.getElementById('photo-upload-button').disabled = false;
      showPhotoState(); draw();
    } catch (error) {
      imageCache.delete(id);
      if (token !== selectionVersion) return;
      generalError.hidden = false; generalError.textContent = error.message;
      renderStatus.textContent = 'تعذّر تحميل القالب'; exportNote.textContent = 'أعد تحميل الصفحة لتجهيز القالب.';
    }
  }
  function buildPicker() {
    const container = document.getElementById('template-options');
    for (const item of templates) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'template-card';
      button.dataset.templateId = item.id; button.setAttribute('role', 'radio'); button.setAttribute('aria-checked', 'false');
      const thumbnail = document.createElement('img'); thumbnail.src = item.thumbnail || ASSETS.thumbnail; thumbnail.alt = ''; thumbnail.width = 62; thumbnail.height = 75;
      const text = document.createElement('span'); const name = document.createElement('strong'); name.textContent = item.name;
      const description = document.createElement('small'); description.textContent = item.summary || item.description;
      const check = document.createElement('span'); check.className = 'template-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
      text.append(name, description); button.append(thumbnail, text, check);
      button.addEventListener('click', () => { selectTemplate(item.id); });
      button.addEventListener('keydown', event => {
        const buttons = Array.from(container.children), index = buttons.indexOf(button);
        let target;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') target = buttons[(index + 1) % buttons.length];
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') target = buttons[(index + buttons.length - 1) % buttons.length];
        if (event.key === 'Home') target = buttons[0]; if (event.key === 'End') target = buttons.at(-1);
        if (target) { event.preventDefault(); target.focus(); selectTemplate(target.dataset.templateId); }
      });
      container.append(button);
    }
  }
  async function applyTitleFont(buffer, persist, filename) {
    const names = Engine.parseFontNames(buffer);
    if (!Engine.isOriginalFont(names)) throw new Error('هذا ليس خط Asal Arabic Bold المستخدم في القالب. ارفع ملفه الأصلي بصيغة TTF أو OTF.');
    const face = new FontFace('SahwaTitle', buffer, { weight: '700', style: 'normal' }); await face.load();
    document.fonts.add(face); if (customFace) document.fonts.delete(customFace);
    customFace = face; mode = 'custom'; showFontState(); draw();
    if (persist) {
      try { await stored('fonts', 'title', 'put', { buffer, filename }); fontMessage.textContent = 'الخط الأصلي جاهز ومحفوظ على هذا الجهاز.'; }
      catch { fontMessage.textContent = 'الخط جاهز لهذه الجلسة. قد تحتاج إلى رفعه مجددًا عند إعادة فتح الصفحة.'; }
    }
  }

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.drafts && typeof saved.drafts === 'object') {
      for (const item of templates) {
        const draft = saved.drafts[item.id];
        if (draft?.input && typeof draft.input === 'object') state.drafts[item.id] = { ...draft, input: Engine.cleanInput(draft.input), photoTransform: draft.photoTransform || {} };
      }
      if (templates.some(item => item.id === saved.selected)) state.selected = saved.selected;
      if ([1, 2, 3].includes(saved.quality)) state.quality = saved.quality;
    } else {
      const previous = JSON.parse(localStorage.getItem('sahwa-simple-v1-input'));
      if (previous && typeof previous === 'object') state.drafts[templates[0].id] = { input: Engine.cleanInput(previous) };
    }
  } catch { /* Local storage is optional, including when opened as a local file. */ }
  putInput(template.defaults); putSettings(); document.getElementById('quality-select').value = String(state.quality);
  buildPicker(); updateFields(); showFontState();
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', event => {
    if (Engine.KEYS.includes(event.target.name) || ['photoZoom', 'photoX', 'photoY', 'photoMode', 'photoGrayscale', 'titleKashida', 'info1Enabled', 'info2Enabled', 'info3Enabled'].includes(event.target.name)) {
      updateInformationStates(); scheduleDraw(); saveInput();
    }
  });
  document.getElementById('quality-select').addEventListener('change', event => {
    state.quality = Number(event.target.value); updateExportSize(); persistDrafts();
  });
  window.addEventListener('pagehide', () => { captureDraft(); persistDrafts(); });
  document.getElementById('example-button').addEventListener('click', () => {
    putInput(template.example || { ...template.defaults, title: 'لقاء\nصحوة', subtitle: 'مساحة نتعلم فيها ونترك أثرًا' }); draw(); saveInput();
    toast('تم ملء بيانات مثال؛ يمكنك تعديل أي حقل.');
  });
  document.getElementById('clear-button').addEventListener('click', () => { putInput({}); draw(); saveInput(); form.elements.namedItem('title').focus(); });
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
    if (customFace) document.fonts.delete(customFace); customFace = null; mode = 'trial';
    try { await stored('fonts', 'title', 'delete'); } catch { /* Storage may be unavailable. */ }
    fontMessage.textContent = 'أُزيل الخط. العناوين الجديدة تستخدم الخط المؤقت الآن.'; showFontState(); draw();
  });
  document.getElementById('photo-upload-button').addEventListener('click', () => document.getElementById('photo-file').click());
  document.getElementById('photo-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    const id = template.id, token = ++photoVersion;
    photoError.textContent = 'جارٍ تجهيز الصورة…';
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('اختر صورة PNG أو JPG أو WebP.');
      if (file.size > 20 * 1024 * 1024) throw new Error('حجم الصورة يتجاوز 20 ميجابايت. استخدم نسخة أصغر.');
      const photo = await loadPhoto(file);
      if (token !== photoVersion || template.id !== id) return;
      photos.set(id, photo); putTransform();
      if (template.layout.photoCircle) form.elements.photoMode.value = photo.hasTransparency ? 'cutout' : 'circle';
      showPhotoState(); draw(); saveInput();
      photoError.textContent = '';
      try { await stored('photos', id, 'put', { file }); }
      catch { if (template.id === id) photoError.textContent = 'الصورة جاهزة للجلسة الحالية؛ تعذّر حفظها على هذا الجهاز.'; }
    } catch (error) { if (token === photoVersion && template.id === id) photoError.textContent = error.message || 'تعذّر قراءة الصورة.'; }
    finally { event.target.value = ''; }
  });
  document.getElementById('photo-original-button').addEventListener('click', async () => {
    const id = template.id; ++photoVersion; photos.set(id, null); putTransform(); showPhotoState(); photoError.textContent = ''; draw(); saveInput();
    try { await stored('photos', id, 'delete'); } catch { if (template.id === id) photoError.textContent = 'تمت استعادة الأصل؛ تعذّر تحديث حفظ الصورة على الجهاز.'; }
  });
  document.getElementById('photo-reset-button').addEventListener('click', () => { putTransform(); draw(); saveInput(); });
  async function persistPhoto(id, photo) {
    try { await stored('photos', id, 'put', { file: photo.file, originalFile: photo.originalFile, removedBackground: !!photo.removedBackground }); }
    catch { if (template.id === id) photoError.textContent = 'الصورة جاهزة للجلسة الحالية؛ تعذّر حفظها على هذا الجهاز.'; }
  }
  document.getElementById('photo-remove-background').addEventListener('click', async () => {
    const photo = photos.get(template.id); if (!photo || photo.hasTransparency || processingPhotoId) return;
    const id = template.id, token = ++photoVersion; processingPhotoId = id; showPhotoState(); draw();
    try {
      const blob = await Portrait.removePersonBackground(photo.rawImage, message => {
        if (template.id === id && token === photoVersion) photoError.textContent = message;
      });
      const filename = `${photo.file.name.replace(/\.[^.]+$/, '')}-cutout.png`;
      const processed = await loadPhoto(new File([blob], filename, { type: 'image/png' }));
      if (template.id !== id || token !== photoVersion) return;
      processed.originalFile = photo.originalFile || photo.file; processed.removedBackground = true;
      photos.set(id, processed); form.elements.photoMode.value = 'cutout'; putTransform();
      photoError.textContent = ''; draw(); saveInput(); await persistPhoto(id, processed);
      toast('تم تفريغ صورة الشخص. راجع الحواف؛ يمكنك إلغاء التفريغ.');
    } catch (error) {
      if (template.id === id && token === photoVersion) photoError.textContent = error.message || 'تعذّر التفريغ. يمكنك استخدام وضع الدائرة.';
    } finally { processingPhotoId = null; showPhotoState(); draw(); }
  });
  document.getElementById('photo-undo-background').addEventListener('click', async () => {
    const photo = photos.get(template.id); if (!photo?.originalFile) return;
    const id = template.id, token = ++photoVersion;
    try {
      const restored = await loadPhoto(photo.originalFile);
      if (id !== template.id || token !== photoVersion) return;
      photos.set(id, restored); form.elements.photoMode.value = restored.hasTransparency ? 'cutout' : 'circle';
      putTransform(); photoError.textContent = ''; showPhotoState(); draw(); saveInput(); await persistPhoto(id, restored);
    } catch (error) { if (id === template.id) photoError.textContent = error.message || 'تعذّر استعادة الصورة.'; }
  });
  downloadButton.addEventListener('click', async () => {
    draw(); if (!result?.valid || exporting || processingPhotoId === template.id) return;
    const exported = result, id = template.id;
    exporting = true; downloadButton.disabled = true;
    const text = downloadButton.querySelector('span'); text.textContent = 'جارٍ تجهيز الصورة…';
    let exportCanvas = null;
    try {
      const dimensions = Engine.exportDimensions(template, state.quality);
      exportCanvas = document.createElement('canvas'); exportCanvas.width = dimensions.width; exportCanvas.height = dimensions.height;
      const exportResult = Engine.render(exportCanvas.getContext('2d'), readInput(), { images, template, titleMode: mode, photoImage: photos.get(template.id)?.image, photoTransform: transform(), ...settings(), renderScale: dimensions.scale });
      if (!exportResult.valid) throw new Error(exportResult.errors[0].message);
      const blob = await new Promise((resolve, reject) => exportCanvas.toBlob(output => output ? resolve(output) : reject(new Error('تعذّر إنشاء الصورة بهذه الدقة. جرّب الجودة العالية بدل القصوى.')), 'image/png'));
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `sahwa-${id}${exported.temporaryFont ? '-demo' : ''}-${dimensions.width}x${dimensions.height}-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast(exported.temporaryFont ? 'تم تنزيل التصميم بخط العنوان المؤقت.' : 'تم تنزيل التصميم بالحجم الأصلي.');
    } catch (error) { toast(error.message || 'تعذّر تنزيل الصورة. أعد المحاولة.'); }
    finally { if (exportCanvas) { exportCanvas.width = 1; exportCanvas.height = 1; } exporting = false; text.textContent = 'تنزيل التصميم PNG'; draw(); }
  });

  try {
    if (!ctx || !window.FontFace) throw new Error('هذا المتصفح لا يدعم توليد التصميم. استخدم إصدارًا حديثًا من Chrome أو Firefox أو Safari.');
    const faces = await Promise.all([
      ['SahwaBodyExtraLight', ASSETS.fonts.extraLight, '200'], ['SahwaBodyLight', ASSETS.fonts.light, '300'], ['SahwaBodyBold', ASSETS.fonts.bold, '700']
    ].map(async ([family, source, weight]) => { const face = new FontFace(family, `url(${source})`, { weight, style: 'normal' }); await face.load(); return face; }));
    faces.forEach(face => document.fonts.add(face));
    try { const saved = await stored('fonts', 'title', 'get'); if (saved?.buffer) await applyTitleFont(saved.buffer, false, saved.filename); } catch { /* The title font is optional. */ }
    ready = true; showFontState(); await selectTemplate(state.selected, false);
  } catch (error) {
    generalError.hidden = false; generalError.textContent = error.message || 'تعذّر تجهيز القالب. أعد تحميل الصفحة.';
    renderStatus.textContent = 'تعذّر تحميل القالب'; exportNote.textContent = 'التنزيل متوقف حتى يكتمل تحميل القالب.'; downloadButton.disabled = true;
  }
})();

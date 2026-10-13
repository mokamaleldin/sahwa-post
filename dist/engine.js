(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SahwaEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TEMPLATE = Object.freeze({
    id: 'sahwa-simple-v1', width: 1080, height: 1300, color: '#752026',
    title: { right: 781, width: 510, max: 136.69, min: 78, lineHeight: 147.9, baselines: [429.62, 577.52] },
    subtitle: { right: 781, width: 500, max: 31.58, min: 26, lineHeight: 47, baseline: 709.19 },
    information: { right: 737.9, width: 465, max: 31.58, min: 26, baselines: [862.33, 959.67, 1051.95], markerX: 714.2, markerY: [822.71, 920.75, 1015.65], markerSize: 54.88 }
  });
  const DEFAULTS = Object.freeze({
    title: 'العنوان\nالرئيسي', subtitle: 'كتابة جملة ثانوية فرعية لشرح العنوان',
    info1Label: '', info1Value: 'نقاط المعلومات',
    info2Label: '', info2Value: 'نقاط المعلومات',
    info3Label: '', info3Value: 'نقاط المعلومات'
  });
  const EXAMPLE = Object.freeze({
    title: 'لقاء\nصحوة', subtitle: 'مساحة نتعلم فيها ونترك أثرًا',
    info1Label: 'المكان', info1Value: 'مركز بلاد الشام',
    info2Label: 'الموعد', info2Value: 'السبت، الساعة 17:00',
    info3Label: 'التفاصيل', info3Value: 'في وصف المنشور'
  });
  const KEYS = Object.keys(DEFAULTS);
  function normalize(value) { return String(value ?? '').replace(/\r\n?/g, '\n').trim(); }
  function cleanInput(input) {
    return Object.fromEntries(KEYS.map(key => [key, normalize(input[key])]));
  }
  function isOriginalTitle(title) {
    return normalize(title).replace(/\s+/g, ' ') === 'العنوان الرئيسي';
  }
  function font(ctx, size, family, weight) { ctx.font = `${weight} ${size}px "${family}"`; }
  function width(ctx, text) {
    const m = ctx.measureText(text);
    const inkWidth = Number.isFinite(m.actualBoundingBoxLeft) && Number.isFinite(m.actualBoundingBoxRight)
      ? Math.abs(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) : 0;
    // Some non-browser Canvas backends return sentinel values for RTL ink bounds.
    // Keep valid overhang measurements, but fall back to the advance width for invalid bounds.
    const saneInkWidth = inkWidth <= m.width + TEMPLATE.width ? inkWidth : 0;
    return Math.max(m.width, saneInkWidth);
  }
  function wrap(ctx, text, maxWidth) {
    const result = [];
    for (const paragraph of normalize(text).split('\n')) {
      if (!paragraph.trim()) { result.push(''); continue; }
      let line = '';
      for (const word of paragraph.trim().split(/\s+/)) {
        if (width(ctx, word) > maxWidth + 0.5) return null;
        const candidate = line ? `${line} ${word}` : word;
        if (line && width(ctx, candidate) > maxWidth + 0.5) {
          result.push(line); line = word;
        } else line = candidate;
      }
      if (line) result.push(line);
    }
    return result;
  }
  function fit(ctx, text, spec, family, weight, maxLines) {
    for (let size = spec.max; size >= spec.min - 0.01; size -= 1) {
      font(ctx, size, family, weight);
      const lines = wrap(ctx, text, spec.width);
      if (lines && lines.length <= maxLines) return { size, lines, family, weight };
    }
    font(ctx, spec.min, family, weight);
    const lines = wrap(ctx, text, spec.width);
    if (lines && lines.length <= maxLines) return { size: spec.min, lines, family, weight };
    return null;
  }
  function drawText(ctx, layout, right, baselines) {
    font(ctx, layout.size, layout.family, layout.weight);
    layout.lines.forEach((line, i) => ctx.fillText(line, right, baselines[i]));
  }
  function render(ctx, rawInput, options) {
    const input = cleanInput(rawInput);
    const { images, titleMode = 'original' } = options;
    const errors = [];
    ctx.save();
    ctx.clearRect(0, 0, TEMPLATE.width, TEMPLATE.height);
    ctx.drawImage(images.background, 0, 0, TEMPLATE.width, TEMPLATE.height);
    ctx.fillStyle = TEMPLATE.color;
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.direction = 'rtl';
    if ('fontKerning' in ctx) ctx.fontKerning = 'normal';

    let titleSize = null;
    const original = isOriginalTitle(input.title) && titleMode !== 'custom';
    if (!input.title) errors.push({ field: 'title', message: 'اكتب العنوان الرئيسي.' });
    else if (original) ctx.drawImage(images.originalTitle, 0, 0, TEMPLATE.width, TEMPLATE.height);
    else {
      const family = titleMode === 'custom' ? 'SahwaTitle' : 'SahwaBodyBold';
      const fitted = fit(ctx, input.title, TEMPLATE.title, family, 700, 2);
      if (!fitted) errors.push({ field: 'title', message: 'العنوان لا يناسب مساحة القالب. اختصره أو وزّعه على سطرين أقصر.' });
      else {
        titleSize = fitted.size;
        const baselines = fitted.lines.length === 1 ? [503.57] : TEMPLATE.title.baselines;
        drawText(ctx, fitted, TEMPLATE.title.right, baselines);
      }
      if (titleMode === 'original') errors.push({ field: 'titleFont', message: 'ارفع خط Asal Arabic Bold لتصدير العنوان الجديد بنفس الخط، أو فعّل الخط المؤقت للتجربة.' });
    }

    if (input.subtitle) {
      const fitted = fit(ctx, input.subtitle, TEMPLATE.subtitle, 'SahwaBodyExtraLight', 200, 2);
      if (!fitted) errors.push({ field: 'subtitle', message: 'الجملة الثانوية أطول من مساحة القالب. اختصرها قليلًا.' });
      else {
        const baselines = fitted.lines.length === 1
          ? [TEMPLATE.subtitle.baseline]
          : [TEMPLATE.subtitle.baseline - 23.5, TEMPLATE.subtitle.baseline + 23.5];
        drawText(ctx, fitted, TEMPLATE.subtitle.right, baselines);
      }
    }
    let informationCount = 0;
    for (let i = 1; i <= 3; i++) {
      const label = input[`info${i}Label`];
      const value = input[`info${i}Value`];
      if (!value) {
        if (label) errors.push({ field: `info${i}Value`, message: `أضف قيمة المعلومة ${i} أو امسح عنوانها لإخفائها.` });
        continue;
      }
      const text = label ? `${label}: ${value}` : value;
      const fitted = fit(ctx, text, TEMPLATE.information, 'SahwaBodyLight', 300, 1);
      if (!fitted) { errors.push({ field: `info${i}Value`, message: `المعلومة ${i} أطول من المساحة المتاحة. اختصرها.` }); continue; }
      const y = TEMPLATE.information.markerY[i - 1];
      ctx.drawImage(images.badge, TEMPLATE.information.markerX, y, TEMPLATE.information.markerSize, TEMPLATE.information.markerSize);
      drawText(ctx, fitted, TEMPLATE.information.right, [TEMPLATE.information.baselines[i - 1]]);
      informationCount++;
    }
    ctx.restore();
    return { valid: errors.length === 0, errors, input, titleSize, originalTitle: original, informationCount, temporaryFont: titleMode === 'trial' && !original };
  }
  function parseFontNames(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 12) throw new Error('ملف الخط غير مكتمل.');
    const signature = view.getUint32(0);
    if (signature !== 0x00010000 && signature !== 0x4f54544f && signature !== 0x74727565) throw new Error('ارفع ملف خط بصيغة TTF أو OTF.');
    const count = view.getUint16(4);
    if (12 + count * 16 > view.byteLength) throw new Error('ملف الخط غير صالح.');
    for (let i = 0; i < count; i++) {
      const pos = 12 + i * 16;
      if (view.getUint32(pos) !== 0x6e616d65) continue;
      const start = view.getUint32(pos + 8), length = view.getUint32(pos + 12);
      if (start + length > view.byteLength || length < 6) throw new Error('بيانات الخط غير صالحة.');
      const namesCount = view.getUint16(start + 2), strings = start + view.getUint16(start + 4);
      const result = [];
      for (let n = 0; n < namesCount; n++) {
        const p = start + 6 + n * 12;
        if (p + 12 > start + length) break;
        const platform = view.getUint16(p), id = view.getUint16(p + 6);
        if (![1, 2, 4, 6, 16, 17].includes(id)) continue;
        const size = view.getUint16(p + 8), from = strings + view.getUint16(p + 10);
        if (from + size > start + length) continue;
        let text = '';
        if (platform === 0 || platform === 3) {
          for (let j = 0; j + 1 < size; j += 2) text += String.fromCharCode(view.getUint16(from + j));
        } else {
          for (let j = 0; j < size; j++) text += String.fromCharCode(view.getUint8(from + j));
        }
        result.push({ id, text });
      }
      return result;
    }
    throw new Error('لم أجد اسم الخط في الملف.');
  }
  function isOriginalFont(names) {
    return names.some(item => item.id === 6 && /^(?:itf)?asalarabic[-_ ]?bold$/i.test(item.text.replace(/^[A-Z]{6}\+/, '')));
  }
  return { TEMPLATE, DEFAULTS, EXAMPLE, KEYS, normalize, cleanInput, isOriginalTitle, wrap, fit, render, parseFontNames, isOriginalFont };
});

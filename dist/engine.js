(function (root, factory) {
  const joining = typeof module === 'object' && module.exports ? require('./arabic-joining.js') : root.SahwaArabicJoining;
  const api = factory(joining);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SahwaEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (joining) {
  'use strict';
  const TEMPLATE = Object.freeze({
    id: 'sahwa-simple-v1', width: 1080, height: 1300, color: '#752026',
    title: { right: 781, width: 510, max: 136.69, min: 78, lineHeight: 147.9, baselines: [429.62, 577.52] },
    subtitle: { right: 781, width: 500, max: 31.58, min: 26, lineHeight: 47, baseline: 709.19 },
    information: { right: 737.9, width: 465, max: 31.58, min: 26, baselines: [862.33, 959.67, 1051.95], markerX: 714.2, markerY: [822.71, 920.75, 1015.65], markerSize: 54.88 }
  });
  const DEFAULTS = Object.freeze({
    title: 'العنوان\nالرئيسي', subtitle: 'كتابة جملة ثانوية فرعية لشرح العنوان',
    speakerName: '',
    info1Label: '', info1Value: 'نقاط المعلومات',
    info2Label: '', info2Value: 'نقاط المعلومات',
    info3Label: '', info3Value: 'نقاط المعلومات'
  });
  const EXAMPLE = Object.freeze({
    title: 'لقاء\nصحوة', subtitle: 'مساحة نتعلم فيها ونترك أثرًا',
    speakerName: '',
    info1Label: 'المكان', info1Value: 'مركز بلاد الشام',
    info2Label: 'الموعد', info2Value: 'السبت، الساعة 17:00',
    info3Label: 'التفاصيل', info3Value: 'في وصف المنشور'
  });
  const KEYS = Object.keys(DEFAULTS);
  const BASIC_TEMPLATE = Object.freeze({
    id: TEMPLATE.id, name: 'القالب الأساسي', description: 'عنوان و٣ معلومات',
    width: TEMPLATE.width, height: TEMPLATE.height, color: TEMPLATE.color,
    fields: { subtitle: true, informationCount: 3, labels: true, speakerName: false, image: false },
    defaults: DEFAULTS, example: EXAMPLE, layout: TEMPLATE
  });
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
  function fixedFit(ctx, text, spec, family, weight, maxLines = 2) {
    font(ctx, spec.max, family, weight);
    const lines = wrap(ctx, text, spec.width);
    return lines && lines.length <= maxLines ? { size: spec.max, lines, family, weight } : null;
  }
  function kashidaSlots(text) {
    // Explicit stretching/join controls belong to the author; leave them intact.
    if (/[\u0640\u200c\u200d]/u.test(text)) return [];
    const letters = Array.from(text), slots = [];
    for (let i = 0; i < letters.length - 1; i++) {
      if (!joining.D.includes(letters[i])) continue;
      let next = i + 1;
      while (next < letters.length && /\p{Mark}/u.test(letters[next])) next++;
      const right = letters[next];
      if (!right || (!joining.D.includes(right) && !joining.R.includes(right))) continue;
      if (letters[i] === 'ل' && /[اأإآٱ]/u.test(right)) continue;
      slots.push({ index: next, priority: /[سشصض]/u.test(letters[i]) ? 0 : 1 });
    }
    return slots.sort((a, b) => a.priority - b.priority || b.index - a.index);
  }
  function stretchLine(ctx, text, targetWidth) {
    const letters = Array.from(text), slots = kashidaSlots(text);
    const originalWidth = width(ctx, text);
    const target = Math.min(targetWidth, originalWidth * 1.7);
    const counts = new Map();
    const compose = () => letters.map((letter, index) => 'ـ'.repeat(counts.get(index) || 0) + letter).join('');
    let stretched = text, count = 0, measured = originalWidth;
    for (let round = 0; round < 3 && count < 8; round++) {
      let advanced = false;
      for (const slot of slots) {
        const previous = counts.get(slot.index) || 0;
        if (previous >= 3 || count >= 8) continue;
        counts.set(slot.index, previous + 1);
        const candidate = compose(), candidateWidth = width(ctx, candidate);
        if (candidateWidth > target + 0.5 || candidateWidth <= measured + 0.1) {
          counts.set(slot.index, previous); continue;
        }
        stretched = candidate; measured = candidateWidth; count++; advanced = true;
      }
      if (!advanced) break;
    }
    return { text: stretched, count };
  }
  function layoutTitle(ctx, text, spec, family, enabled = true) {
    const fitted = fit(ctx, text, spec, family, 700, 2);
    if (!fitted) return null;
    font(ctx, fitted.size, family, 700);
    const stretched = fitted.lines.map(line => enabled ? stretchLine(ctx, line, spec.width * 0.94) : { text: line, count: 0 });
    return { ...fitted, lines: stretched.map(line => line.text), kashidaCount: stretched.reduce((sum, line) => sum + line.count, 0) };
  }
  function exportDimensions(template, scale = 3) {
    scale = Number(scale);
    if (![1, 2, 3].includes(scale)) throw new RangeError('اختر جودة التنزيل من القائمة.');
    return { width: template.width * scale, height: template.height * scale, scale };
  }
  function drawText(ctx, layout, right, baselines, align = 'right') {
    font(ctx, layout.size, layout.family, layout.weight);
    ctx.textAlign = align;
    layout.lines.forEach((line, i) => ctx.fillText(line, right, baselines[i]));
  }
  function sameText(a, b) { return normalize(a).replace(/\s+/g, ' ') === normalize(b).replace(/\s+/g, ' '); }
  const photoBuffers = new WeakMap();
  function photoGeometry(image, frame, transform = {}) {
    const zoom = Math.max(1, Math.min(3, Number(transform.zoom) || 1));
    const position = key => Math.max(-100, Math.min(100, Number(transform[key]) || 0)) / 100;
    const scale = (frame.fit === 'contain' ? Math.min : Math.max)(frame.width / image.width, frame.height / image.height) * zoom;
    const width = image.width * scale, height = image.height * scale;
    return {
      x: frame.x + (frame.width - width) / 2 + Math.abs((width - frame.width) / 2) * position('x'),
      y: frame.y + (frame.height - height) / 2 + Math.abs((height - frame.height) / 2) * position('y'),
      width, height
    };
  }
  function drawPhoto(ctx, images, template, options) {
    const { photoImage, photoTransform, createCanvas, photoMode = 'circle', grayscale = false, renderScale = 1 } = options;
    if (!photoImage) {
      if (images.defaultPhoto) ctx.drawImage(images.defaultPhoto, 0, 0, template.width, template.height);
      return;
    }
    if (images.photoBackdrop) ctx.drawImage(images.photoBackdrop, 0, 0, template.width, template.height);
    const frame = template.layout.photoCircle && photoMode !== 'cutout' ? template.layout.photoCircle : template.layout.photo;
    const masked = frame.shape === 'mask' && !!images.photoMask;
    const geometry = photoGeometry(photoImage, frame, photoTransform);
    let buffer = photoBuffers.get(ctx);
    if (!buffer || buffer.width !== template.width * renderScale || buffer.height !== template.height * renderScale) {
      buffer = createCanvas ? createCanvas(template.width * renderScale, template.height * renderScale) : document.createElement('canvas');
      buffer.width = template.width * renderScale; buffer.height = template.height * renderScale;
      photoBuffers.set(ctx, buffer);
    }
    const photoContext = buffer.getContext('2d');
    photoContext.clearRect(0, 0, buffer.width, buffer.height);
    photoContext.save();
    photoContext.scale(renderScale, renderScale);
    if (!masked) {
      photoContext.beginPath();
      if (frame.shape === 'ellipse') photoContext.ellipse(frame.x + frame.width / 2, frame.y + frame.height / 2, frame.width / 2, frame.height / 2, 0, 0, Math.PI * 2);
      else photoContext.rect(frame.x, frame.y, frame.width, frame.height);
      photoContext.clip();
    }
    if (grayscale) photoContext.filter = 'grayscale(1)';
    photoContext.drawImage(photoImage, geometry.x, geometry.y, geometry.width, geometry.height);
    photoContext.filter = 'none';
    if (masked) {
      photoContext.globalCompositeOperation = 'destination-in';
      photoContext.drawImage(images.photoMask, 0, 0, template.width, template.height);
    }
    photoContext.restore();
    ctx.drawImage(buffer, 0, 0, template.width, template.height);
  }
  function render(ctx, rawInput, options) {
    const input = cleanInput(rawInput);
    const { images, titleMode = 'original', template = BASIC_TEMPLATE, infoEnabled = [true, true, true], titleKashida = true, renderScale = 1 } = options;
    const layout = template.layout;
    const fields = template.fields;
    const errors = [];
    ctx.save();
    ctx.scale(renderScale, renderScale);
    ctx.clearRect(0, 0, template.width, template.height);
    ctx.drawImage(images.background, 0, 0, template.width, template.height);
    if (fields.image) {
      if (!options.photoImage && !images.defaultPhoto) errors.push({ field: 'photo', message: 'ارفع صورة لهذا القالب.' });
      drawPhoto(ctx, images, template, options);
    }
    if (images.foreground) ctx.drawImage(images.foreground, 0, 0, template.width, template.height);
    ctx.fillStyle = template.color || TEMPLATE.color;
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.direction = 'rtl';
    if ('fontKerning' in ctx) ctx.fontKerning = 'normal';

    let titleSize = null, titleLines = [], kashidaCount = 0, subtitleSize = null, subtitleLines = [];
    const original = sameText(input.title, template.defaults.title) && input.title.split('\n').length <= 2 && !!images.originalTitle && titleMode !== 'custom';
    if (!input.title) errors.push({ field: 'title', message: 'اكتب العنوان الرئيسي.' });
    else if (original) ctx.drawImage(images.originalTitle, 0, 0, template.width, template.height);
    else {
      const family = titleMode === 'custom' ? 'SahwaTitle' : 'SahwaBodyBold';
      const fitted = layoutTitle(ctx, input.title, layout.title, family, titleKashida);
      if (!fitted) errors.push({ field: 'title', message: 'العنوان لا يناسب مساحة القالب. اختصره أو وزّعه على سطرين أقصر.' });
      else {
        titleSize = fitted.size;
        titleLines = fitted.lines; kashidaCount = fitted.kashidaCount;
        const baselines = fitted.lines.length === 1 ? [layout.title.singleBaseline ?? (layout.title.baselines[0] + layout.title.baselines[1]) / 2] : layout.title.baselines;
        drawText(ctx, fitted, layout.title.right, baselines, layout.title.align);
      }
      if (titleMode === 'original') errors.push({ field: 'titleFont', message: 'ارفع خط Asal Arabic Bold لتصدير العنوان الجديد بنفس الخط، أو فعّل الخط المؤقت للتجربة.' });
    }

    if (fields.subtitle && input.subtitle && images.originalSubtitle && input.subtitle === normalize(template.defaults.subtitle)) {
      ctx.drawImage(images.originalSubtitle, 0, 0, template.width, template.height);
    } else if (fields.subtitle && input.subtitle) {
      const fitted = fixedFit(ctx, input.subtitle, layout.subtitle, 'SahwaBodyExtraLight', 200, 2);
      if (!fitted) errors.push({ field: 'subtitle', message: 'الجملة الثانوية تتجاوز سطرين بحجمها الطبيعي. اختصرها أو اختر موضع السطر الثاني بـ Enter.' });
      else {
        subtitleSize = fitted.size; subtitleLines = fitted.lines;
        const lineHeight = layout.subtitle.lineHeight || layout.subtitle.max * 1.45;
        const baselines = fitted.lines.length === 1
          ? [layout.subtitle.baseline]
          : [layout.subtitle.baseline - lineHeight / 2, layout.subtitle.baseline + lineHeight / 2];
        drawText(ctx, fitted, layout.subtitle.right, baselines, layout.subtitle.align);
      }
    }
    if (fields.speakerName && input.speakerName) {
      if (images.originalSpeaker && sameText(input.speakerName, template.defaults.speakerName)) ctx.drawImage(images.originalSpeaker, 0, 0, template.width, template.height);
      else {
        const spec = layout.speaker || layout.speakerName;
        const fitted = fit(ctx, input.speakerName, spec, 'SahwaBodyLight', 300, 1);
        if (!fitted) errors.push({ field: 'speakerName', message: 'اسم الأستاذ أطول من المساحة المتاحة. اختصره.' });
        else drawText(ctx, fitted, spec.right, [spec.baseline], spec.align);
      }
    }
    let informationCount = 0;
    for (let i = 1; i <= fields.informationCount; i++) {
      if (infoEnabled[i - 1] === false) continue;
      const label = fields.labels ? input[`info${i}Label`] : '';
      const value = input[`info${i}Value`];
      if (!value) {
        if (label) errors.push({ field: `info${i}Value`, message: `أضف قيمة المعلومة ${i} أو امسح عنوانها لإخفائها.` });
        continue;
      }
      const text = label ? `${label}: ${value}` : value;
      const originalInformation = !label && sameText(value, template.defaults[`info${i}Value`]) && images[`originalInformation${i}`];
      const fitted = originalInformation ? null : fit(ctx, text, layout.information, 'SahwaBodyLight', 300, 1);
      if (!fitted && !originalInformation) { errors.push({ field: `info${i}Value`, message: `المعلومة ${i} أطول من المساحة المتاحة. اختصرها.` }); continue; }
      const marker = layout.markers?.[i - 1] || { x: layout.information.markerX, y: layout.information.markerY[i - 1], width: layout.information.markerSize, height: layout.information.markerSize };
      const badge = images[`marker${i}`] || images.badge;
      if (badge) ctx.drawImage(badge, marker.x, marker.y, marker.width, marker.height);
      if (originalInformation) ctx.drawImage(originalInformation, 0, 0, template.width, template.height);
      else drawText(ctx, fitted, layout.information.right, [layout.information.baselines[i - 1]], layout.information.align);
      informationCount++;
    }
    ctx.restore();
    return { valid: errors.length === 0, errors, input, titleSize, titleLines, kashidaCount, subtitleSize, subtitleLines, originalTitle: original, informationCount, temporaryFont: titleMode === 'trial' && !original, templateId: template.id, customPhoto: !!options.photoImage && fields.image };
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
  return { TEMPLATE, BASIC_TEMPLATE, DEFAULTS, EXAMPLE, KEYS, normalize, cleanInput, isOriginalTitle, wrap, fit, fixedFit, kashidaSlots, stretchLine, layoutTitle, exportDimensions, photoGeometry, render, parseFontNames, isOriginalFont };
});

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SahwaPortrait = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs';
  const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';
  let segmenterPromise = null;
  function canvas(width, height, createCanvas) {
    const output = createCanvas ? createCanvas(width, height) : document.createElement('canvas');
    output.width = width; output.height = height; return output;
  }
  function alphaBounds(data, width, height) {
    let left = width, top = height, right = -1, bottom = -1, transparent = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha < 240) transparent++;
      if (alpha <= 8) continue;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    if (right < 0) return null;
    return { left, top, right: right + 1, bottom: bottom + 1, hasTransparency: transparent > width * height * 0.001 };
  }
  function trimPhoto(image, createCanvas) {
    const ratio = Math.min(1, 512 / Math.max(image.width, image.height));
    const sample = canvas(Math.max(1, Math.round(image.width * ratio)), Math.max(1, Math.round(image.height * ratio)), createCanvas);
    const ctx = sample.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, sample.width, sample.height);
    const bounds = alphaBounds(ctx.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height);
    if (!bounds) throw new Error('الصورة شفافة بالكامل. اختر صورة يظهر فيها محتوى.');
    if (!bounds.hasTransparency) return { image, hasTransparency: false };
    // Leave a small margin so antialiasing and hair at the alpha boundary remain.
    const left = Math.max(0, Math.floor((bounds.left - 2) / ratio));
    const top = Math.max(0, Math.floor((bounds.top - 2) / ratio));
    const right = Math.min(image.width, Math.ceil((bounds.right + 2) / ratio));
    const bottom = Math.min(image.height, Math.ceil((bounds.bottom + 2) / ratio));
    const width = right - left, height = bottom - top, scale = Math.min(1, 3000 / Math.max(width, height));
    const cropped = canvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), createCanvas);
    cropped.getContext('2d').drawImage(image, left, top, width, height, 0, 0, cropped.width, cropped.height);
    return { image: cropped, hasTransparency: true };
  }
  function confidenceAlpha(values) {
    const alpha = new Uint8ClampedArray(values.length);
    for (let i = 0; i < values.length; i++) {
      const value = Number.isFinite(values[i]) ? values[i] : 0;
      const normalized = Math.max(0, Math.min(1, (value - 0.15) / 0.75));
      alpha[i] = Math.round(normalized * normalized * (3 - 2 * normalized) * 255);
    }
    return alpha;
  }
  async function segmenter(onStatus) {
    if (!segmenterPromise) {
      onStatus('جارٍ تحميل أداة التفريغ لأول مرة… تحتاج إلى الإنترنت.');
      segmenterPromise = (async () => {
        const { FilesetResolver, ImageSegmenter } = await import(VISION_URL);
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        return ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false
        });
      })();
      segmenterPromise.catch(() => { segmenterPromise = null; });
    }
    return segmenterPromise;
  }
  async function removePersonBackground(image, onStatus = () => {}) {
    if (!window.WebAssembly) throw new Error('التفريغ غير مدعوم في هذا المتصفح. ارفع صورة PNG مفرغة أو استخدم وضع الدائرة.');
    let tool;
    try { tool = await segmenter(onStatus); }
    catch { throw new Error('تعذّر تحميل أداة التفريغ. تحقق من الإنترنت أو ارفع صورة PNG مفرغة.'); }
    const ratio = Math.min(1, 2560 / Math.max(image.width, image.height));
    const picture = canvas(Math.max(1, Math.round(image.width * ratio)), Math.max(1, Math.round(image.height * ratio)));
    const ctx = picture.getContext('2d'); ctx.drawImage(image, 0, 0, picture.width, picture.height);
    onStatus('جارٍ تفريغ صورة الشخص على جهازك…');
    await new Promise(resolve => requestAnimationFrame(resolve));
    const result = tool.segment(picture);
    try {
      // This pinned selfie model has one output channel: foreground/person.
      const mask = result.confidenceMasks?.[0];
      if (!mask) throw new Error('تعذّر التعرف على الشخص. استخدم وضع الدائرة لهذه الصورة.');
      const confidence = mask.getAsFloat32Array();
      let personPixels = 0;
      for (const value of confidence) if (value > 0.6) personPixels++;
      if (personPixels < confidence.length * 0.005) throw new Error('لم أتعرف على شخص واضح. استخدم وضع الدائرة للصور العامة.');
      const alpha = confidenceAlpha(confidence), matte = canvas(mask.width, mask.height);
      const matteContext = matte.getContext('2d'), pixels = matteContext.createImageData(mask.width, mask.height);
      for (let i = 0; i < alpha.length; i++) { pixels.data[i * 4] = 255; pixels.data[i * 4 + 1] = 255; pixels.data[i * 4 + 2] = 255; pixels.data[i * 4 + 3] = alpha[i]; }
      matteContext.putImageData(pixels, 0, 0);
      ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(matte, 0, 0, picture.width, picture.height); ctx.restore();
      return new Promise((resolve, reject) => picture.toBlob(blob => blob ? resolve(blob) : reject(new Error('تعذّر تجهيز الصورة المفرغة.')), 'image/png'));
    } finally {
      for (const mask of result.confidenceMasks || []) mask.close();
      result.categoryMask?.close();
    }
  }
  return { alphaBounds, trimPhoto, confidenceAlpha, removePersonBackground };
});

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const runtimeRoot = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const runtimeRequire = runtimeRoot ? createRequire(path.join(runtimeRoot, '..', 'package.json')) : require;
const { createCanvas, loadImage, GlobalFonts } = runtimeRequire('@napi-rs/canvas');
const Engine = require('../dist/engine.js');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tmp', 'verification');
fs.mkdirSync(output, { recursive: true });
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'dist/template-assets.js'), 'utf8'), context);
const assets = context.window.SAHWA_ASSETS;
for (const [file, family] of [
  ['IBMPlexSansArabic-ExtraLight.ttf', 'SahwaBodyExtraLight'],
  ['IBMPlexSansArabic-Light.ttf', 'SahwaBodyLight'],
  ['IBMPlexSansArabic-Bold.ttf', 'SahwaBodyBold']
]) assert.ok(GlobalFonts.registerFromPath(path.join(root, 'dist/assets', file), family), family);
let passed = 0;
function check(label, action) { action(); passed++; process.stdout.write(`PASS ${label}\n`); }
function equalPixels(a, b) { return Buffer.from(a).equals(Buffer.from(b)); }
(async function () {
  const images = Object.fromEntries(await Promise.all(['background', 'originalTitle', 'badge'].map(async key => [key, await loadImage(assets[key])])));
  const canvas = createCanvas(1080, 1300), ctx = canvas.getContext('2d');
  const fixedCanvas = createCanvas(1080, 1300), fixedContext = fixedCanvas.getContext('2d');
  fixedContext.drawImage(images.background, 0, 0, 1080, 1300);
  function render(data, titleMode = 'original') { return Engine.render(ctx, data, { images, titleMode }); }
  let result = render(Engine.DEFAULTS);
  check('original headline remains outlines; all three information slots render', () => {
    assert.equal(result.valid, true); assert.equal(result.originalTitle, true); assert.equal(result.informationCount, 3); assert.equal(result.temporaryFont, false);
    assert.notDeepEqual(ctx.getImageData(742, 830, 20, 18).data, fixedContext.getImageData(742, 830, 20, 18).data, 'gold marker must actually render');
  });
  fs.writeFileSync(path.join(output, 'original-template.png'), canvas.toBuffer('image/png'));
  result = render(Engine.EXAMPLE);
  check('new title requires original font or explicit temporary mode', () => {
    assert.equal(result.valid, false); assert.ok(result.errors.some(error => error.field === 'titleFont'));
  });
  result = render(Engine.EXAMPLE, 'trial');
  check('explicit temporary mode renders a complete export', () => {
    assert.equal(result.valid, true); assert.equal(result.temporaryFont, true); assert.equal(result.informationCount, 3); assert.ok(result.titleSize >= 78);
  });
  const png = canvas.toBuffer('image/png'); fs.writeFileSync(path.join(output, 'example-trial.png'), png);
  const reopened = await loadImage(png);
  check('exported PNG has the original 1080 by 1300 dimensions', () => { assert.equal(reopened.width, 1080); assert.equal(reopened.height, 1300); });
  const optional = { ...Engine.EXAMPLE, subtitle: '', info2Label: '', info2Value: '', info3Label: '', info3Value: '' };
  result = render(optional, 'trial');
  check('empty optional slots hide both text and markers', () => {
    assert.equal(result.valid, true); assert.equal(result.informationCount, 1);
    assert.deepEqual(ctx.getImageData(710, 916, 63, 65).data, fixedContext.getImageData(710, 916, 63, 65).data);
    assert.deepEqual(ctx.getImageData(710, 1010, 63, 65).data, fixedContext.getImageData(710, 1010, 63, 65).data);
  });
  fs.writeFileSync(path.join(output, 'one-information.png'), canvas.toBuffer('image/png'));
  result = render({ ...Engine.EXAMPLE, title: '' }, 'trial');
  check('empty required title prevents export', () => { assert.equal(result.valid, false); assert.ok(result.errors.some(error => error.field === 'title')); });
  result = render({ ...Engine.EXAMPLE, title: 'عنوان\nثاني\nثالث' }, 'trial');
  check('a third title line prevents export instead of clipping', () => { assert.equal(result.valid, false); assert.ok(result.errors.some(error => error.field === 'title')); });
  result = render({ ...Engine.EXAMPLE, title: 'معرفة'.repeat(50) }, 'trial');
  check('an oversized title prevents export instead of stretching', () => { assert.equal(result.valid, false); assert.ok(result.errors.some(error => error.field === 'title')); });
  result = render({ ...Engine.EXAMPLE, info2Label: 'التاريخ', info2Value: '' }, 'trial');
  check('a label without its value reports the relevant field', () => { assert.equal(result.valid, false); assert.ok(result.errors.some(error => error.field === 'info2Value')); });
  result = render({ ...Engine.EXAMPLE, subtitle: 'هذه الجملة طويلة '.repeat(30) }, 'trial');
  check('oversized subtitle prevents export', () => { assert.equal(result.valid, false); assert.ok(result.errors.some(error => error.field === 'subtitle')); });
  result = render({ ...Engine.EXAMPLE, info3Value: 'التفاصيل '.repeat(40) }, 'trial');
  check('oversized information prevents export', () => { assert.equal(result.valid, false); assert.ok(result.errors.some(error => error.field === 'info3Value')); });
  result = render({ ...Engine.EXAMPLE, info2Label: 'التاريخ', info2Value: '24/10/2026 — 17:00', info3Label: '', info3Value: '' }, 'trial');
  check('mixed Arabic text, dates, and numbers fit the information slot', () => { assert.equal(result.valid, true); assert.equal(result.informationCount, 2); });
  fs.writeFileSync(path.join(output, 'mixed-dates.png'), canvas.toBuffer('image/png'));
  const fontBytes = fs.readFileSync(path.join(root, 'dist/assets/IBMPlexSansArabic-Bold.ttf'));
  const fontBuffer = fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength);
  const names = Engine.parseFontNames(fontBuffer);
  check('font parser reads PostScript names from a real font', () => { assert.ok(names.some(name => name.id === 6 && name.text === 'IBMPlexSansArabic-Bold')); });
  check('a different font cannot be accepted as Asal Arabic Bold', () => { assert.equal(Engine.isOriginalFont(names), false); assert.equal(Engine.isOriginalFont([{ id: 6, text: 'itfAsalArabic-Bold' }]), true); });
  check('invalid font files fail cleanly', () => { assert.throws(() => Engine.parseFontNames(new ArrayBuffer(3))); assert.throws(() => Engine.parseFontNames(new ArrayBuffer(20))); });
  const core = render(Engine.DEFAULTS);
  check('changing text does not alter fixed artwork at the upper-left logo', () => {
    const fixed = createCanvas(1080, 1300); fixed.getContext('2d').drawImage(images.background, 0, 0, 1080, 1300);
    const originalPatch = fixed.getContext('2d').getImageData(90, 80, 110, 130).data;
    const exportedPatch = ctx.getImageData(90, 80, 110, 130).data;
    assert.deepEqual(exportedPatch, originalPatch); assert.equal(core.valid, true);
  });
  check('both Photoshop templates are bundled with separate field definitions', () => {
    assert.equal(assets.templates.length, 2);
    assert.equal(assets.templates[0].fields.informationCount, 3); assert.equal(assets.templates[0].fields.speakerName, true);
    assert.equal(assets.templates[1].fields.informationCount, 0); assert.equal(assets.templates[1].fields.speakerName, false);
    assert.ok(assets.templates.every(template => template.thumbnail.startsWith('data:image/png;base64,')));
  });
  const replacement = createCanvas(600, 800), replacementContext = replacement.getContext('2d');
  const gradient = replacementContext.createLinearGradient(0, 0, 600, 800);
  gradient.addColorStop(0, '#227a58'); gradient.addColorStop(1, '#eec079');
  replacementContext.fillStyle = gradient; replacementContext.fillRect(0, 0, 600, 800);
  replacementContext.fillStyle = '#385772'; replacementContext.fillRect(250, 0, 100, 800);
  for (const template of assets.templates) {
    const templateImages = Object.fromEntries(await Promise.all(Object.entries(template.assets).map(async ([key, uri]) => [key, await loadImage(uri)])));
    const options = { images: templateImages, template, titleMode: 'trial', createCanvas };
    function renderTemplate(input = template.defaults, additions = {}) { return Engine.render(ctx, input, { ...options, ...additions }); }
    result = renderTemplate();
    const originalPixels = ctx.getImageData(0, 0, 1080, 1300).data.slice();
    check(`${template.id}: default texts, image, and original headline export`, () => {
      assert.equal(result.valid, true); assert.equal(result.originalTitle, true); assert.equal(result.informationCount, template.fields.informationCount);
      assert.equal(result.customPhoto, false);
    });
    fs.writeFileSync(path.join(output, `${template.id}-original.png`), canvas.toBuffer('image/png'));
    // The first image asset is fixed artwork; PSB3's logo/fade lives in foreground.
    const fixed = createCanvas(1080, 1300), fixedCtx = fixed.getContext('2d');
    fixedCtx.drawImage(templateImages.background, 0, 0);
    if (templateImages.defaultPhoto) fixedCtx.drawImage(templateImages.defaultPhoto, 0, 0);
    if (templateImages.foreground) fixedCtx.drawImage(templateImages.foreground, 0, 0);
    result = renderTemplate(template.example);
    check(`${template.id}: edited text uses the temporary font without moving the logo`, () => {
      assert.equal(result.valid, true); assert.equal(result.temporaryFont, true);
      assert.ok(equalPixels(ctx.getImageData(90, 65, 180, 110).data, fixedCtx.getImageData(90, 65, 180, 110).data));
    });
    fs.writeFileSync(path.join(output, `${template.id}-example.png`), canvas.toBuffer('image/png'));
    result = renderTemplate(template.example, { titleMode: 'original' });
    check(`${template.id}: exact font mode still requires the deferred title font`, () => {
      assert.equal(result.valid, false); assert.ok(result.errors.some(error => error.field === 'titleFont'));
    });
    result = renderTemplate({ ...template.defaults, title: 'عنوان\nثان\nثالث' });
    check(`${template.id}: title overflow cannot be exported`, () => {
      assert.equal(result.valid, false); assert.ok(result.errors.some(error => error.field === 'title'));
    });
    result = renderTemplate({ ...template.defaults, subtitle: 'سطر أول\nسطر ثان' });
    check(`${template.id}: single-line subtitle cannot overlap the other fields`, () => {
      assert.equal(result.valid, false); assert.ok(result.errors.some(error => error.field === 'subtitle'));
    });
    result = renderTemplate(template.example, { photoImage: replacement, photoTransform: { zoom: 1.5, x: 30, y: -15 } });
    check(`${template.id}: a replacement photo renders through the original frame or fade`, () => {
      assert.equal(result.valid, true); assert.equal(result.customPhoto, true);
      assert.equal(equalPixels(ctx.getImageData(90, 830, 200, 160).data, fixedCtx.getImageData(90, 830, 200, 160).data), false);
      assert.ok(equalPixels(ctx.getImageData(90, 65, 180, 110).data, fixedCtx.getImageData(90, 65, 180, 110).data));
    });
    fs.writeFileSync(path.join(output, `${template.id}-replacement.png`), canvas.toBuffer('image/png'));
    const beforeTransform = ctx.getImageData(0, 0, 1080, 1300).data.slice();
    renderTemplate(template.example, { photoImage: replacement, photoTransform: { zoom: 2.1, x: -80, y: 75 } });
    check(`${template.id}: zoom and movement actually change the cropped picture`, () => { assert.equal(equalPixels(ctx.getImageData(0, 0, 1080, 1300).data, beforeTransform), false); });
    result = renderTemplate();
    check(`${template.id}: restoring the original photo restores its exact export`, () => {
      assert.equal(result.valid, true); assert.equal(result.customPhoto, false); assert.ok(equalPixels(ctx.getImageData(0, 0, 1080, 1300).data, originalPixels));
    });
    if (template.id === 'psb2') {
      result = renderTemplate({ ...template.defaults, info2Value: '', info3Value: '', info2Label: 'ignored hidden label', info3Label: 'ignored hidden label' });
      check('psb2: empty information removes its original marker and text', () => {
        assert.equal(result.valid, true); assert.equal(result.informationCount, 1);
        assert.deepEqual(ctx.getImageData(914, 861, 44, 44).data, fixedCtx.getImageData(914, 861, 44, 44).data);
        assert.deepEqual(ctx.getImageData(724, 943, 234, 37).data, fixedCtx.getImageData(724, 943, 234, 37).data);
      });
      result = renderTemplate({ ...template.defaults, speakerName: 'اسم طويل '.repeat(40) });
      check('psb2: lecturer name overflow is reported', () => { assert.equal(result.valid, false); assert.ok(result.errors.some(error => error.field === 'speakerName')); });
    } else {
      result = renderTemplate({ ...template.defaults, speakerName: 'طويل '.repeat(100), info1Value: 'طويل '.repeat(100), info1Label: 'hidden' });
      check('psb3: hidden lecturer and information fields cannot affect export', () => {
        assert.equal(result.valid, true); assert.equal(result.informationCount, 0); assert.ok(equalPixels(ctx.getImageData(0, 0, 1080, 1300).data, originalPixels));
      });
      check('psb3: edited text is anchored at the center of the original title area', () => {
        assert.equal(template.layout.title.right, 539); assert.equal(template.layout.subtitle.right, 539.5);
      });
    }
  }
  check('cover photo bounds stay inside the frame when panned to either edge', () => {
    const frame = { x: 0, y: 181, width: 1080, height: 1119, fit: 'cover' };
    for (const value of [-100, 100]) {
      const box = Engine.photoGeometry({ width: 2000, height: 700 }, frame, { zoom: 2, x: value, y: value });
      assert.ok(box.x <= frame.x + 0.01 && box.y <= frame.y + 0.01);
      assert.ok(box.x + box.width >= frame.x + frame.width - 0.01 && box.y + box.height >= frame.y + frame.height - 0.01);
    }
  });
  process.stdout.write(JSON.stringify({ passed, templates: 3, pngs: fs.readdirSync(output).filter(filename => filename.endsWith('.png')), browser_tested: false }) + '\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });

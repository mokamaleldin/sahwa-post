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
  process.stdout.write(JSON.stringify({ passed, pngs: ['original-template.png', 'example-trial.png', 'one-information.png', 'mixed-dates.png'], browser_tested: false }) + '\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });

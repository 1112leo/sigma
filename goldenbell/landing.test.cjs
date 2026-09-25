const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('event page uses the agreed date, tentative hours and benefits', () => {
  assert.match(html, /datetime="2026-10-30"/);
  assert.match(html, /16:00–18:00 예정/);
  assert.match(html, /이삭토스트/);
  assert.match(html, /문화상품권/);
  assert.match(html, /상품 금액과 시상 기준.*추후 안내/);
  assert.equal(new Date('2026-10-30T12:00:00+09:00').getUTCDay(), 5);
});

test('registration stays disabled; the only script is decorative scroll motion', () => {
  const form = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/)[0];
  assert.match(form, /aria-describedby="form-notice"/);
  assert.match(form, /<fieldset disabled>[\s\S]*<\/fieldset>/);
  assert.match(form, /<button[^>]*type="button" disabled/);
  assert.doesNotMatch(form, /\b(?:action|name|formaction)\s*=/);
  assert.doesNotMatch(form, /<script\b|\bon\w+\s*=/i);
  assert.deepEqual([...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match => match[1]), ['reveal.js?v=20260925-readable3']);
  assert.match(html, /지금은 입력하거나 접수할 수 없어요/);
});

test('all internal anchors and asset references resolve; operator link is retained', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), id);
  for (const [, url] of html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)) {
    const file = url.split('?')[0];
    if (file.startsWith('/')) continue;
    assert.ok(fs.existsSync(path.join(__dirname, file)), file);
  }
  assert.match(html, /id="temporary-run-link" href="\/goldenbell\/run\/"/);
  assert.ok(fs.existsSync(path.join(__dirname, 'run/index.html')));
});

test('page has labeled inputs, heading structure and reduced-motion support', () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /<label for="applicant-name">/);
  assert.match(html, /<label for="applicant-number">/);
  assert.match(html, /<img[^>]*alt="[^"]+"/);
  assert.match(fs.readFileSync(path.join(__dirname, 'goldenbell.css'), 'utf8'), /prefers-reduced-motion:reduce/);
});

test('refined landing keeps venue consistent and removes emoji-dependent decoration', () => {
  assert.doesNotMatch(html, /✳|small-star|THE NEXT BELL|장소<\/dt><dd>추후/);
  assert.match(html, /<dt>장소<\/dt>\s*<dd>체육관<\/dd>/);
  assert.match(html, /체육관에서 진행합니다/);
  assert.match(html, /간식과 상품은 아직 확정 전/);
  assert.match(html, /구글폼으로 받을 예정/);
});

test('DNF BitBit is packaged locally with its license and decorations are noninteractive', () => {
  const css = fs.readFileSync(path.join(__dirname, 'goldenbell.css'), 'utf8');
  assert.match(css, /url\('fonts\/DNFBitBit-Regular\.woff2'\)/);
  assert.doesNotMatch(css, /cdn\.df\.nexon|NanumSquare|AppleMyungjo/);
  assert.equal(fs.readFileSync(path.join(__dirname,'fonts/DNFBitBit-Regular.woff2')).subarray(0,4).toString(),'wOF2');
  assert.match(fs.readFileSync(path.join(__dirname,'fonts/DNFBitBit-LICENSE.txt'),'utf8'),/NEOPLE/);
  assert.match(html, /class="hero-glints" aria-hidden="true"/);
  assert.match(css, /\.hero-glints[^}]*pointer-events: none/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

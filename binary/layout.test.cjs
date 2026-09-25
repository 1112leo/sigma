const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('principle and experience introductions share the compact card layout', () => {
  for (const page of ['principle.html', 'experience.html']) {
    const html = fs.readFileSync(path.join(__dirname, page), 'utf8');
    assert.match(html, /<body class="sub-page(?: principle-page)?">/);
    assert.match(html, /class="sub-hero"/);
    assert.match(html, /typography\.css\?v=20260925-layout\d+/);
  }
  const css = fs.readFileSync(path.join(__dirname, 'typography.css'), 'utf8');
  assert.match(css, /\.sub-page \.sub-hero-inner\s*\{\s*width: min\(960px/);
  assert.match(css, /\.sub-page \.sub-hero-inner::after\s*\{\s*content: none/);
});

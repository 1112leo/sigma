const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('all binary pages use the same brand link to the site homepage', () => {
  const pages = ['index.html', 'principle.html', 'test.html', 'experience.html'];
  const links = pages.map(page => {
    const html = fs.readFileSync(path.join(__dirname, page), 'utf8');
    const link = html.match(/<a class="brand"[^>]*>.*?<\/a>/s)?.[0];
    assert.ok(link, `${page} has a brand link`);
    return link;
  });
  for (const link of links) {
    assert.equal(link, links[0]);
    assert.match(link, /href="\/"/);
    assert.match(link, /<b class="logo-mark">Σ<\/b>/);
  }
});

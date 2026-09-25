const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('home presents both activities equally as a club portfolio', () => {
  assert.equal((html.match(/class="project-card"/g) || []).length, 2);
  assert.match(html, /class="project-card" href="\/binary\/"/);
  assert.match(html, /class="project-card" href="\/goldenbell\/"/);
  assert.match(html, /<h2 id="projects-title">활동<\/h2>/);
  assert.doesNotMatch(html, /골든벨 참가 신청|event-meta|binary-steps|16:00/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
});

test('home assets exist and activity cards stack on narrow screens', () => {
  assert.ok(fs.existsSync(path.join(__dirname, 'goldenbell/hero-bell.png')));
  assert.ok(fs.existsSync(path.join(__dirname, 'goldenbell/fonts/DNFBitBit-Regular.woff2')));
  assert.match(html, /@media \(max-width: 640px\)[\s\S]*?\.projects\s*\{\s*grid-template-columns: 1fr/);
});

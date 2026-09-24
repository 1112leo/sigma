const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
test('production worker smoke: routes, all nested modules/fonts/MIME and local-only dependency graph', async () => {
  execFileSync(process.execPath, [`${__dirname}/build.mjs`]);
  const { default: worker } = await import(`./dist/server/index.js?test=${Date.now()}`);
  const fetchAsset = name => worker.fetch(new Request(`https://sigma.example/goldenbell/run/${name}`));
  const files = ['index.html','app.js','runtime.js','math.js','preparation.js','styles.css','favicon.svg','og.png','vendor/katex/LICENSE','vendor/katex/katex.min.js','vendor/katex/katex.min.css',...fs.readdirSync(`${__dirname}/vendor/katex/fonts`).map(name=>`vendor/katex/fonts/${name}`)];
  for (const name of files) {
    const response = await fetchAsset(name); assert.equal(response.status,200,name);
    assert.ok(response.headers.get('content-type'),name);
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(`${__dirname}/${name}`));
  }
  assert.equal((await fetchAsset('math.js?v=test')).headers.get('content-type'),'text/javascript; charset=utf-8');
  assert.equal((await fetchAsset('vendor/katex/fonts/KaTeX_Main-Regular.woff2')).headers.get('content-type'),'font/woff2');
  for (const path of ['/goldenbell/test/','/goldenbell/run/private.json','/elsewhere']) assert.equal((await worker.fetch(new Request(`https://sigma.example${path}`))).status,404);
  assert.equal((await worker.fetch(new Request('https://sigma.example/'))).status,302);
  for (const [route,target] of [['/','/goldenbell/'],['/goldenbell','/goldenbell/'],['/goldenbell/run','/goldenbell/run/']]) {
    const response = await worker.fetch(new Request(`https://sigma.example${route}`));
    assert.equal(response.headers.get('location'), `https://sigma.example${target}`);
  }
  const landingRoot = fs.existsSync(`${__dirname}/landing/index.html`) ? `${__dirname}/landing` : `${__dirname}/..`;
  for (const name of ['index.html','goldenbell.css','hero-bell.png','fonts/DNFBitBit-Regular.woff2','fonts/DNFBitBit-LICENSE.txt']) {
    const response = await worker.fetch(new Request(`https://sigma.example/goldenbell/${name}`));
    assert.equal(response.status,200,name);
    if(name.endsWith('.woff2')) assert.equal(response.headers.get('content-type'),'font/woff2');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(`${landingRoot}/${name}`));
  }
  const landing = await worker.fetch(new Request('https://sigma.example/goldenbell/'));
  assert.equal(landing.headers.get('cache-control'),'no-store');
  assert.match(await landing.text(), /2026 수학 골든벨/);
  for (const name of ['README.md','landing.test.cjs','run/landing/index.html']) assert.equal((await worker.fetch(new Request(`https://sigma.example/goldenbell/${name}`))).status,404);
  const html=fs.readFileSync(`${__dirname}/index.html`,'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    assert.ok(match[1].startsWith('./'),match[1]);
    assert.equal((await fetchAsset(match[1].slice(2))).status,200,match[1]);
  }
  for (const match of fs.readFileSync(`${__dirname}/app.js`,'utf8').matchAll(/^import .* from '([^']+)'/gm)) assert.equal((await fetchAsset(match[1].slice(2))).status,200,match[1]);
});

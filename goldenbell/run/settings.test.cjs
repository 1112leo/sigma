const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const storage = new Map();
const app = { innerHTML: '' };
const fields = Object.fromEntries([
  'event-title', 'event-date', 'event-place', 'message-tagline',
  'message-lobby', 'message-opening', 'message-rules', 'message-break', 'message-ending',
].map(id => [id, { value: '' }]));
const context = vm.createContext({
  assert, crypto: webcrypto, URLSearchParams, structuredClone,
  location: { search: '', hash: '' }, window: { addEventListener() {} },
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  document: {
    addEventListener() {}, getElementById: id => id === 'app' ? app : fields[id],
    querySelector: () => null, querySelectorAll: () => [],
  },
});
vm.runInContext(fs.readFileSync(`${__dirname}/runtime.js`, 'utf8').replace(/^export \{.*\};$/m, ''), context);
vm.runInContext(fs.readFileSync(`${__dirname}/vendor/katex/katex.min.js`, 'utf8'), context);
for (const module of ['math', 'preparation']) vm.runInContext(fs.readFileSync(`${__dirname}/${module}.js`, 'utf8').replace(/^export \{.*\};$/m, ''), context);
const source = fs.readFileSync(`${__dirname}/app.js`, 'utf8').replace(/^import .*;$/gm, '');
vm.runInContext(source.slice(0, source.lastIndexOf('\nif (IS_SCREEN) {')) + `
  render = () => {};
  toast = () => {};
  state = defaultState();
  saveSettings();
  state = loadPrivateState();
  assert.equal(state.event.title, '');
  for (const value of Object.values(state.messages)) assert.equal(value, '');
  const restored = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.messages, state.messages);
  assert.equal(normalizeState({}).messages.tagline, defaultState().messages.tagline);
  for (const mode of ['lobby', 'opening', 'break', 'ending']) {
    const screenId = legacyScreenIds[mode];
    if (!state.sequence.some(item => item.screenId === screenId)) state.sequence.push({ type: 'screen', screenId });
    activateSequence(state, state.sequence.findIndex(item => item.screenId === screenId));
    publicState = buildPublicState();
    assert.equal(publicState.screen.title, '');
    assert.equal(publicState.messages.tagline, '');
    assert.ok(!renderPreview().includes(defaultState().messages[mode]));
    renderScreen();
    assert.ok(!document.getElementById('app').innerHTML.includes('잠시 후 시작합니다'));
  }
  activateSequence(state, state.sequence.findIndex(item => item.type === 'question'));
  publicState = buildPublicState();
  renderScreen();
  assert.ok(!document.getElementById('app').innerHTML.includes('SIGMA GOLDEN BELL'));
`, context);
console.log('PASS: empty settings save, reload, JSON restore, preview and projector; missing fields retain defaults');

const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

module.exports = function createHarness() {
  const storage = new Map();
  const fields = {};
  const app = { innerHTML: '' };
  const listeners = {};
  const context = vm.createContext({
    crypto: webcrypto, URLSearchParams, structuredClone,
    location: { search: '', hash: '' },
    window: { addEventListener(name, callback) { (listeners[name] ||= []).push(callback); } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    document: {
      activeElement: null, addEventListener() {}, getElementById: id => id === 'app' ? app : fields[id],
      querySelector: () => null, querySelectorAll: () => [],
    },
    confirm: () => true, alert: () => {},
    clearInterval() {}, setInterval() {}, requestAnimationFrame() {},
  });
  const source = fs.readFileSync(`${__dirname}/app.js`, 'utf8');
  vm.runInContext(source.slice(0, source.lastIndexOf('\nif (IS_SCREEN) {')), context);
  vm.runInContext('render = () => {}; toast = () => {}; state = defaultState();', context);
  const run = code => vm.runInContext(code, context);
  const json = code => JSON.parse(run(`JSON.stringify(${code})`));
  return { run, json, context, storage, fields, app, listeners };
};

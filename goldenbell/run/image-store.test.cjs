const test = require('node:test');
const assert = require('node:assert/strict');
const createHarness = require('./test-harness.cjs');

const IMAGE = 'data:image/png;base64,YQ==';
const KEY = 'sigma-goldenbell-v1';

function fakeIndexedDB() {
  const images = new Map();
  let failWrites = false;
  const db = {
    createObjectStore() {},
    transaction() {
      const transaction = { error: null, objectStore() {
        return Object.fromEntries(['get', 'put', 'delete'].map(operation => [operation, (value, key) => {
          const request = { result: undefined };
          Promise.resolve().then(() => {
            if (failWrites && operation !== 'get') {
              transaction.error = new Error('quota');
              transaction.onerror?.();
              return;
            }
            if (operation === 'get') request.result = images.get(value);
            if (operation === 'put') images.set(key, value);
            if (operation === 'delete') images.delete(value);
            request.onsuccess?.();
            transaction.oncomplete?.();
          });
          return request;
        }]));
      } };
      return transaction;
    },
  };
  return {
    images,
    failWrites(value) { failWrites = value; },
    open() {
      const request = { result: db };
      Promise.resolve().then(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    },
  };
}

function fixture() {
  const h = createHarness();
  const db = fakeIndexedDB();
  h.context.indexedDB = db;
  return { h, db };
}

test('legacy data URL moves to IndexedDB and a reload restores the image without localStorage bloat', async () => {
  const { h, db } = fixture();
  h.storage.set(KEY, JSON.stringify({ schemaVersion: 3, questions: [{ id: 'Q1', question: '그림 문제', answer: '1', image: IMAGE }] }));
  h.run('state=loadPrivateState()');
  await h.run('prepareImages(state)');
  assert.equal(h.run('saveState()'), true);
  assert.equal(db.images.size, 1);
  assert.ok(!h.storage.get(KEY).includes('data:image'));
  assert.ok(!h.storage.get('sigma-goldenbell-public-v2')?.includes('data:image'));
  assert.ok(JSON.parse(h.storage.get(KEY)).questions[0].imageId);
  h.run('state=loadPrivateState()');
  await h.run('prepareImages(state)');
  assert.equal(h.run('state.questions[0].image'), IMAGE);
  assert.equal(h.run('buildPublicState().question?.image || ""'), '');
});

test('one exported JSON contains the image and restores into a fresh empty IndexedDB', async () => {
  const { h } = fixture();
  h.run(`state.questions=[migrateQuestion({id:'Q1',question:'그림',answer:'1',image:${JSON.stringify(IMAGE)}})];state.sequence=[{type:'question',questionId:'Q1'}];activateSequence(state,0);`);
  await h.run('prepareImages(state)');
  h.run('saveState()');
  const backup = await h.run('completeBackup(state)');
  assert.equal(backup.questions[0].image, IMAGE);
  const restored = fixture();
  restored.h.context.backup = backup;
  restored.h.run('state=normalizeState(backup)');
  await restored.h.run('prepareImages(state,{fresh:true})');
  restored.h.run('saveState();state=loadPrivateState()');
  await restored.h.run('prepareImages(state)');
  assert.equal(restored.h.run('state.questions[0].image'), IMAGE);
  assert.equal(restored.db.images.size, 1);
  assert.ok(!restored.h.storage.get(KEY).includes('data:image'));
});

test('backup import handler restores a self-contained image and rejects reference-only files', async () => {
  const { h, db } = fixture();
  const readers = [];
  h.context.FileReader = class { constructor() { readers.push(this); } readAsText() {} };
  h.run('downloadBackup=async()=>true;isUnlocked=()=>true');
  const backup = { schemaVersion: 3, questions: [{ id: 'Q1', question: '그림', answer: '1', imageId: 'old-browser-id', image: IMAGE }] };
  h.run('importData({target:{files:[{}],value:""}})');
  readers[0].result = JSON.stringify(backup);
  await readers[0].onload();
  assert.equal(h.run('state.questions[0].image'), IMAGE);
  assert.notEqual(h.run('state.questions[0].imageId'), 'old-browser-id');
  assert.equal(db.images.size, 1);
  assert.ok(!h.storage.get(KEY).includes('data:image'));
  const saved = h.storage.get(KEY);
  h.run('importData({target:{files:[{}],value:""}})');
  readers[1].result = JSON.stringify({ schemaVersion: 3, questions: [{ id: 'Q2', question: '누락', answer: '2', imageId: 'missing' }] });
  await readers[1].onload();
  assert.equal(h.storage.get(KEY), saved);
  assert.equal(db.images.size, 1);
});

test('deleting a question cleans its unreferenced image only after state saves', async () => {
  const { h, db } = fixture();
  h.run(`state.questions=[migrateQuestion({id:'Q1',question:'그림',answer:'1',image:${JSON.stringify(IMAGE)}})];state.sequence=[{type:'question',questionId:'Q1'}];activateSequence(state,0);`);
  await h.run('prepareImages(state)');
  h.run('saveState()');
  h.run("deleteQuestion('Q1')");
  await Promise.resolve(); await Promise.resolve();
  assert.equal(db.images.size, 0);
  assert.equal(h.run('state.questions.length'), 0);
});

test('IndexedDB write failure leaves the original localStorage image intact', async () => {
  const { h, db } = fixture();
  const raw = JSON.stringify({ schemaVersion: 3, questions: [{ id: 'Q1', question: '그림', answer: '1', image: IMAGE }] });
  h.storage.set(KEY, raw);
  h.run('state=loadPrivateState()');
  db.failWrites(true);
  await assert.rejects(h.run('prepareImages(state)'));
  assert.equal(h.storage.get(KEY), raw);
  assert.equal(db.images.size, 0);
});

test('an unavailable image reference cannot produce an incomplete JSON backup', async () => {
  const { h } = fixture();
  h.storage.set(KEY, JSON.stringify({ schemaVersion: 3, questions: [{ id: 'Q1', question: '그림', answer: '1', imageId: 'missing' }] }));
  h.run('state=loadPrivateState();persistenceBlocked=true');
  let clicked = 0;
  h.context.document.createElement = () => ({ click() { clicked++; } });
  assert.equal(await h.run('downloadBackup()'), false);
  assert.equal(clicked, 0);
});

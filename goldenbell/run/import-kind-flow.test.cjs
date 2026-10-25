const test = require('node:test');
const assert = require('node:assert/strict');
const createHarness = require('./test-harness.cjs');
const BACKUP_MESSAGE = '전체 백업 파일입니다. 행사·슬라이드 설정 → 백업·복원에서 불러와 주세요.';
const QUESTION_MESSAGE = '문제 전용 파일입니다. 문제 가져오기에서 불러와 주세요.';
const rows = [{ id:'NEW', question:'새 문제', answer:'2' }];

function fixture() {
  const messages = [], alerts = [], readers = [];
  const h = createHarness({ BroadcastChannel: class { addEventListener() {} postMessage(message) { messages.push(message); } } });
  h.context.alert = message => alerts.push(message);
  h.context.FileReader = class { constructor() { readers.push(this); } readAsText() {} };
  h.run(`state.questions=[migrateQuestion({id:'KEEP',question:'기존 문제',answer:'1',imageId:'existing-image'})];
    state.sequence=buildAutoSequence(state.questions);activateSequence(state,3);state.timer.remaining=17;state.answerVisible=true;
    isUnlocked=()=>true;saveState();let confirms=0,backups=0,imageWrites=0;
    confirm=()=>{confirms++;return true};downloadBackup=async()=>{backups++;return true};
    brokenImages=async()=>[];storeChangedImages=async()=>{imageWrites++;return []};prepareImages=async()=>{imageWrites++;return []};`);
  const snapshot = () => ({ state:h.json('state'), storage:[...h.storage.entries()], messages:structuredClone(messages) });
  return { h, alerts, readers, snapshot };
}

test('paste preview and file preview reject backups with the exact message and leave all state untouched', async () => {
  const { h, snapshot } = fixture();
  const before = snapshot();
  const backup = JSON.stringify(h.json('state'));
  h.fields['batch-text'] = { value:backup };
  h.fields['batch-format'] = { value:'json' };
  h.run('parseBatch()');
  assert.equal(h.run('importDraft.error'), BACKUP_MESSAGE);
  assert.equal(h.run('importDraft.rows'), undefined);
  assert.deepEqual(snapshot(), before);
  h.context.file = { name:'backup.json', size:backup.length, text:async()=>backup };
  await h.run('readBatchFile({target:{files:[file]}})');
  assert.equal(h.run('importDraft.error'), BACKUP_MESSAGE);
  assert.equal(h.run('importDraft.rows'), undefined);
  assert.deepEqual(snapshot(), before);
  assert.equal(h.run('confirms+backups+imageWrites'), 0);
});

test('actual append/update/replace rejects a backup source even if extracted preview rows were left behind', async () => {
  for (const mode of ['append','update','replace']) {
    const { h, snapshot } = fixture();
    const before = snapshot();
    h.context.rows = rows;
    h.context.text = JSON.stringify(h.json('state'));
    h.context.mode = mode;
    h.run('importDraft={rows,text,mode,format:"json"}');
    const preview = h.json('prepareBatch()');
    assert.equal(preview.errors[0].message, BACKUP_MESSAGE);
    await h.run('applyBatch()');
    assert.equal(h.run('importDraft.error'), BACKUP_MESSAGE);
    assert.deepEqual(snapshot(), before);
    assert.equal(h.run('confirms+backups+imageWrites'), 0);
  }
});

test('a backup hidden among question rows cannot bypass application without its source text', async () => {
  const { h, snapshot } = fixture();
  const before = snapshot();
  h.run('importDraft={rows:[state],mode:"replace"}');
  await h.run('applyBatch()');
  assert.equal(h.run('importDraft.error'), BACKUP_MESSAGE);
  assert.deepEqual(snapshot(), before);
  assert.equal(h.run('confirms+backups+imageWrites'), 0);
});

test('file kind is rechecked after image decoding and after the automatic backup before any image writes', async () => {
  for (const phase of ['decode','backup']) {
    const { h, snapshot } = fixture();
    const before = snapshot();
    h.context.rows = rows;
    h.run('importDraft={rows,text:JSON.stringify(rows),format:"json",mode:"append"};const wrongFile=JSON.stringify(state);');
    if (phase === 'decode') h.run('brokenImages=async()=>{importDraft.text=wrongFile;return []}');
    else h.run('downloadBackup=async()=>{backups++;importDraft.text=wrongFile;return true}');
    await h.run('applyBatch()');
    assert.equal(h.run('importDraft.error'), BACKUP_MESSAGE);
    assert.deepEqual(snapshot(), before);
    assert.equal(h.run('imageWrites'), 0);
  }
});

test('both normal JSON question forms and the explicit import form still preview and apply', async () => {
  for (const value of [rows, {questions:rows}, {type:'question-import',questions:rows}]) {
    const { h } = fixture();
    h.fields['batch-text'] = { value:JSON.stringify(value) };
    h.fields['batch-format'] = { value:'json' };
    h.run('parseBatch()');
    assert.equal(h.run('prepareBatch().errors.length'), 0);
    await h.run('applyBatch()');
    assert.deepEqual(h.json('state.questions.map(q=>q.id)'), ['KEEP','NEW']);
    assert.equal(h.run('backups'), 1);
  }
});

test('full restore rejects question-only inputs before confirmation, backup or writes', async () => {
  for (const value of [rows, {questions:rows}, {type:'question-import',questions:rows}]) {
    const { h, readers, alerts, snapshot } = fixture();
    const before = snapshot();
    h.run('importData({target:{files:[{}],value:"selected.json"}})');
    readers[0].result = JSON.stringify(value);
    await readers[0].onload();
    assert.deepEqual(alerts, [QUESTION_MESSAGE]);
    assert.deepEqual(snapshot(), before);
    assert.equal(h.run('confirms+backups+imageWrites'), 0);
  }
});

test('full restore still accepts modern and legacy backups and keeps the event and slide configuration', async () => {
  for (const legacy of [false,true]) {
    const { h, readers, alerts } = fixture();
    const value = h.json('state');
    if (legacy) delete value.schemaVersion;
    value.event.title = '복원 행사';
    value.questions = rows;
    value.sequence = [{type:'question',questionId:'NEW'}, ...value.sequence.filter(item=>item.type==='screen')];
    h.run('importData({target:{files:[{}],value:"selected.json"}})');
    readers[0].result = '\uFEFF' + JSON.stringify(value);
    await readers[0].onload();
    assert.deepEqual(alerts, []);
    assert.equal(h.run('state.event.title'), '복원 행사');
    assert.deepEqual(h.json('state.questions.map(q=>q.id)'), ['NEW']);
    assert.deepEqual(h.json('state.sequence'), value.sequence);
    assert.equal(h.run('backups'), 1);
  }
});

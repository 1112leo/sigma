const { test } = require('node:test');
const assert = require('node:assert/strict');

const preparation = import('./preparation.js');
const backupMessage = '전체 백업 파일입니다. 행사·슬라이드 설정 → 백업·복원에서 불러와 주세요.';
const stateMarkers = ['schemaVersion','settings','event','messages','sequence','customScreens','runtime','runSettings','currentIndex','sequenceIndex','displayMode','timer','answerVisible','tab'];
const rows = [{ id:'A', question:'Q', answer:'A' }];

test('question JSON accepts BOM arrays and exact legacy or explicit wrappers; CSV remains supported', async () => {
  const { parseQuestionImport } = await preparation;
  assert.deepEqual(parseQuestionImport(`\uFEFF${JSON.stringify(rows)}`), rows);
  assert.deepEqual(parseQuestionImport(`\uFEFF${JSON.stringify({ questions: rows })}`), rows);
  assert.deepEqual(parseQuestionImport(`\uFEFF${JSON.stringify({ type:'question-import', questions: rows })}`), rows);
  assert.deepEqual(parseQuestionImport('id,question,answer\nA,Q,A', 'csv'), rows);
});

test('every own state marker makes the root or a question row a full backup', async () => {
  const { isFullBackup, questionImportRows, parseQuestionImport, prepareQuestionImport } = await preparation;
  for (const key of stateMarkers) {
    const rootBackup = { questions: rows, [key]: null };
    assert.equal(isFullBackup(rootBackup), true, key);
    assert.throws(() => questionImportRows(rootBackup), { message: backupMessage }, key);
    assert.throws(() => questionImportRows({ type:'question-import', questions:rows, [key]:null }), { message: backupMessage }, `${key} explicit root`);

    const nestedBackup = [{ ...rows[0], [key]: null }];
    assert.throws(() => questionImportRows(nestedBackup), { message: backupMessage }, `${key} row`);
    assert.throws(() => parseQuestionImport(JSON.stringify(nestedBackup)), { message: backupMessage }, `${key} parsed row`);
    const guarded = prepareQuestionImport(nestedBackup, [], 'append', {});
    assert.deepEqual(guarded.errors, [{ row:0, message:backupMessage }], `${key} guarded import`);
  }
});

test('state marker detection uses own keys and rejects explicit import marker spoofing', async () => {
  const { isFullBackup, questionImportRows } = await preparation;
  const inheritedMarker = Object.create({ schemaVersion:3 });
  inheritedMarker.questions = rows;
  assert.equal(isFullBackup(inheritedMarker), false);
  assert.equal(isFullBackup({ schemaVersion:undefined }), true);
  assert.equal(isFullBackup([{ schemaVersion:3 }]), false);
  assert.throws(() => questionImportRows({ type:'question-import', questions:rows, schemaVersion:3 }), { message:backupMessage });
  assert.throws(() => questionImportRows([{ ...rows[0], tab:'questions' }]), { message:backupMessage });
});

test('unknown wrapper fields are rejected for both accepted JSON wrapper forms', async () => {
  const { questionImportRows, parseQuestionImport } = await preparation;
  for (const value of [
    { questions:rows, extra:true },
    { type:'question-import', questions:rows, extra:true },
  ]) {
    assert.throws(() => questionImportRows(value));
    assert.throws(() => parseQuestionImport(JSON.stringify(value)));
  }
});

test('backup restore accepts modern and legacy state objects with questions and a state marker', async () => {
  const { assertFullBackup } = await preparation;
  const modern = { schemaVersion:3, questions:rows, sequence:[] };
  const legacy = { questions:rows, displayMode:'question', currentIndex:0 };
  assert.equal(assertFullBackup(modern), modern);
  assert.equal(assertFullBackup(legacy), legacy);
});

test('backup restore rejects question-only inputs with the mapped error and malformed state as invalid-backup', async () => {
  const { assertFullBackup } = await preparation;
  for (const value of [
    rows,
    { questions:rows },
    { type:'question-import', questions:rows },
    { type:'question-import', questions:rows, schemaVersion:3 },
  ]) assert.throws(() => assertFullBackup(value), { message:'question-only-file' });
  for (const value of [null, {}, { questions:'not-an-array' }, { schemaVersion:3 }]) {
    assert.throws(() => assertFullBackup(value), { message:'invalid-backup' });
  }
});

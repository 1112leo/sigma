const assert = require('node:assert/strict');
const test = require('node:test');
const createHarness = require('./test-harness.cjs');

test('legacy migration preserves contents, IDs, times, images, notes and intentional blanks', () => {
  const h = createHarness();
  h.run(`legacy = { questions: [{ id: 'Q1', order: 7, category: 'revival', title: '패자부활 1', question: '질문', answer: '답', explanation: '해설', note: '비공개', image: 'data:image/png;base64,YQ==', imageAlt: '도형', seconds: 42 }], messages: { tagline: '', lobby: '' } }; migrated = normalizeState(legacy);`);
  const old = h.json('legacy.questions[0]');
  const question = h.json('migrated.questions[0]');
  for (const key of Object.keys(old)) assert.equal(question[key], old[key], key);
  assert.equal(question.timeLimit, 42);
  assert.equal(question.round, null);
  assert.equal(question.usageStatus, 'active');
  assert.equal(question.difficulty, 'normal');
  assert.equal(question.reviewStatus, 'draft');
  for (const key of ['acceptedAnswers', 'judgeNote', 'author']) assert.equal(question[key], '');
  assert.ok(Date.parse(question.createdAt));
  assert.equal(question.updatedAt, question.createdAt);
  assert.equal(h.run('migrated.messages.tagline'), '');
  assert.equal(h.run('legacy.questions[0].timeLimit'), undefined);
  assert.deepEqual(h.json('normalizeState(migrated)'), h.json('migrated'));
});

test('new fields round-trip through JSON and all enums are validated independently', () => {
  const h = createHarness();
  h.run(`state.questions[0] = migrateQuestion({id:'Q2', category:'hard', round:'revival1', usageStatus:'reserve', difficulty:'extreme', reviewStatus:'peer-reviewed', acceptedAnswers:'2 또는 둘', judgeNote:'동치 인정', author:'출제자', timeLimit:60, createdAt:'2026-08-01T00:00:00.000Z', updatedAt:'2026-08-02T00:00:00.000Z'});`);
  assert.deepEqual(h.json('normalizeState(JSON.parse(JSON.stringify(state)))'), h.json('state'));
  for (const field of ['category', 'round', 'usageStatus', 'difficulty', 'reviewStatus']) {
    assert.equal(h.run(`questionEnums.${field}.every(value => validateQuestion({...state.questions[0], ${field}:value}).length === 0)`), true);
    assert.equal(h.run(`validateQuestion({...state.questions[0], ${field}:'invalid'}).some(error => error.field === '${field}')`), true);
  }
  for (const value of [0, 601, 1.5, '', null, true, 'bad']) {
    assert.equal(h.run(`validTimeLimit(${JSON.stringify(value)})`), false, String(value));
  }
  for (const value of [1, 600, '30']) assert.equal(h.run(`validTimeLimit(${JSON.stringify(value)})`), true);
  assert.equal(h.run('migrateQuestion({seconds:20,timeLimit:50}).seconds'), 50);
  assert.equal(h.run('migrateQuestion({category:"tiebreak", seconds:0}).timeLimit'), 45);
});

test('local migration is persisted under the existing key; future/corrupt data is never overwritten', () => {
  const h = createHarness();
  const key = h.run('PRIVATE_STORAGE_KEY');
  h.storage.set(key, JSON.stringify({ questions: [{ id:'old', seconds:12 }] }));
  h.run('state = loadPrivateState(); saveState();');
  assert.equal(JSON.parse(h.storage.get(key)).schemaVersion, h.run('SCHEMA_VERSION'));
  for (const raw of ['{bad', JSON.stringify({schemaVersion:999, questions:[]})]) {
    h.storage.set(key, raw);
    h.run('state = loadPrivateState();');
    assert.equal(h.run('saveState()'), false);
    assert.equal(h.storage.get(key), raw);
  }
});

test('public payload never contains operator fields, even with answer visible', () => {
  const h = createHarness();
  h.run(`Object.assign(state.questions[0], {answer:'정답',acceptedAnswers:'SECRET',judgeNote:'SECRET',author:'SECRET',note:'SECRET',reviewStatus:'final'}); state.displayMode='question';`);
  for (const visible of [false, true]) {
    h.run(`state.answerVisible=${visible}`);
    const payload = h.json('buildPublicState()');
    assert.ok(!JSON.stringify(payload).includes('SECRET'));
    for (const field of ['acceptedAnswers','judgeNote','author','note','reviewStatus']) assert.ok(!(field in payload.question));
    assert.equal(payload.question.answer, visible ? '정답' : '');
  }
});

test('existing editor synchronizes seconds/timeLimit and creates complete question records', () => {
  const h = createHarness();
  for (const [id,value] of Object.entries({'q-category':'basic','q-seconds':'55','q-question':'질문','q-answer':'답','q-explanation':'','q-title':'제목','q-note':'','q-image-alt':''})) h.fields[id]={value};
  h.run('openQuestion(); saveQuestion(); state = loadPrivateState();');
  assert.equal(h.run('state.questions.at(-1).timeLimit'),55);
  assert.equal(h.run('validateQuestion(state.questions.at(-1)).length'),0);
  h.run('openQuestion(state.questions[0].id); saveQuestion(); state = loadPrivateState();');
  assert.equal(h.run('state.questions[0].seconds'),55);
  assert.equal(h.run('state.questions[0].timeLimit'),55);
});

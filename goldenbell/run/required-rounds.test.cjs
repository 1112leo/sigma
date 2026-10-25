const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./test-harness.cjs');
const ids = ['revival1-start', 'revival2-start', 'final-start'];

test('required round buttons exist with no special questions, including after automatic construction', () => {
  const h = harness();
  h.run("state.questions=[migrateQuestion({id:'M',question:'본문',answer:'1'})];state.sequence=buildAutoSequence(state.questions);");
  for (const id of ids) assert.equal(h.run(`state.sequence.filter(item=>item.screenId===${JSON.stringify(id)}).length`), 1);
  const html = h.run('renderSlideSelector()');
  for (const label of ['패자부활전 1차','패자부활전 2차','등수결정전']) assert.ok(html.includes(label));
  h.run("handleAction('sequence-auto');state=normalizeState(state);");
  assert.equal(h.run('specialRoundEntries().length'), 3);
});

test('missing rounds migrate without losing the active duplicate question or break return position', () => {
  const h = harness();
  h.run(`state.questions=[migrateQuestion({id:'V',question:'부활 문제',answer:'2',round:'revival1'})];
    state.sequence=[{type:'question',questionId:'V'},{type:'screen',screenId:'rules'},{type:'question',questionId:'V'},{type:'screen',screenId:'end'}];
    activateSequence(state,2);setManualTimer(17);state.runtime.mainResume={index:2,questionId:'V',remaining:12};state.answerVisible=true;startBreak();state=normalizeState(state);`);
  assert.equal(h.run('state.runtime.break.sequenceIndex'), 3);
  assert.equal(h.run('state.runtime.break.remaining'), 17);
  assert.equal(h.run('state.runtime.mainResume.index'), 3);
  assert.equal(h.run('activeItem(state).screenId'), 'standby');
  h.run('resumeBreak();');
  assert.equal(h.run('state.sequenceIndex'), 3);
  assert.equal(h.run('currentQuestion().id'), 'V');
  assert.equal(h.run('state.timer.remaining'), 17);
  assert.equal(h.run('state.answerVisible'), true);
  assert.deepEqual(h.json('normalizeState(state).sequence'), h.json('state.sequence'));
});

test('legacy category-only special questions receive their intros before the questions, not after them', () => {
  const h = harness();
  h.run("state.questions=[migrateQuestion({id:'M',question:'일반',answer:'1'}),migrateQuestion({id:'V',category:'revival',question:'부활',answer:'2'}),migrateQuestion({id:'F',category:'tiebreak',question:'결정',answer:'3'})];state.sequence=buildAutoSequence(state.questions);");
  assert.equal(h.run("state.sequence.findIndex(item=>item.screenId==='revival1-start')+1"), h.run("state.sequence.findIndex(item=>item.questionId==='V')"));
  assert.equal(h.run("state.sequence.findIndex(item=>item.screenId==='final-start')+1"), h.run("state.sequence.findIndex(item=>item.questionId==='F')"));
  assert.equal(h.run('specialRoundEntries().length'), 3);
});

test('last required intro cannot be deleted, but can be reordered and extra copies can be removed', () => {
  const h = harness();
  for (const id of ids) {
    h.run(`position=state.sequence.findIndex(item=>item.screenId===${JSON.stringify(id)});before=JSON.stringify(state);editSequence(position,'remove');`);
    assert.equal(h.run('JSON.stringify(state)'), h.run('before'));
  }
  h.run("position=state.sequence.findIndex(item=>item.screenId==='revival1-start');moveSequence(position,0);");
  assert.equal(h.run('state.sequence[0].screenId'), 'revival1-start');
  assert.match(h.run('renderSequence()'), /aria-label="항목 1 필수 라운드" disabled>고정/);
  h.run("appendSequence('screen','revival1-start');editSequence(0,'remove');");
  assert.equal(h.run("state.sequence.filter(item=>item.screenId==='revival1-start').length"), 1);
});

test('first revival title migrates on both presentation surfaces without renaming mode buttons or second revival', () => {
  const h = harness();
  h.run("state.customScreens.find(screen=>screen.id==='revival1-start').title='패자부활전 1';state=normalizeState(state);startSpecialRound(specialRoundEntries()[0].index);");
  assert.equal(h.run('currentScreen().title'), '패자부활전');
  assert.equal(h.json('buildPublicState()').screen.title, '패자부활전');
  assert.match(h.run('renderPreview()'), /&lt;h1&gt;패자부활전&lt;\/h1&gt;/);
  assert.equal(h.run("state.customScreens.find(screen=>screen.id==='revival2-start').title"), '패자부활전 2');
  assert.match(h.run('renderSlideSelector()'), /패자부활전 1차/);
});

test('review controls and preflight are gone while question import and private metadata remain compatible', () => {
  const h = harness();
  h.run("state.questions=[migrateQuestion({id:'Q',question:'문제',answer:'1',reviewStatus:'peer-reviewed'})];questionFilters={reviewStatus:'final'};openQuestion('Q');");
  assert.equal(h.run('filteredQuestions().length'), 1);
  for (const render of ['renderQuestions()', 'renderModal()', 'renderPreparation()']) {
    assert.doesNotMatch(h.run(render), /검수|최종 확정|자동 점검|현장 체크리스트|data-action="preflight"|q-reviewStatus|filter-reviewStatus/);
  }
  assert.match(h.run('renderPreparation()'), /id="batch-form"/);
  h.run('saveQuestion();');
  assert.equal(h.run('state.questions[0].reviewStatus'), 'peer-reviewed');
});

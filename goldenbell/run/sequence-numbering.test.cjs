const test = require('node:test');
const assert = require('node:assert/strict');
const createHarness = require('./test-harness.cjs');

function fixture() {
  const h = createHarness();
  h.run(`state.questions=[
    migrateQuestion({id:'Q33',title:'33번',question:'첫 문제',answer:'1'}),
    migrateQuestion({id:'Q35',title:'35번',question:'둘째 문제',answer:'2'}),
    migrateQuestion({id:'R44',title:'44번',question:'예비 문제',answer:'3',usageStatus:'reserve'})
  ];state.sequence=[{type:'screen',screenId:'rules'},{type:'question',questionId:'Q35'},{type:'question',questionId:'Q33'},{type:'question',questionId:'Q35'}];activateSequence(state,1);`);
  return h;
}

test('question and answer labels follow actual occurrences without rewriting source titles or IDs', () => {
  const h=fixture();
  const original=h.json('state.questions');
  for(const [position,label] of [[1,'01번'],[2,'02번'],[3,'03번']]) {
    h.run(`goSequence(${position})`);
    assert.equal(h.run('buildPublicState().question.title'),label);
    assert.ok(h.run('renderLive()').includes(`<h2>${label}</h2>`));
    assert.ok(h.run('renderScreenMarkup(buildPublicState())').includes(`<p class="screen-q-title">${label}</p>`));
    h.run('toggleAnswer()');
    assert.ok(h.run('renderScreenMarkup(buildPublicState())').includes(`<p class="answer-question-title">${label}</p>`));
    assert.equal(h.run('renderPreview()'),h.run('presentationFrame(buildPublicState())'));
  }
  assert.deepEqual(h.json('state.questions'),original);
});

test('a stale raw title in projector payload cannot override its displayed occurrence number', () => {
  const h=fixture();
  h.run("payload=buildPublicState();payload.currentIndex=1;payload.question.title='35번';");
  assert.ok(h.run('renderScreenMarkup(payload)').includes('<p class="screen-q-title">02번</p>'));
  h.run('payload.answerVisible=true');
  assert.ok(h.run('renderScreenMarkup(payload)').includes('<p class="answer-question-title">02번</p>'));
});

test('next destination and both slide lists use the same occurrence number as the projected label', () => {
  const h=fixture();
  assert.equal(h.run('slideDestination(2)'),'3번 · 02번');
  assert.ok(h.run('renderLive()').includes('Q33 · 02번'));
  assert.ok(h.run('renderSequence()').includes('Q33 · 02번'));
  assert.ok(h.run('renderLive()').includes('Q35 · 03번'));
  assert.equal(h.run('state.questions[0].title'),'33번');
});

test('reserve questions outside the sequence do not inflate numbering; reordering and reload recompute it', () => {
  const h=fixture();
  assert.equal(h.run('buildPublicState().totalQuestions'),3);
  h.run('moveSequence(2,1);state=normalizeState(state);');
  const cursor=h.run('state.sequenceIndex');
  assert.equal(h.run('buildPublicState().question.title'),`${String(cursor).padStart(2,'0')}번`);
  assert.equal(h.run('state.questions.find(q=>q.id==="R44").usageStatus'),'reserve');
  assert.equal(h.run('state.questions.find(q=>q.id==="Q35").title'),'35번');
});

test('operating rules stay in the rules slide and special-round intros keep their original descriptions', () => {
  const h=createHarness();
  assert.match(h.run('state.messages.rules'),/패자부활전을 1~2회/);
  assert.match(h.run('state.messages.rules'),/정답자.*답판.*100점, 90점, 80점/);
  assert.match(h.run('state.customScreens.find(s=>s.id==="rules").description'),/패자부활전을 1~2회/);
  assert.equal(h.run('state.customScreens.find(s=>s.id==="final-start").description'),'최종 도전을 시작합니다.');
  assert.equal(h.run('state.customScreens.find(s=>s.id==="revival1-start").description'),'진행자의 안내를 따라주세요.');
});

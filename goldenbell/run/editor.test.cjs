const assert = require('node:assert/strict');
const test = require('node:test');
const createHarness = require('./test-harness.cjs');

function fixture() {
  const h = createHarness();
  h.run(`state.questions = [
    migrateQuestion({id:'Q1',question:'삼각형',answer:'3',category:'basic',round:'main1',usageStatus:'active',difficulty:'easy',reviewStatus:'final',author:'가'}),
    migrateQuestion({id:'Q2',question:'원',answer:'파이',category:'hard',round:'final',usageStatus:'reserve',difficulty:'extreme',reviewStatus:'peer-reviewed',author:'나'}),
    migrateQuestion({id:'Q3',question:'수열',answer:'10',usageStatus:'disabled',author:'가'})];`);
  return h;
}

test('all filters and search compose without changing data; null round is distinct from all', () => {
  const h=fixture();
  for (const [key,value] of Object.entries({category:'hard',round:'final',usageStatus:'reserve',difficulty:'extreme',author:'나',reviewStatus:'peer-reviewed',search:'파이'})) {
    h.run(`questionFilters = {${key}:${JSON.stringify(value)}};`);
    assert.deepEqual(h.json('filteredQuestions().map(q=>q.id)'), ['Q2']);
  }
  h.run(`questionFilters={round:'none'};`);
  assert.deepEqual(h.json('filteredQuestions().map(q=>q.id)'), ['Q3']);
  h.run(`questionFilters={hideDisabled:true};`);
  assert.equal(h.run('filteredQuestions().length'),2);
  h.run(`questionFilters={search:'q2',author:'가'};`);
  assert.equal(h.run('filteredQuestions().length'),0);
  assert.equal(h.run('state.questions.length'),3);
});

test('filtered reorder and deletion retain current question ID, answer state and timer', () => {
  const h=fixture();
  h.run(`state.currentIndex=1; state.answerVisible=true; state.timer.remaining=17; questionFilters={author:'가'}; moveQuestion('Q3',-1);`);
  assert.deepEqual(h.json('state.questions.map(q=>q.id)'),['Q3','Q2','Q1']);
  assert.equal(h.run('currentQuestion().id'),'Q2');
  assert.equal(h.run('state.timer.remaining'),17);
  assert.equal(h.run('state.answerVisible'),true);
  h.run(`deleteQuestion('Q3');`);
  assert.equal(h.run('currentQuestion().id'),'Q2');
  assert.equal(h.run('state.timer.remaining'),17);
  assert.deepEqual(h.json('state.questions.map(q=>q.order)'),[1,2]);
});

test('blank private fields save, immutable ID, invalid time rejected, storage failures retain draft', () => {
  const h=fixture();
  h.run(`openQuestion('Q1');`);
  for (const field of ['author','acceptedAnswers','judgeNote','note']) h.fields[`q-${field}`]={value:''};
  h.fields['q-id']={value:'SHOULD-NOT-CHANGE'};
  h.fields['q-seconds']={value:'0'};
  h.run('saveQuestion();');
  assert.equal(h.run('state.questions[0].timeLimit'),30);
  assert.equal(h.run('modal.question.id'),'Q1');
  h.fields['q-seconds'].value='48';
  h.run('saveQuestion(); state=loadPrivateState();');
  assert.equal(h.run('state.questions[0].id'),'Q1');
  for (const field of ['author','acceptedAnswers','judgeNote','note']) assert.equal(h.run(`state.questions[0].${field}`),'');
  h.run(`openQuestion('Q1'); localStorage.setItem=()=>{throw new Error('quota')};`);
  h.fields['q-seconds'].value='59';
  h.run('saveQuestion();');
  assert.equal(h.run('state.questions[0].timeLimit'),48);
  assert.equal(h.run('state.timer.remaining'),48);
  assert.equal(h.run('modal.question.timeLimit'),'59');
});

test('image completion preserves edits and ignores stale uploads and closed editors', async () => {
  const h=fixture();
  h.run(`openQuestion('Q1'); pending=[]; compressQuestionImage=()=>new Promise(resolve=>pending.push(resolve));`);
  h.fields['q-question']={value:'작성 중인 질문'};
  const first=h.run(`handleQuestionImage({target:{files:[{name:'one.png'}]}})`);
  const second=h.run(`handleQuestionImage({target:{files:[{name:'two.png'}]}})`);
  h.fields['q-question'].value='처리 중 추가 편집';
  h.run(`pending[1]('data:image/png;base64,Yg==');`);
  await second;
  h.run(`pending[0]('data:image/png;base64,YQ==');`);
  await first;
  assert.equal(h.run('modal.question.image'),'data:image/png;base64,Yg==');
  assert.equal(h.run('modal.question.question'),'처리 중 추가 편집');
  h.run(`handleAction('remove-question-image');`);
  assert.equal(h.run('modal.question.question'),'처리 중 추가 편집');
  assert.equal(h.run('modal.question.image'),'');
  const third=h.run(`handleQuestionImage({target:{files:[{name:'old.png'}]}})`);
  h.run(`openQuestion('Q2'); pending[2]('data:image/png;base64,YQ==');`);
  await third;
  assert.equal(h.run('modal.question.id'),'Q2');
  assert.equal(h.run('modal.question.image'),'');
});

test('operator answer/accepted answer/judge note are visible before public reveal', () => {
  const h=fixture();
  h.run(`Object.assign(state.questions[0],{acceptedAnswers:'삼',judgeNote:'동치 인정',note:'진행 메모'});`);
  const html=h.run('renderLive()');
  assert.ok(html.includes('operator-answer visible'));
  assert.ok(html.includes('인정 답안 · 삼'));
  assert.ok(html.includes('판정 메모 · 동치 인정'));
  assert.ok(!JSON.stringify(h.json('buildPublicState()')).includes('동치 인정'));
});

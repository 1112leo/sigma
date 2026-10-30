const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./test-harness.cjs');

function fixture() {
  const h = harness();
  h.run(`state.questions=[
    migrateQuestion({id:'M3',title:'03번',question:'본선',answer:'1'}),
    migrateQuestion({id:'V1',title:'42번',category:'revival',question:'패자',answer:'2'}),
    migrateQuestion({id:'F9',title:'09번',question:'후속',answer:'3'}),
    migrateQuestion({id:'M40',title:'40번',question:'다음 본선',answer:'4'})
  ];state.sequence=[{type:'question',questionId:'M3'},{type:'screen',screenId:'revival1-start'},
    {type:'question',questionId:'V1'},{type:'screen',screenId:'main-resume'},
    {type:'question',questionId:'F9'},{type:'question',questionId:'M40'},
    {type:'screen',screenId:'end'}];activateSequence(state,4);`);
  return h;
}

test('sequence tab renders a single draggable unit for revival intro, both questions and main resume', () => {
  const h=fixture(), questions=h.json('state.questions');
  assert.deepEqual(h.json('sequenceUnits()'),[
    {start:0,end:1,group:false},{start:1,end:5,group:true},
    {start:5,end:6,group:false},{start:6,end:7,group:false}
  ]);
  const html=h.run('renderSequence()');
  assert.equal((html.match(/draggable="true"/g)||[]).length,4);
  assert.match(html,/sequence-item sequence-group current/);
  assert.match(html,/원본 42번/);
  assert.match(html,/원본 09번/);
  assert.match(html,/본선 문제/);
  assert.match(html,/본게임 재개/);
  assert.doesNotMatch(html,/data-drag-sequence="[234]"/);
  assert.deepEqual(h.json('state.questions'),questions);
});

test('group drag and arrows preserve all members and the active occurrence in the flat backup schema', () => {
  const h=fixture(), questions=h.json('state.questions');
  h.run('moveSequenceUnit(1,0)');
  assert.deepEqual(h.json('state.sequence.slice(0,4).map(item=>item.questionId||item.screenId)'),['revival1-start','V1','main-resume','F9']);
  assert.equal(h.run('currentQuestion().id'),'F9');
  assert.equal(h.run('state.sequenceIndex'),3);
  h.run("editSequence(0,'down')");
  assert.equal(h.run('state.sequence[0].questionId'),'M3');
  assert.deepEqual(h.json('state.sequence.slice(1,5).map(item=>item.questionId||item.screenId)'),['revival1-start','V1','main-resume','F9']);
  assert.equal(h.run('currentQuestion().id'),'F9');
  assert.deepEqual(h.json('state.questions'),questions);
  h.run('before=JSON.stringify(state);localStorage.setItem=()=>{throw Error("quota")};moveSequenceUnit(1,0)');
  assert.equal(h.run('JSON.stringify(state)'),h.run('before'));
});

test('old paired layouts move main resume before the ordinary question without losing its cursor', () => {
  const h=fixture();
  const original=h.json('state.questions');
  h.run('state.sequence.splice(3,2,state.sequence[4],state.sequence[3]);activateSequence(state,3);state=normalizeState(state)');
  assert.deepEqual(h.json('state.sequence.slice(1,5).map(item=>item.questionId||item.screenId)'),['revival1-start','V1','main-resume','F9']);
  assert.equal(h.run('currentQuestion().id'),'F9');
  assert.equal(h.run('state.sequenceIndex'),4);
  assert.equal(h.run('buildPublicState().question.category'),'basic');
  assert.deepEqual(h.json('state.questions'),original);
});

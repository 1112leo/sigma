const assert = require('node:assert/strict');
const test = require('node:test');
const createHarness = require('./test-harness.cjs');

function fixture() {
  const h=createHarness();
  h.run(`state.questions=[migrateQuestion({id:'Q1',question:'첫 문제',answer:'첫 답',timeLimit:30,round:'main1'}),migrateQuestion({id:'Q2',question:'두 번째',answer:'둘',timeLimit:40,round:'main2'}),migrateQuestion({id:'R',question:'예비 문제',answer:'예비답',timeLimit:15,round:'main1',usageStatus:'reserve'})]; state.sequence=[{type:'screen',screenId:'opening'},{type:'question',questionId:'Q1'},{type:'question',questionId:'Q2'},{type:'question',questionId:'Q1'},{type:'screen',screenId:'end'}]; activateSequence(state,1);`);
  return h;
}

test('running question → repeated emergency screens → return preserves exact paused timer',()=>{
  const h=fixture();
  h.run('startTimer(); state.timer.endAt=Date.now()+18500; showImmediateScreen("judging"); showImmediateScreen("technical");');
  assert.equal(h.run('currentQuestion()'),null);
  assert.equal(h.run('state.runtime.returns.length'),1);
  assert.equal(h.run('buildPublicState().timer'),null);
  h.run('startTimer(); toggleAnswer(); resetTimer(); returnToPrevious();');
  assert.equal(h.run('currentQuestion().id'),'Q1');
  assert.equal(h.run('state.timer.running'),false);
  assert.ok(h.run('state.timer.remaining')>18 && h.run('state.timer.remaining')<=18.5);
  assert.equal(h.run('state.runtime.returns.length'),0);
});

test('reserve immediate and repeated temporary insertions leave original sequence unchanged',()=>{
  const h=fixture();
  const before=h.json('state.sequence');
  h.run('useReserve("R","immediate");');
  assert.equal(h.run('currentQuestion().id'),'R');
  assert.equal(h.run('state.timer.remaining'),15);
  h.run('returnToPrevious(); useReserve("R","insert"); handleAction("next");');
  assert.equal(h.run('currentQuestion().id'),'R');
  h.run('useReserve("R","insert"); handleAction("next");');
  assert.equal(h.run('currentQuestion().id'),'R');
  assert.equal(h.run('state.runtime.insertions.length'),2);
  assert.equal(h.run('new Set(state.runtime.insertions.map(i=>i.id)).size'),2);
  h.run('handleAction("next");');
  assert.equal(h.run('currentQuestion().id'),'Q2');
  assert.deepEqual(h.json('state.sequence'),before);
  assert.equal(h.run('state.runtime.reserveUses.length'),3);
});

test('invalid status is runtime only, hides returned answer, permits next/reserve',()=>{
  const h=fixture();
  const before=h.json('state.questions');
  h.run('toggleAnswer(); showImmediateScreen("invalid-question",true);');
  assert.equal(h.run('state.runtime.invalidQuestions[0].questionId'),'Q1');
  assert.deepEqual(h.json('state.questions'),before);
  h.run('returnToPrevious();');
  assert.equal(h.run('state.answerVisible'),false);
  h.run('showImmediateScreen("invalid-question",true); handleAction("next");');
  assert.equal(h.run('currentQuestion().id'),'Q2');
  assert.equal(h.run('state.runtime.returns.length'),0);
});

test('jump return restores duplicate occurrence and safety ON cancel is atomic',()=>{
  const h=fixture();
  h.run('goSequence(3); state.timer.remaining=11; goSequence(1,true); returnToPrevious();');
  assert.equal(h.run('state.sequenceIndex'),3);
  assert.equal(h.run('state.timer.remaining'),11);
  h.run('startTimer(); before=JSON.stringify(state); confirm=()=>false; handleAction("next");');
  assert.equal(h.run('JSON.stringify(state)'),h.run('before'));
  h.run('state.runSettings.safetyLock=false; handleAction("next");');
  assert.equal(h.run('state.sequenceIndex'),4);
  assert.equal(h.run('state.timer.running'),false);
});

test('timer manual bounds, running adjustment cap, expiry logs once',()=>{
  const h=fixture();
  for (const value of ['bad','',-1,601,0.5,null,true]) h.run(`setManualTimer(${JSON.stringify(value)});`);
  assert.equal(h.run('state.timer.remaining'),30);
  h.run('setManualTimer(600); startTimer(); adjustTimer(5);');
  assert.ok(h.run('getTimerRemaining()')<=600);
  h.run('state.timer.endAt=Date.now()-100; refreshTimerDom(); refreshTimerDom();');
  assert.equal(h.run('state.timer.remaining'),0);
  assert.equal(h.run('state.runtime.logs.filter(row=>row.type==="timer-end").length'),1);
  h.run('setManualTimer(0);');
  assert.equal(h.run('state.timer.running'),false);
});

test('all runtime contexts survive backup/reload, no auto restart after return',()=>{
  const h=fixture();
  h.run('useReserve("R","insert"); handleAction("next"); showImmediateScreen("judging"); saveState(); state=loadPrivateState();');
  assert.equal(h.run('state.runtime.overlay.screenId'),'judging');
  assert.equal(h.run('state.runtime.insertions.length'),1);
  h.run('returnToPrevious();');
  assert.equal(h.run('currentQuestion().id'),'R');
  assert.equal(h.run('state.timer.running'),false);
  assert.deepEqual(h.json('normalizeState(JSON.parse(JSON.stringify(state)))'),h.json('state'));
});

test('runtime fields never enter projector payload in question, reserve, overlay or locked modes',()=>{
  const h=fixture();
  h.run(`state.questions.forEach(q=>Object.assign(q,{acceptedAnswers:'SECRET',judgeNote:'SECRET',author:'SECRET',note:'SECRET'})); runtimeLog(state,'private','SECRET');`);
  for(const code of ['toggleAnswer()','useReserve("R","immediate")','showImmediateScreen("judging")','publishPublicState({locked:true})']) {
    h.run(code);
    const payload=h.json('buildPublicState()');
    assert.ok(!JSON.stringify(payload).includes('SECRET'));
    for(const field of ['runtime','runSettings','reserveUses','logs','insertions']) assert.ok(!(field in payload));
  }
});

test('quota failures roll back timers, navigation, logs, return snapshots and reserve insertion',()=>{
  const h=fixture();
  h.run('localStorage.setItem=()=>{throw new Error("quota")}; before=JSON.stringify(state);');
  for (const code of ['startTimer()','showImmediateScreen("judging")','useReserve("R","insert")','goSequence(2,true)','setManualTimer(12)']) {
    h.run(code);
    assert.equal(h.run('JSON.stringify(state)'),h.run('before'));
  }
});

test('construction edits are blocked while anchored runtime entries exist; clearing retains logs',()=>{
  const h=fixture();
  const before=h.json('state.sequence');
  h.run('useReserve("R","insert"); editSequence(0,"remove"); appendSequence("screen","judging");');
  assert.deepEqual(h.json('state.sequence'),before);
  h.run('clearInterventions();');
  assert.equal(h.run('state.runtime.insertions.length'),0);
  assert.equal(h.run('state.runtime.reserveUses.length'),1);
  assert.ok(h.run('state.runtime.logs.length')>0);
});

test('event clock and round progress are derived without affecting projector state',()=>{
  const h=fixture();
  h.run(`state.runSettings={eventDate:'2026-10-23',startTime:'15:50',endTime:'17:30',safetyLock:true};`);
  const clock=h.json('eventClock(state,new Date("2026-10-23T16:00:00").getTime())');
  assert.equal(clock.elapsed,600);
  assert.equal(clock.remaining,5400);
  h.run('goSequence(2);');
  assert.deepEqual(h.json('roundProgress(state).main1'),{passed:1,total:2});
  h.run('state.runSettings.startTime="23:00"; state.runSettings.endTime="01:00";');
  assert.equal(h.run('eventClock(state,new Date("2026-10-24T00:00:00").getTime()).remaining'),3600);
});

test('deleted active reserve reference fails safely and can continue',()=>{
  const h=fixture();
  h.run('useReserve("R","insert"); handleAction("next"); deleteQuestion("R");');
  assert.equal(h.run('currentQuestion()'),null);
  assert.equal(h.run('state.displayMode'),'screen');
  h.run('handleAction("next");');
  assert.equal(h.run('currentQuestion().id'),'Q2');
});

test('emergency interrupting an immediate reserve returns to that reserve before original question',()=>{
  const h=fixture();
  h.run('useReserve("R","immediate"); setManualTimer(17); showImmediateScreen("judging"); returnToPrevious();');
  assert.equal(h.run('currentQuestion().id'),'R');
  assert.equal(h.run('state.timer.remaining'),17);
  h.run('returnToPrevious();');
  assert.equal(h.run('currentQuestion().id'),'Q1');
});

test('expired timer on reload is recorded once, and invalid calendar dates normalize safely',()=>{
  const h=fixture();
  h.run('startTimer(); state.timer.endAt=Date.now()-100; state.runSettings.eventDate="2026-99-99"; state=normalizeState(state); state=normalizeState(state);');
  assert.equal(h.run('state.runtime.logs.filter(row=>row.type==="timer-end").length'),1);
  assert.equal(h.run('state.runSettings.eventDate'),'2026-10-23');
  assert.equal(h.run('validEventDate("2026-02-30")'),false);
});

test('timer expiry does not rerender away settings and screen-editor drafts',()=>{
  const h=fixture();
  h.run('renders=0; render=()=>{renders++}; startTimer(); state.tab="settings"; renders=0; state.timer.endAt=Date.now()-10; refreshTimerDom();');
  assert.equal(h.run('renders'),0);
  h.run('state.tab="live"; startTimer(); modal={type:"screen",screen:{id:"opening"}}; renders=0; state.timer.endAt=Date.now()-10; refreshTimerDom();');
  assert.equal(h.run('renders'),0);
});

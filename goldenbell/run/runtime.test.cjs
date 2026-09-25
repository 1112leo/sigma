const assert = require('node:assert/strict');
const test = require('node:test');
const createHarness = require('./test-harness.cjs');

function fixture() {
  const h=createHarness();
  h.run(`state.questions=[migrateQuestion({id:'Q1',question:'첫 문제',answer:'첫 답',timeLimit:30,round:'main1'}),migrateQuestion({id:'Q2',question:'두 번째',answer:'둘',timeLimit:40,round:'main2'}),migrateQuestion({id:'R',question:'예비 문제',answer:'예비답',timeLimit:15,round:'main1',usageStatus:'reserve'})]; state.sequence=[{type:'screen',screenId:'opening'},{type:'question',questionId:'Q1'},{type:'question',questionId:'Q2'},{type:'question',questionId:'Q1'},{type:'screen',screenId:'end'}]; activateSequence(state,1);`);
  return h;
}





test('old interventions are retired on reload without changing questions or configured order',()=>{
  const h=fixture();
  const questions=h.json('state.questions'), sequence=h.json('state.sequence');
  h.run(`state.runtime.insertions=[{id:'legacy',questionId:'R',afterIndex:1}];state.runtime.currentInsertionId='legacy';state.runtime.overlay={type:'screen',screenId:'opening'};state.runtime.returns=[{kind:'override',sequenceIndex:1,remaining:12}];saveState();state=loadPrivateState();`);
  assert.deepEqual(h.json('state.questions'),questions);
  assert.deepEqual(h.json('state.sequence'),sequence);
  assert.equal(h.run('state.runtime.overlay'),null);
  assert.equal(h.run('state.runtime.currentInsertionId'),null);
  assert.equal(h.run('state.runtime.insertions.length'),0);
  assert.equal(h.run('state.runtime.returns.length'),0);
  assert.equal(h.run('state.sequenceIndex'),0);
  h.run('handleAction("next");');
  assert.equal(h.run('currentQuestion().id'),'Q1');
  h.run('appendSequence("screen","judging");');
  assert.equal(h.run('state.sequence.length'),sequence.length+1);
  h.run('goSequence(2,true);saveState();state=loadPrivateState();');
  assert.equal(h.run('state.runtime.returns.length'),0);
  for(const view of ['renderLive()','renderSequence()','renderPreparation()']) {
    assert.doesNotMatch(h.run(view),/임시 진행|임시 삽입|복귀/);
  }
});

test('timer manual bounds and running adjustment cap do not create detailed expiry logs',()=>{
  const h=fixture();
  for (const value of ['bad','',-1,601,0.5,null,true]) h.run(`setManualTimer(${JSON.stringify(value)});`);
  assert.equal(h.run('state.timer.remaining'),30);
  h.run('setManualTimer(600); startTimer(); adjustTimer(5);');
  assert.ok(h.run('getTimerRemaining()')<=600);
  h.run('state.timer.endAt=Date.now()-100; refreshTimerDom(); refreshTimerDom();');
  assert.equal(h.run('state.timer.remaining'),0);
  assert.equal(h.run('state.runtime.logs.filter(row=>row.type==="timer-end").length'),0);
  h.run('setManualTimer(0);');
  assert.equal(h.run('state.timer.running'),false);
});

test('only core events are logged during a started run, never during rehearsal', () => {
  const h=fixture();
  h.run(`startTimer();pauseTimer();goSequence(2);toggleAnswer();`);
  assert.equal(h.run('state.runtime.logs.length'),0);
  h.run(`goSequence(1);startRun();startTimer();pauseTimer();toggleAnswer();goSequence(2);finishRun();`);
  assert.deepEqual(h.json('state.runtime.logs.map(row=>row.type)'), ['run-start','timer-start','answer-reveal','sequence-move','run-end']);
  h.run(`state=loadPrivateState();`);
  assert.deepEqual(h.json('state.runtime.logs.map(row=>row.type)'), ['run-start','timer-start','answer-reveal','sequence-move','run-end']);
  h.run(`runtimeLog(state,'timer-end','old');runtimeLog(state,'screen','old');`);
  assert.equal(h.run('state.runtime.logs.length'),5);
  h.run(`handleAction('clear-logs');`);
  assert.equal(h.run('state.runtime.logs.length'),0);
});


test('runtime fields never enter projector payload in question, reserve, overlay or locked modes',()=>{
  const h=fixture();
  h.run(`state.questions.forEach(q=>Object.assign(q,{acceptedAnswers:'SECRET',judgeNote:'SECRET',author:'SECRET',note:'SECRET'})); runtimeLog(state,'private','SECRET');`);
  for(const code of ['toggleAnswer()','goSequence(0)','publishPublicState({locked:true})']) {
    h.run(code);
    const payload=h.json('buildPublicState()');
    assert.ok(!JSON.stringify(payload).includes('SECRET'));
    for(const field of ['runtime','runSettings','reserveUses','logs','insertions']) assert.ok(!(field in payload));
  }
});

test('quota failures roll back timers, navigation, logs, return snapshots and reserve insertion',()=>{
  const h=fixture();
  h.run('localStorage.setItem=()=>{throw new Error("quota")}; before=JSON.stringify(state);');
  for (const code of ['startTimer()','goSequence(2,true)','setManualTimer(12)']) {
    h.run(code);
    assert.equal(h.run('JSON.stringify(state)'),h.run('before'));
  }
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



test('expired timer on reload stays stopped without a detailed log, and invalid dates normalize',()=>{
  const h=fixture();
  h.run('startTimer(); state.timer.endAt=Date.now()-100; state.runSettings.eventDate="2026-99-99"; state=normalizeState(state); state=normalizeState(state);');
  assert.equal(h.run('state.runtime.logs.filter(row=>row.type==="timer-end").length'),0);
  assert.equal(h.run('state.runSettings.eventDate'),'2026-10-30');
  assert.equal(h.run('validEventDate("2026-02-30")'),false);
});

test('timer expiry does not rerender away settings and screen-editor drafts',()=>{
  const h=fixture();
  h.run('renders=0; render=()=>{renders++}; startTimer(); state.tab="settings"; renders=0; state.timer.endAt=Date.now()-10; refreshTimerDom();');
  assert.equal(h.run('renders'),0);
  h.run('state.tab="live"; startTimer(); modal={type:"screen",screen:{id:"opening"}}; renders=0; state.timer.endAt=Date.now()-10; refreshTimerDom();');
  assert.equal(h.run('renders'),0);
});

test('expiry during ticker setup leaves exactly one interval',()=>{
  const h=fixture();
  h.run('activeIntervals=new Set(); intervalSerial=0; setInterval=()=>{const id=++intervalSerial;activeIntervals.add(id);return id}; clearInterval=id=>activeIntervals.delete(id); startTimer(); state.timer.endAt=Date.now()-10; syncTicker();');
  assert.equal(h.run('activeIntervals.size'),1);
  assert.equal(h.run('state.runtime.logs.filter(row=>row.type==="timer-end").length'),0);
});

test('safety lock cancels premature answer and running reset without changing state',()=>{
  const h=fixture();
  h.run('startTimer(); before=JSON.stringify(state); confirm=()=>false; toggleAnswer(); resetTimer();');
  assert.equal(h.run('JSON.stringify(state)'),h.run('before'));
  h.run('confirm=()=>true; toggleAnswer();');
  assert.equal(h.run('state.answerVisible'),true);
  assert.equal(h.run('state.timer.running'),false);
  h.run('startTimer();');
  assert.equal(h.run('state.timer.running'),false);
  h.run('toggleAnswer(); startTimer(); state.runSettings.safetyLock=false; confirm=()=>false; resetTimer();');
  assert.equal(h.run('state.timer.running'),true);
  h.run('toggleAnswer();');
  assert.equal(h.run('state.answerVisible'),false);
});

test('legacy safety OFF normalizes to mandatory safety and settings have no toggle',()=>{
  const h=fixture();
  h.run('state.runSettings.safetyLock=false; state=normalizeState(state);');
  assert.equal(h.run('state.runSettings.safetyLock'),true);
  assert.doesNotMatch(h.run('renderRunSettings()'), /id="run-safety"/);
  for(const [id,value] of Object.entries({'run-date':'2026-10-30','run-start':'15:50','run-end':'17:30'})) h.fields[id]={value};
  h.run('saveRunSettings();state=loadPrivateState();');
  assert.equal(h.run('state.runSettings.safetyLock'),true);
});

test('IME composition never changes slides or closes the question editor; active work warns on closing',()=>{
  const h=fixture();
  h.run('state.tab="live"; modal={type:"question",question:{}};');
  for(const listener of h.listeners.keydown) listener({key:'Escape',isComposing:true});
  assert.ok(h.run('modal'));
  let prevented=false;
  h.listeners.beforeunload[0]({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  h.run('modal=null;');
  h.listeners.keydown[0]({key:'ArrowRight',isComposing:true,preventDefault(){}});
  assert.equal(h.run('state.sequenceIndex'),1);
  prevented=false;
  h.listeners.beforeunload[0]({preventDefault(){prevented=true;}});
  assert.equal(prevented,false);
});

test('storage quota cannot suppress live delivery or locked projector state; reconnect is session-scoped',()=>{
  const messages=[];
  let receive;
  const h=createHarness({BroadcastChannel:class {
    postMessage(message){messages.push(structuredClone(message));}
    addEventListener(name,callback){receive=callback;}
  }});
  h.run(`state.questions=[migrateQuestion({id:'Q',question:'問題',answer:'ANSWER',note:'PRIVATE'})];state.sequence=[{type:'question',questionId:'Q'}];activateSequence(state,0);toggleAnswer();`);
  const session=h.run('getProjectorSessionId()');
  messages.length=0;
  h.run('localStorage.setItem=()=>{throw new Error("quota")};');
  assert.equal(h.run('publishPublicState()'),true);
  assert.equal(h.storage.has('sigma-goldenbell-public-v2'),false);
  assert.equal(messages.length,1);
  assert.ok(!JSON.stringify(messages).includes('PRIVATE'));
  receive({data:{type:'request-public-state',sessionId:'wrong'}});
  assert.equal(messages.length,1);
  receive({data:{type:'request-public-state',sessionId:session}});
  assert.equal(messages.length,2);
  h.run('lockConsole();');
  assert.equal(messages.at(-1).state.question,null);
  assert.equal(messages.at(-1).state.answerVisible,false);
  const count=messages.length;
  receive({data:{type:'request-public-state',sessionId:session}});
  assert.equal(messages.length,count);
});

test('question group jumps follow configured order after continuing and reloading without return frames',()=>{
  const h=fixture();
  h.run(`state.questions.push(migrateQuestion({id:'H',category:'hard',question:'고난도',answer:'답'}),migrateQuestion({id:'V1',category:'basic',round:'revival1',question:'부활1',answer:'답'}),migrateQuestion({id:'V2',category:'hard',round:'revival2',question:'부활2',answer:'답'}),migrateQuestion({id:'F',category:'basic',round:'final',question:'결정전',answer:'답'}));state.sequence.push(...['H','V1','V2','F'].map(questionId=>({type:'question',questionId})));goSequence(3);setManualTimer(11);`);
  assert.deepEqual(h.json(`navigationItems('revival').map(row=>row.question.id)`),['V1','V2']);
  assert.deepEqual(h.json(`navigationItems('hard').map(row=>row.question.id)`),['H']);
  assert.deepEqual(h.json(`navigationItems('final').map(row=>row.question.id)`),['F']);
  const sequence=h.json('state.sequence');
  h.run(`jumpQuestionGroup('revival',navigationItems('revival')[0].position);handleAction('next');saveState();state=loadPrivateState();`);
  assert.equal(h.run('currentQuestion().id'),'V2');
  assert.equal(h.run('state.runtime.returns.length'),0);
  assert.equal(h.run('state.runtime.overlay'),null);
  assert.equal(h.run('state.timer.running'),false);
  assert.deepEqual(h.json('state.sequence'),sequence);
  h.run(`startTimer();before=JSON.stringify(state);confirm=()=>false;jumpQuestionGroup('final',navigationItems('final')[0].position);`);
  assert.equal(h.run('JSON.stringify(state)'),h.run('before'));
  h.run(`confirm=()=>true;localStorage.setItem=()=>{throw Error('quota')};jumpQuestionGroup('hard',navigationItems('hard')[0].position);`);
  assert.equal(h.run('JSON.stringify(state)'),h.run('before'));
});

test('revised date migrates former defaults, preserves deliberate custom/blank copy, and event clock is opt-in',()=>{
  const h=fixture();
  h.run(`state.event.date='2026.10.23(금) 15:50~17:30';state.runSettings.eventDate='2026-10-23';state=normalizeState(state);`);
  assert.equal(h.run('state.event.date'),'2026.10.30(금)');
  assert.equal(h.run('state.runSettings.eventDate'),'2026-10-30');
  assert.ok(!h.run('renderEventStatus()').includes('data-event-elapsed'));
  h.run('state.runSettings.showEventClock=true;state=normalizeState(state);');
  assert.ok(h.run('renderEventStatus()').includes('data-event-elapsed'));
  for(const date of ['', '별도 행사 2026.11.01']) {
    h.run(`state.event.date=${JSON.stringify(date)};state=normalizeState(state);`);
    assert.equal(h.run('state.event.date'),date);
  }
});

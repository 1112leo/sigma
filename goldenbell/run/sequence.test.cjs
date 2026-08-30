const assert = require('node:assert/strict');
const test = require('node:test');
const createHarness = require('./test-harness.cjs');

function fixture() {
  const h = createHarness();
  h.run(`state.questions=[migrateQuestion({id:'Q1',question:'질문1',answer:'답1',timeLimit:21,round:'main1'}),migrateQuestion({id:'Q2',question:'질문2',answer:'답2',timeLimit:42,round:'revival1'})]; state.sequence=[{type:'screen',screenId:'opening'},{type:'question',questionId:'Q1'},{type:'question',questionId:'Q2'},{type:'screen',screenId:'judging'},{type:'question',questionId:'Q1'}]; activateSequence(state,0);`);
  return h;
}

test('sequence transitions reset answer/timer; screens cannot reveal or start the previous question', () => {
  const h=fixture();
  h.run('goSequence(1); toggleAnswer(); startTimer(); goSequence(2);');
  assert.equal(h.run('currentQuestion().id'),'Q2');
  assert.equal(h.run('state.timer.remaining'),42);
  assert.equal(h.run('state.answerVisible'),false);
  h.run('goSequence(3); startTimer(); toggleAnswer(); resetTimer(); adjustTimer(5);');
  assert.equal(h.run('state.displayMode'),'screen');
  assert.equal(h.run('currentQuestion()'),null);
  assert.equal(h.run('state.timer.running'),false);
  assert.equal(h.run('state.timer.remaining'),0);
  assert.ok(!h.run('renderLive()').includes('data-action="timer-toggle"'));
  h.run('goSequence(4); handleAction("prev");');
  assert.equal(h.run('state.sequenceIndex'),3);
  h.run('handleAction("next");');
  assert.equal(h.run('currentQuestion().id'),'Q1');
});

test('auto sequence excludes reserve/disabled and inserts round screens without fixed question counts', () => {
  const h=fixture();
  h.run(`state.questions.push(migrateQuestion({id:'R',usageStatus:'reserve'}),migrateQuestion({id:'D',usageStatus:'disabled'})); generated=buildAutoSequence(state.questions);`);
  assert.deepEqual(h.json('generated.filter(i=>i.type==="question").map(i=>i.questionId)'),['Q1','Q2']);
  assert.equal(h.run('generated.findIndex(i=>i.screenId==="revival1-start")+1'),h.run('generated.findIndex(i=>i.questionId==="Q2")'));
});

test('reload/backup retains exact duplicate occurrence, custom screen edits and blank values', () => {
  const h=fixture();
  h.run(`goSequence(4); state.customScreens[0].title=''; state.messages.lobby=''; state.customScreens[0].subtitle=''; state.customScreens[0].description='직접 수정'; saveState(); before=JSON.stringify(state); state=loadPrivateState();`);
  assert.deepEqual(h.json('state'),JSON.parse(h.run('before')));
  assert.equal(h.run('state.sequenceIndex'),4);
  assert.equal(h.run('state.customScreens[0].title'),'');
  assert.deepEqual(h.json('normalizeState(JSON.parse(JSON.stringify(state)))'),h.json('state'));
});

test('legacy migration maps current question and standby and preserves an intentionally empty sequence', () => {
  const h=fixture();
  h.run(`legacy={questions:state.questions,currentIndex:1,displayMode:'question',messages:{tagline:'',break:''}}; migrated=normalizeState(legacy);`);
  assert.equal(h.run('migrated.sequence[migrated.sequenceIndex].questionId'),'Q2');
  h.run(`legacy.displayMode='break'; migrated=normalizeState(legacy);`);
  assert.equal(h.run('migrated.sequence[migrated.sequenceIndex].screenId'),'standby');
  assert.equal(h.run('migrated.customScreens.find(s=>s.id==="standby").title'),'');
  h.run('state.sequence=[]; state=normalizeState(state);');
  assert.equal(h.run('state.sequence.length'),0);
  assert.equal(h.run('state.sequenceIndex'),-1);
  assert.equal(h.run('state.displayMode'),'screen');
});

test('missing references show a safe screen and remain in data for correction', () => {
  const h=fixture();
  h.run(`state.sequence.unshift({type:'question',questionId:'MISSING'},{type:'screen',screenId:'MISSING'}); goSequence(0);`);
  assert.equal(h.run('currentQuestion()'),null);
  assert.equal(h.json('buildPublicState()').timer,null);
  assert.ok(h.run('renderPreview()').includes('구성 항목을 찾을 수 없습니다'));
  h.run('goSequence(1); state=normalizeState(state);');
  assert.equal(h.run('state.sequence[1].screenId'),'MISSING');
  h.run('goSequence(3);');
  assert.equal(h.run('currentQuestion().id'),'Q1');
});

test('editing order retains exact active occurrence and never rewrites question IDs', () => {
  const h=fixture();
  h.run('goSequence(4); state.timer.remaining=11; state.answerVisible=true; editSequence(4,"up");');
  assert.equal(h.run('state.sequenceIndex'),3);
  assert.equal(h.run('state.timer.remaining'),11);
  assert.equal(h.run('state.answerVisible'),true);
  h.run('editSequence(0,"remove");');
  assert.equal(h.run('state.sequenceIndex'),2);
  h.run('before=JSON.stringify(state.sequence); moveQuestion("Q1",1);');
  assert.equal(h.run('JSON.stringify(state.sequence)'),h.run('before'));
  assert.equal(h.run('currentQuestion().id'),'Q1');
  h.run('editSequence(2,"remove");');
  assert.equal(h.run('state.displayMode'),'screen');
  assert.equal(h.run('state.answerVisible'),false);
});

test('screen payload whitelist excludes questions, timer, next items and private metadata', () => {
  const h=fixture();
  h.run(`Object.assign(state.customScreens[1],{judgeNote:'SECRET',author:'SECRET'}); state.questions[0].acceptedAnswers='SECRET';`);
  const payload=h.json('buildPublicState()');
  assert.equal(payload.question,null);
  assert.equal(payload.timer,null);
  assert.ok(!('sequence' in payload));
  assert.ok(!JSON.stringify(payload).includes('SECRET'));
  assert.deepEqual(Object.keys(payload.screen).sort(),['title','subtitle','description','emphasis','style'].sort());
});

test('keyboard navigation moves sequence, A reveals, inputs/contenteditable ignore shortcuts', () => {
  const h=fixture();
  const press=(key,code=key)=>h.listeners.keydown[0]({key,code,preventDefault(){}});
  press('ArrowRight');
  assert.equal(h.run('state.sequenceIndex'),1);
  press('a');
  assert.equal(h.run('state.answerVisible'),true);
  press('ArrowRight');
  assert.equal(h.run('state.sequenceIndex'),2);
  assert.equal(h.run('state.answerVisible'),false);
  h.context.document.activeElement={tagName:'INPUT'};
  press('ArrowLeft');
  assert.equal(h.run('state.sequenceIndex'),2);
  h.context.document.activeElement={tagName:'DIV',isContentEditable:true};
  press('ArrowLeft');
  assert.equal(h.run('state.sequenceIndex'),2);
});

test('failed sequence writes rollback position and timer', () => {
  const h=fixture();
  h.run('goSequence(1); before=JSON.stringify(state); localStorage.setItem=()=>{throw new Error("quota")}; goSequence(2);');
  assert.equal(h.run('JSON.stringify(state)'),h.run('before'));
});

test('screen editor saves empty fields and keeps legacy settings synchronized', () => {
  const h=fixture();
  for (const key of ['title','subtitle','description','emphasis']) h.fields[`screen-${key}`]={value:''};
  h.fields['screen-style']={value:'gold'};
  h.run('openScreenEditor("opening"); saveScreen(); state=loadPrivateState();');
  assert.equal(h.run('state.messages.opening'),'');
  assert.equal(h.run('currentScreen().title'),'');
  assert.equal(h.run('currentScreen().subtitle'),'');
});

test('long legacy rules stay intact through screen edits while projection stays bounded', () => {
  const h=fixture();
  const rules='안'.repeat(1500);
  h.run(`state.messages.rules=${JSON.stringify(rules)}; state.customScreens.find(s=>s.id==='rules').description=state.messages.rules; state=normalizeState(state);`);
  for (const key of ['title','subtitle','emphasis']) h.fields[`screen-${key}`]={value:''};
  h.fields['screen-description']={value:rules};
  h.fields['screen-style']={value:'blue'};
  h.run('openScreenEditor("rules"); saveScreen(); state=loadPrivateState();');
  assert.equal(h.run('state.messages.rules.length'),1500);
  assert.equal(h.run('state.customScreens.find(s=>s.id==="rules").description.length'),1500);
  assert.equal(h.run('publicScreen(state.customScreens.find(s=>s.id==="rules")).description.length'),1200);
});

test('projector and preview number duplicate and reordered questions identically', () => {
  const h=fixture();
  h.run(`state.sequence=[{type:'question',questionId:'Q2'},{type:'question',questionId:'Q1'},{type:'question',questionId:'Q1'}]; goSequence(0);`);
  assert.ok(h.run('renderPreview()').includes('1 / 3'));
  assert.equal(h.run('buildPublicState().currentIndex'),0);
  assert.equal(h.run('buildPublicState().totalQuestions'),3);
});

test('screen limit accounts for built-ins and cannot produce a backup that rejects itself', () => {
  const h=fixture();
  assert.throws(()=>h.run('normalizeState({questions:[],sequence:[],customScreens:Array.from({length:200},(_,i)=>({id:"custom-"+i}))})'),/sequence-limit/);
  h.run('nearLimit=normalizeState({questions:[],sequence:[],customScreens:Array.from({length:186},(_,i)=>({id:"custom-"+i}))});');
  assert.equal(h.run('nearLimit.customScreens.length'),200);
  assert.deepEqual(h.json('normalizeState(nearLimit)'),h.json('nearLimit'));
});

test('migration preserves an already-presented reserve question without adding others', () => {
  const h=fixture();
  h.run(`legacy=normalizeState({schemaVersion:1,questions:[migrateQuestion({id:'R1',usageStatus:'reserve'}),migrateQuestion({id:'R2',usageStatus:'reserve'})],currentIndex:0,displayMode:'question',timer:{remaining:18,running:false,endAt:null}});`);
  assert.equal(h.run('legacy.sequence[legacy.sequenceIndex].questionId'),'R1');
  assert.equal(h.run('legacy.timer.remaining'),18);
  assert.ok(!h.run('legacy.sequence.some(i=>i.questionId==="R2")'));
});

test('locking a full sequence blanks the projector without mutating the event construction', () => {
  const h=fixture();
  h.run('state.sequence=Array.from({length:2000},()=>({type:"question",questionId:"Q1"})); goSequence(1999); toggleAnswer(); lockConsole(); state=loadPrivateState();');
  assert.equal(h.run('state.sequence.length'),2000);
  assert.equal(h.run('state.sequenceIndex'),1999);
  assert.equal(h.run('persistenceBlocked'),false);
  const payload=JSON.parse(h.storage.get(h.run('PUBLIC_STORAGE_KEY')));
  assert.equal(payload.displayMode,'screen');
  assert.equal(payload.question,null);
  assert.equal(payload.answerVisible,false);
});

test('imported built-in screen content also populates the legacy settings editor', () => {
  const h=fixture();
  h.run('state=normalizeState({...state,customScreens:[{id:"opening",title:"CUSTOM",subtitle:"",description:"",emphasis:"",style:"gold"}]});');
  assert.equal(h.run('state.messages.opening'),'CUSTOM');
  assert.ok(h.run('renderSettings()').includes('value="CUSTOM"'));
});

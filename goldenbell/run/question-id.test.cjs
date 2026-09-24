const test=require('node:test');
const assert=require('node:assert/strict');
const harness=require('./test-harness.cjs');

function fixture(){
 const h=harness();
 h.run(`state.questions=[migrateQuestion({id:'Q1',question:'문제',answer:'1'}),migrateQuestion({id:'Q2',question:'다른 문제',answer:'2'})];state.sequence=[{type:'question',questionId:'Q1'},{type:'question',questionId:'Q2'},{type:'question',questionId:'Q1'}];activateSequence(state,2);startRun();state.timer.remaining=17;state.runtime.run.completed=[0];state.runtime.mainResume={index:0,questionId:'Q1',remaining:12};state.answerVisible=true;openQuestion('Q1');`);
 return h;
}

test('renaming updates all occurrences and bookmark without losing progress, timer or answer state',()=>{
 const h=fixture();
 h.fields['q-id']={value:'  일반-01  '};
 h.run('saveQuestion();state=loadPrivateState();');
 assert.deepEqual(h.json('state.sequence.map(item=>item.questionId)'),['일반-01','Q2','일반-01']);
 assert.equal(h.run('currentQuestion().id'),'일반-01');
 assert.equal(h.run('state.sequenceIndex'),2);
 assert.equal(h.run('state.timer.remaining'),17);
 assert.equal(h.run('state.answerVisible'),true);
 assert.equal(h.run('state.runtime.run.active'),true);
 assert.deepEqual(h.json('state.runtime.run.completed'),[0]);
 assert.equal(h.run('state.runtime.mainResume.questionId'),'일반-01');
 assert.equal(h.run('state.runtime.run.signature'),h.run('JSON.stringify(state.sequence)'));
});

test('duplicate, blank, too-long and stale source IDs do not mutate any saved state',()=>{
 for(const value of ['Q2',' ','x'.repeat(201)]) {
  const h=fixture(); const before=h.json('state');
  h.fields['q-id']={value}; h.run('saveQuestion();');
  assert.deepEqual(h.json('state'),before);
  assert.equal(h.run('modal.question.id'),'Q1');
 }
 const h=fixture(); h.fields['q-id']={value:'NEW'};
 h.run("state.questions=state.questions.filter(q=>q.id!=='Q1');before=JSON.stringify(state);saveQuestion();");
 assert.equal(h.run('JSON.stringify(state)'),h.run('before'));
});

test('rename quota failure rolls back all references and preserves the typed ID through rerenders',()=>{
 const h=fixture(); const before=h.json('state');
 h.fields['q-id']={value:'RETRY'};
 h.run(`captureQuestionDraft();localStorage.setItem=()=>{throw Error('quota')};saveQuestion();`);
 assert.deepEqual(h.json('state'),before);
 assert.equal(h.run('modal.editedId'),'RETRY');
 assert.match(h.run('renderModal()'),/value="RETRY"/);
 assert.equal(h.run('modal.question.id'),'Q1');
});

test('new questions accept custom IDs or generate an ID when blank; existing questions are never overwritten',()=>{
 const h=harness(); h.run('state.questions=[];state.sequence=[];openQuestion();');
 h.fields['q-id']={value:'CUSTOM'};h.run('saveQuestion();');
 assert.equal(h.run('state.questions[0].id'),'CUSTOM');
 h.run('openQuestion();saveQuestion();');
 assert.equal(h.run('state.questions.length'),1);
 h.fields['q-id'].value='';h.run('saveQuestion();');
 assert.equal(h.run('state.questions.length'),2);
 assert.ok(h.run('state.questions[1].id'));
 assert.notEqual(h.run('state.questions[1].id'),'CUSTOM');
});

test('legacy reference-bearing runtime records are renamed atomically too',()=>{
 const h=fixture();
 h.run(`state.runtime.insertions=[{id:'I',questionId:'Q1',afterIndex:0}];state.runtime.overlay={type:'question',questionId:'Q1'};state.runtime.returns=[{overlay:{type:'question',questionId:'Q1'}}];state.runtime.invalidQuestions=[{questionId:'Q1'}];state.runtime.reserveUses=[{questionId:'Q1'}];`);
 h.fields['q-id']={value:'NEW'};h.run('saveQuestion();');
 for(const path of ['insertions[0]','overlay','returns[0].overlay','invalidQuestions[0]','reserveUses[0]']) assert.equal(h.run('state.runtime.'+path+'.questionId'),'NEW');
});

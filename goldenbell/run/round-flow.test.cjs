const test=require('node:test');
const assert=require('node:assert/strict');
const harness=require('./test-harness.cjs');
test('revival and basic follow-up finish as one block before returning to the next main question',()=>{
  for(const inline of [false,true]) {
    const h=harness();
    h.context.inline=inline;
    h.run(`state.questions=[
      migrateQuestion({id:'M3',question:'3번',answer:'1'}),
      migrateQuestion({id:'M40',question:'40번',answer:'2'}),
      migrateQuestion({id:'V42',category:'revival',question:'패자1',answer:'3'}),
      migrateQuestion({id:'F9',question:'9번',answer:'4'})
    ];const block=[{type:'screen',screenId:'revival1-start'},{type:'question',questionId:'V42'},{type:'question',questionId:'F9'},{type:'screen',screenId:'main-resume'}];
    state.sequence=[{type:'question',questionId:'M3'},...(inline?block:[]),{type:'question',questionId:'M40'},...(!inline?block:[]),{type:'screen',screenId:'end'}];
    ensureRequiredRoundScreens(state.sequence,state.questions);activateSequence(state,0);startRun();toggleAnswer();
    startSpecialRound(state.sequence.findIndex(item=>item.screenId==='revival1-start'));advancePresentation();`);
    assert.equal(h.run('currentQuestion().id'),'V42');
    h.run('toggleAnswer();advancePresentation()');
    assert.equal(h.run('currentQuestion().id'),'F9');
    assert.equal(h.run('buildPublicState().question.title'),'02번');
    h.run('toggleAnswer();advancePresentation()');
    assert.equal(h.run('currentQuestion().id'),'M40');
    assert.equal(h.run('buildPublicState().question.title'),'02번');
    assert.equal(h.run('buildPublicState().totalQuestions'),2);
    assert.equal(h.run('state.questions.find(q=>q.id==="F9").category'),'basic');
    h.run('saveState();state=loadPrivateState()');
    assert.equal(h.run('currentQuestion().id'),'M40');
  }
});
test('each special round starts on its own intro and resumes the exact main occurrence after reload and reorder',()=>{
  const h=harness();
  h.run(`state.questions=[migrateQuestion({id:'M',question:'본게임',answer:'1'}),migrateQuestion({id:'V',question:'부활',answer:'2',round:'revival1'})];state.sequence=[{type:'question',questionId:'M'},{type:'screen',screenId:'revival1-start'},{type:'question',questionId:'V'},{type:'screen',screenId:'revival2-start'},{type:'question',questionId:'V'},{type:'screen',screenId:'final-start'},{type:'question',questionId:'V'},{type:'question',questionId:'M'}];activateSequence(state,7);setManualTimer(17);`);
  for(const [position,id] of [[1,'revival1-start'],[3,'revival2-start'],[5,'final-start']]) {
    h.run(`startSpecialRound(${position});`);
    assert.equal(h.run('activeItem(state).screenId'),id);
    h.run('advancePresentation();saveState();state=loadPrivateState();resumeMain();');
    assert.equal(h.run('state.sequenceIndex'),7);
    assert.equal(h.run('state.timer.remaining'),17);
    assert.equal(h.run('state.timer.running'),false);
  }
  h.run('startSpecialRound(1);moveSequence(7,0);resumeMain();');
  assert.equal(h.run('state.sequenceIndex'),0);
  assert.equal(h.run('state.timer.remaining'),17);
  assert.match(h.run('renderSequence()'),/draggable="true"/);
});
test('drag preserves active occurrence and rolls back on storage failure or safety cancellation',()=>{
  const h=harness();
  h.run(`state.sequence=[{type:'screen',screenId:'waiting'},{type:'screen',screenId:'rules'},{type:'screen',screenId:'end'}];activateSequence(state,1);moveSequence(0,2);`);
  assert.equal(h.run('state.sequenceIndex'),0);
  assert.equal(h.run('activeItem(state).screenId'),'rules');
  h.run(`before=JSON.stringify(state);localStorage.setItem=()=>{throw Error('quota')};moveSequence(0,2);`);
  assert.equal(h.run('JSON.stringify(state)'),h.run('before'));
});

const test=require('node:test');
const assert=require('node:assert/strict');
const harness=require('./test-harness.cjs');
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

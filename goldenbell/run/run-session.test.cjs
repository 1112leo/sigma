const test=require('node:test');
const assert=require('node:assert/strict');
const harness=require('./test-harness.cjs');
function fixture(){const h=harness();h.run(`state.questions=[migrateQuestion({id:'M',question:'main',answer:'A',round:'main1'}),migrateQuestion({id:'V',question:'revival',answer:'A',round:'revival1'}),migrateQuestion({id:'F',question:'main follow-up',answer:'A'}),migrateQuestion({id:'H',question:'hard',answer:'A',category:'hard',round:'main2'})];state.sequence=[{type:'question',questionId:'M'},{type:'screen',screenId:'revival1-start'},{type:'question',questionId:'V'},{type:'screen',screenId:'main-resume'},{type:'question',questionId:'F'},{type:'question',questionId:'H'},{type:'screen',screenId:'end'}];ensureRequiredRoundScreens(state.sequence,state.questions);activateSequence(state,0);`);return h;}
test('slide mode never skips; started session skips completed intro and questions after returning to main',()=>{
 const h=fixture();h.run('toggleAnswer();startSpecialRound(1);advancePresentation();resumeMain();advancePresentation();');
 assert.equal(h.run('state.sequenceIndex'),1);
 assert.deepEqual(h.json('state.runtime.run.completed'),[]);
 h.run('goSequence(0);startRun();setManualTimer(17);startSpecialRound(1);advancePresentation();toggleAnswer();advancePresentation();advancePresentation();toggleAnswer();advancePresentation();');
 assert.equal(h.run('state.sequenceIndex'),0);
 assert.equal(h.run('state.timer.remaining'),17);
 assert.deepEqual(h.json('state.runtime.run.completed').sort(),[1,2,3,4]);
 h.run('toggleAnswer();advancePresentation();');
 assert.equal(h.run('state.sequenceIndex'),5);
 h.run('goSequence(1);');assert.equal(h.run('state.sequenceIndex'),1);
 h.run('finishRun();goSequence(0);advancePresentation();');assert.equal(h.run('state.sequenceIndex'),1);
});
test('answered main is not displayed again on round completion and session survives reload',()=>{
 const h=fixture();h.run('startRun();toggleAnswer();startSpecialRound(1);saveState();state=loadPrivateState();finishSpecialRound();advancePresentation();toggleAnswer();advancePresentation();');
 assert.equal(h.run('state.sequenceIndex'),5);
 assert.equal(h.run('state.runtime.run.active'),true);
 assert.ok(h.run('state.runtime.run.completed.includes(1)'));
});
test('configuration changes cancel atomically or end/reset the session, and quota failures roll back',()=>{
 const h=fixture();h.run('startRun();toggleAnswer();before=JSON.stringify(state);confirm=()=>false;moveSequence(0,4);');
 assert.equal(h.run('JSON.stringify(state)'),h.run('before'));
 h.run('confirm=()=>true;moveSequence(0,4);');
 assert.equal(h.run('state.runtime.run.active'),false);
 assert.deepEqual(h.json('state.runtime.run.completed'),[]);
 h.run('startRun();before=JSON.stringify(state);localStorage.setItem=()=>{throw Error("quota")};finishRun();');
 assert.equal(h.run('JSON.stringify(state)'),h.run('before'));
});
test('changed imported configuration cannot reuse completion indices',()=>{
 const h=fixture();h.run('startRun();toggleAnswer();state.sequence.reverse();state=normalizeState(state);');
 assert.equal(h.run('state.runtime.run.active'),false);
 assert.deepEqual(h.json('state.runtime.run.completed'),[]);
});

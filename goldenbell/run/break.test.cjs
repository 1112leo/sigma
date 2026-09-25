const test = require('node:test');
const assert = require('node:assert/strict');
const createHarness = require('./test-harness.cjs');

function fixture() {
  const h = createHarness();
  h.run(`state.questions=[migrateQuestion({id:'Q1',title:'첫 문제',question:'1+1',answer:'2',timeLimit:40})];state.sequence=[{type:'screen',screenId:'opening'},{type:'question',questionId:'Q1'},{type:'screen',screenId:'end'}];activateSequence(state,1);`);
  return h;
}

test('break pauses a question without changing its sequence position and projects standby', () => {
  const h = fixture();
  h.run(`startTimer();state.timer.endAt=Date.now()+17000;setScreenMode('break');`);
  assert.equal(h.run('state.sequenceIndex'), 1);
  assert.equal(h.run('state.runtime.break.active'), true);
  assert.equal(h.run('state.displayMode'), 'screen');
  assert.equal(h.run('state.timer.running'), false);
  assert.ok(h.run('state.runtime.break.remaining') > 16);
  assert.equal(h.run('currentScreen().title'), '잠시 쉬어갑니다');
  assert.equal(h.run('buildPublicState().screen.title'), '잠시 쉬어갑니다');
  assert.equal(h.run('buildPublicState().question'), null);
  assert.match(h.run('renderLive()'), /휴식 종료/);
});

test('break survives reload and restores answer, timer and navigation', () => {
  const h = fixture();
  h.run(`state.answerVisible=true;state.timer.remaining=19;setScreenMode('break');saveState();state=loadPrivateState();`);
  assert.equal(h.run('state.runtime.break.active'), true);
  assert.equal(h.run('buildPublicState().screen.title'), '잠시 쉬어갑니다');
  h.run(`advancePresentation();`);
  assert.equal(h.run('state.runtime.break'), null);
  assert.equal(h.run('state.sequenceIndex'), 1);
  assert.equal(h.run('currentQuestion().id'), 'Q1');
  assert.equal(h.run('state.timer.remaining'), 19);
  assert.equal(h.run('state.answerVisible'), true);
  h.run(`toggleAnswer();startTimer();pauseTimer();advancePresentation();`);
  assert.equal(h.run('state.sequenceIndex'), 2);
  h.run(`goRuntimePosition(1);`);
  assert.equal(h.run('currentQuestion().id'), 'Q1');
});

test('break works even when standby is absent from the configured sequence', () => {
  const h = fixture();
  assert.equal(h.run(`state.sequence.some(item=>item.screenId==='standby')`), false);
  h.run(`setScreenMode('break');`);
  assert.equal(h.run('state.displayMode'), 'screen');
  h.run(`setScreenMode('break');`);
  assert.equal(h.run('state.displayMode'), 'question');
});

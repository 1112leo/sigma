const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./test-harness.cjs');

function fixture() {
  const h = harness();
  h.run(`state.questions=[migrateQuestion({id:'M',title:'본게임',question:'본문',answer:'42',round:'main1'}),migrateQuestion({id:'V',title:'부활 문제',question:'본문',answer:'42',round:'revival1'})];state.sequence=[{type:'question',questionId:'M'},{type:'screen',screenId:'revival1-start'},{type:'question',questionId:'V'},{type:'screen',screenId:'end'}];activateSequence(state,0);`);
  return h;
}

test('next destination agrees with completed-slide skipping and normal slide mode', () => {
  const h=fixture();
  assert.equal(h.run('presentationNextAction().target'),1);
  h.run('startRun();state.runtime.run.completed=[1,2];');
  assert.equal(h.run('presentationNextAction().target'),3);
  assert.match(h.run('presentationNextAction().label'),/4번/);
  h.run('advancePresentation();');
  assert.equal(h.run('state.sequenceIndex'),3);
  h.run('finishRun();goSequence(0);advancePresentation();');
  assert.equal(h.run('state.sequenceIndex'),1);
});

test('round end preview matches return target including completed main questions', () => {
  for (const answered of [false,true]) {
    const h=fixture();
    h.run('startRun();setManualTimer(17);');
    if(answered) h.run('toggleAnswer();');
    h.run('startSpecialRound(1);advancePresentation();toggleAnswer();');
    const plan=h.json('presentationNextAction()');
    assert.equal(plan.kind,'round');
    assert.equal(plan.target,answered ? 3 : 0);
    h.run('advancePresentation();');
    assert.equal(h.run('state.sequenceIndex'),plan.target);
    assert.deepEqual(h.json('state.runtime.run.completed').filter(i=>i>0).sort(),[1,2]);
    if(!answered) assert.equal(h.run('state.timer.remaining'),17);
  }
});

test('last special-round question can finish, then end session with mandatory confirmation', () => {
  const h=fixture();
  h.run('state.sequence.pop();goSequence(1);startRun();advancePresentation();toggleAnswer();');
  assert.equal(h.run('presentationNextAction().kind'),'round');
  assert.doesNotMatch(h.run('renderLive()'),/data-action="next" disabled/);
  h.run('advancePresentation();');
  assert.equal(h.run('state.runtime.run.specialStart'),null);
  assert.equal(h.run('presentationNextAction().kind'),'end');
  h.run('confirm=()=>false;advancePresentation();');
  assert.equal(h.run('state.runtime.run.active'),true);
  h.run('confirm=()=>true;advancePresentation();');
  assert.equal(h.run('state.runtime.run.active'),false);
});

test('revealed answer is a clean slide, preserves math and escapes HTML', () => {
  const h=fixture();
  h.run(`state.questions[0].answer='$x^2$ <img src=x onerror=alert(1)>';state.questions[0].explanation='풀이';toggleAnswer();`);
  const html=h.run('renderScreenMarkup(buildPublicState())');
  assert.match(html,/answer-label/);
  assert.match(html,/katex/);
  assert.match(html,/&lt;img/);
  assert.match(html,/answer-explanation/);
  assert.doesNotMatch(html,/screen-question-image|screen-timer-copy|screen-progress|<img/);
  assert.match(h.run('renderLive()'),/문제로 돌아가기/);
  h.run('toggleAnswer();');
  assert.match(h.run('renderScreenMarkup(buildPublicState())'),/screen-timer-copy/);
});

test('operator guide is collapsed and expired timer guidance reflects the current state', () => {
  const h=fixture();
  assert.match(h.run('renderLive()'),/<details class="card operator-guide">/);
  h.run('state.timer={remaining:0,running:false,endAt:null};');
  assert.match(h.run('operatorHint()'),/시간이 끝났습니다/);
});

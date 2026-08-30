const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./test-harness.cjs');

test('built-in slide designs survive public serialization and preserve editable copy', () => {
  const h = harness();
  for (const [id, mode] of Object.entries({waiting:'lobby',opening:'opening',rules:'rules',standby:'break',end:'ending'})) {
    h.run(`state.displayMode='screen'; state.runtime.overlay={type:'screen',screenId:'${id}'};`);
    const screen = h.json(`publicScreen(state.customScreens.find(s=>s.id==='${id}'))`);
    assert.equal(screen.template, mode);
    const markup = h.run(`renderScreenContent(${JSON.stringify(screen)},true)`);
    assert.match(markup, new RegExp(`preview-${mode}`));
    assert.match(markup, mode === 'rules' ? /<ol>.*<li>/ : /preview-watermark/);
    h.run(`publicState={displayMode:'screen',event:{title:'행사',date:'날짜',place:'장소'},messages:{tagline:'부제'},screen:${JSON.stringify(screen)}};renderScreen();`);
    assert.match(h.app.innerHTML, new RegExp(`screen-${mode}`));
    assert.match(h.app.innerHTML, /screen-status/);
    if (mode === 'lobby') assert.match(h.app.innerHTML, /날짜 · 장소/);
    if (mode !== 'rules') assert.match(h.app.innerHTML, /screen-watermark/);
    const blank = h.run(`renderScreenContent({...${JSON.stringify(screen)},title:'',subtitle:'',description:'',emphasis:''},true)`);
    assert.match(blank, /<strong><\/strong>/);
    assert.ok(!blank.includes(screen.title));
  }
});

test('custom content, styles and safety-preserving quick slide controls remain available', () => {
  const h = harness();
  const html=h.run(`renderScreenContent({id:'opening',style:'green',title:'새 제목',subtitle:'새 부제',description:'첫 줄\\n둘째 줄',emphasis:'강조'},true)`);
  for (const copy of ['새 제목','새 부제','첫 줄','둘째 줄','강조','slide-green']) assert.ok(html.includes(copy));
  assert.equal(h.json(`publicScreen({id:'private',template:'<script>',judgeNote:'SECRET'})`).template,'');
  assert.match(h.run(`renderScreenContent({id:'custom',title:'사용자 화면',style:'gold'})`), /custom-screen-content slide-gold/);
  const before=h.json('state.sequence');
  h.run(`showImmediateScreen('opening')`);
  assert.deepEqual(h.json('state.sequence'),before);
  assert.match(h.run('renderLive()'), /mode-card/);
  assert.match(h.run('renderLive()'), /data-action="runtime-return"/);
});

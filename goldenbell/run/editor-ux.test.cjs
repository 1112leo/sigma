const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./test-harness.cjs');

test('category labels follow navigation groups, including special intros and missing references', () => {
  const h = harness();
  h.run(`state.questions=[migrateQuestion({id:'B',category:'basic'}),migrateQuestion({id:'H',category:'hard'}),migrateQuestion({id:'R',category:'hard',round:'revival2'}),migrateQuestion({id:'F',category:'basic',round:'final'})];`);
  for (const [id, kind] of [['B','basic'],['H','hard'],['R','revival'],['F','final'],['missing','missing']]) {
    assert.equal(h.run(`itemLabel({type:'question',questionId:'${id}'}).kind`),kind);
  }
  for (const [id, kind] of [['waiting','guide'],['revival1-start','revival'],['revival2-start','revival'],['final-start','final']]) {
    assert.equal(h.run(`itemLabel({type:'screen',screenId:'${id}'}).kind`),kind);
  }
});

test('insertion boundaries match every upward/downward drop, first/last and adjacent no-ops', () => {
  const h = harness();
  for(let from=0;from<6;from++) for(let hover=0;hover<6;hover++) for(const after of [false,true]) {
    const original=[0,1,2,3,4,5];
    const target=h.run(`sequenceDropIndex(${from},${hover},${after})`);
    const boundary=hover+Number(after);
    const expected=[...original.slice(0,boundary).filter(x=>x!==from),from,...original.slice(boundary).filter(x=>x!==from)];
    original.splice(target,0,original.splice(from,1)[0]);
    assert.deepEqual(original,expected);
  }
});

test('pointer handle shows exact drop line, moves item, and Escape cancels without mutation', () => {
  const h = harness();
  h.run(`state.sequence=[{type:'screen',screenId:'waiting'},{type:'screen',screenId:'rules'},{type:'screen',screenId:'end'}];activateSequence(state,1);`);
  const events = {};
  const rows = Array.from({length:3},(_,i)=>{
    const classes=new Set();
    const row={dataset:{dragSequence:String(i)},events:{},classList:{add:(...c)=>c.forEach(x=>classes.add(x)),remove:(...c)=>c.forEach(x=>classes.delete(x)),contains:c=>classes.has(c)},getBoundingClientRect:()=>({top:i*100,bottom:(i+1)*100,height:100}),addEventListener(k,f){this.events[k]=f;}};
    row.handle={events:{},closest:()=>row,setPointerCapture(){this.captured=true;},hasPointerCapture(){return this.captured;},releasePointerCapture(){this.captured=false;},addEventListener(k,f){this.events[k]=f;}};
    return row;
  });
  const list={scrollTop:0,querySelector:s=>rows.find(r=>r.classList.contains('is-dragging')),querySelectorAll:s=>s==='.drag-handle'?rows.map(r=>r.handle):rows,getBoundingClientRect:()=>({top:0,bottom:300,left:0,right:500}),addEventListener:(k,f)=>events[k]=f,contains:()=>false};
  h.context.document.querySelector=()=>list;
  h.context.document.addEventListener=(k,f)=>events[k]=f;
  h.context.document.removeEventListener=k=>delete events[k];
  h.context.requestAnimationFrame=()=>1;
  h.context.cancelAnimationFrame=()=>{};
  h.run('bindSequenceDrag();');
  const e=(y)=>({button:0,pointerId:1,clientX:30,clientY:y,preventDefault(){}});
  rows[0].handle.events.pointerdown(e(50));
  rows[0].handle.events.pointermove(e(190));
  assert.equal(rows[1].classList.contains('drop-after'),true);
  rows[0].handle.events.pointerup(e(190));
  assert.deepEqual(h.json('state.sequence.map(s=>s.screenId)'),['rules','waiting','end']);
  assert.equal(h.run('state.sequenceIndex'),0);
  assert.equal(rows[1].classList.contains('drop-after'),false);
  const before=h.json('state.sequence');
  rows[2].handle.events.pointerdown(e(250));
  rows[2].handle.events.pointermove(e(20));
  assert.equal(rows[0].classList.contains('drop-before'),true);
  events.keydown({key:'Escape'});
  rows[2].handle.events.pointerup(e(20));
  assert.deepEqual(h.json('state.sequence'),before);
  assert.equal(rows[0].classList.contains('drop-before'),false);
});

test('collapsed editor sections retain all inputs and settings forms for saving', () => {
  const h = harness();
  h.run(`modal={type:'question',question:migrateQuestion({id:'Q',question:'문제',answer:'1',judgeNote:'private'})};`);
  const html=h.run('renderModal()');
  for(const id of ['id','category','round','seconds','title','question','image','image-alt','answer','explanation','acceptedAnswers','judgeNote','note','author','usageStatus','difficulty','reviewStatus']) {
    assert.equal(html.split(`id="q-${id}"`).length-1,1,id);
  }
  assert.match(html,/<summary>진행자 메모<\/summary>/);
  assert.match(html,/private<\/textarea>/);
  for(const id of ['settings-form','run-settings-form','event-title','event-date','event-place','message-tagline','message-lobby','message-opening','message-rules','message-break','message-ending','current-pin','new-pin','new-pin-confirm']) {
    assert.equal(h.run('renderSettings()').split(`id="${id}"`).length-1,1,id);
  }
});

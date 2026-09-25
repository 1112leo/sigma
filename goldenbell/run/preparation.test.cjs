const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const create = require('./test-harness.cjs');
const source = [{ id: 'A', question: '문제 $x^2$', answer: '$2$', round: 'main1', reviewStatus: 'final' }];
function setup() { const h = create(); h.context.input = source; h.run('state.questions = []; const opts = importOptions();'); return h; }

test('JSON arrays/wrappers and RFC CSV parse BOM, CRLF, quoted newline/comma/double quotes, empty round', () => {
  const h = setup();
  h.context.text = '\uFEFFid,question,answer,round\r\nA,"첫 줄,\n둘째 ""인용""",2,\r\n';
  assert.deepEqual(h.json('parseQuestionImport(text,"csv")'), [{ id: 'A', question: '첫 줄,\n둘째 "인용"', answer: '2', round: null }]);
  h.context.text = JSON.stringify({ questions: source });
  assert.deepEqual(h.json('parseQuestionImport(text)'), source);
  for (const bad of ['id,id\na,b', 'id,question\na,"oops', 'id,question\na,"b"x', 'id,question\na', 'id,question\na,b"c']) { h.context.bad = bad; assert.throws(() => h.run('parseQuestionImport(bad,"csv")')); }
  for (const bad of ['{}','[]','null','[']) { h.context.bad = bad; assert.throws(() => h.run('parseQuestionImport(bad)')); }
});
test('raw import rejects duplicate IDs, every bad enum, bad time, missing answers, unsafe images before normalization', () => {
  const h = setup();
  h.run('state.questions = input.map(migrateQuestion)');
  assert.ok(h.json('prepareQuestionImport(input,state.questions,"append",opts).errors').some(e => e.message.includes('존재')));
  for (const mode of ['append','update','replace']) assert.ok(h.json(`prepareQuestionImport([...input,...input],[],"${mode}",opts).errors`).some(e => e.message.includes('중복')));
  h.context.invalid = { id:'X', question:'', answer:' ', category:'oops', round:'oops', timeLimit:0, usageStatus:'oops', difficulty:'oops', reviewStatus:'oops', image:'https://example.com/x.png' };
  const errors = h.json('prepareQuestionImport([invalid],[],"append",opts).errors');
  for (const field of ['question','answer','category','round','timeLimit','usageStatus','difficulty','reviewStatus','image']) assert.ok(errors.some(e=>e.message.includes(field)),field);
  for (const time of [null,true,'',1.5,-5,601]) { h.context.time = time; assert.ok(h.run('prepareQuestionImport([{...input[0],timeLimit:time}],[],"append",opts).errors.length > 0')); }
  assert.ok(h.run('prepareQuestionImport([{question:"Q",answer:"A"}],[],"update",opts).errors.length > 0'));
});
test('update preserves omitted metadata/photo/createdAt/order, explicit blank clears; append default ID and order', () => {
  const h = setup();
  h.run('state.questions = [migrateQuestion({...input[0], image:"data:image/png;base64,AAAA", note:"private", order:9, author:"author", createdAt:"2020-01-01T00:00:00Z"})]');
  const old = h.json('state.questions[0]');
  const updated = h.json('prepareQuestionImport([{id:"A",answer:"new",author:""}],state.questions,"update",opts).questions[0]');
  for (const field of ['question','image','note','createdAt','order']) assert.equal(updated[field],old[field]);
  assert.equal(updated.author,''); assert.equal(updated.answer,'new');
  assert.equal(h.run('prepareQuestionImport([{question:"Q",answer:"A",seconds:42}],[],"append",opts).prepared[0].timeLimit'),42);
  assert.ok(h.run('prepareQuestionImport([{question:"Q",answer:"A"}],[],"append",opts).prepared[0].id'));
});
test('atomic replace clears runtime, stops timer/reveal, retains sequence for explicit preflight, quota failure preserves preview', () => {
  const h = setup();
  h.run('state = defaultState(); activateSequence(state,3); startTimer(); state.runtime.overlay={type:"screen",screenId:"judging"}; importDraft={rows:input,mode:"replace"}; const before = structuredClone(state); const result=prepareBatch();');
  const before = h.json('state');
  h.context.localStorage.setItem = () => { throw new Error('quota'); };
  assert.equal(h.run('commitQuestionBatch(result,"replace")'),false);
  assert.deepEqual(h.json('state'),before); assert.ok(h.run('importDraft.rows'));
  h.context.localStorage.setItem = () => {};
  assert.equal(h.run('commitQuestionBatch(result,"replace")'),true);
  assert.equal(h.run('state.questions.length'),1);
  assert.deepEqual(h.json('state.sequence'),before.sequence);
  assert.equal(h.run('state.runtime.overlay'),null); assert.equal(h.run('state.runtime.returns.length'),0);
  assert.equal(h.run('state.timer.running'),false); assert.equal(h.run('state.answerVisible'),false);
  assert.deepEqual(h.json('normalizeState(JSON.parse(JSON.stringify(state))).questions'),h.json('state.questions'));
});
test('append/update total count is checked without the former aggregate image cap', () => {
  const h = setup();
  h.run('state.questions=Array.from({length:500},(_,i)=>migrateQuestion({id:String(i),question:"Q",answer:"A"},i))');
  assert.ok(h.run('prepareQuestionImport(input,state.questions,"append",opts).errors.length'));
  assert.equal(h.run('prepareQuestionImport([{...input[0],image:"data:image/png;base64,AAAA"}],[],"replace",{...opts,maxImages:1}).errors.length'),0);
});
test('preflight covers missing fields, bad timer, unfinal/unsequenced, duplicate, missing refs, empty rounds, math and image', () => {
  const h = setup();
  h.run('state.questions=[migrateQuestion({id:"A",question:"",answer:"",timeLimit:30}),migrateQuestion({id:"B",question:"$\\\\badcommand$",answer:"A"})]; state.questions[0].timeLimit=0; state.questions[0].image="https://example.com/image"; state.sequence=[{type:"question",questionId:"A"},{type:"question",questionId:"A"},{type:"question",questionId:"missing"},{type:"screen",screenId:"missing"}]');
  const result=h.json('checkPreparation(state,{validTime:validTimeLimit,safeImage,math:renderMath})');
  for (const code of ['empty-question','empty-answer','invalid-time','unfinal','unsequenced','duplicate','missing-question','missing-screen','empty-round','math','image']) assert.ok(result.issues.some(i=>i.code===code),code);
  assert.equal(result.normal,0);
});
test('real local KaTeX renders inline/display on every surface and falls back safely on malformed math', () => {
  const h = setup();
  h.context.text = '문제 $\\frac{x+1}{x-1}=2$\n$$x^2+y^2=1$$';
  const good=h.json('renderMath(text)'); assert.equal(good.errors.length,0); assert.match(good.html,/katex-display/);
  for (const text of ['$\\badcommand$', '$x', '$$', '$<img src=x onerror=alert(1)>\\badcommand$', '$\\def\\a{\\a}\\a$']) { h.context.text=text; const bad=h.json('renderMath(text)'); assert.ok(bad.errors.length,text); assert.ok(!bad.html.includes('<img')); }
  h.context.text='가격 \\$5'; assert.equal(h.run('richText(text)'),'가격 $5');
  h.context.text='$\\href{https://example.com}{link}$ $\\includegraphics{https://example.com/image}$';
  assert.doesNotMatch(h.run('richText(text)'),/<a |<img |src=/);
  h.run('state.questions = input.map(migrateQuestion); state.sequence=[{type:"question",questionId:"A"}]; activateSequence(state,0); state.answerVisible=true;');
  assert.match(h.run('renderLive()'),/katex/); assert.match(h.run('renderPreview()'),/katex/); assert.match(h.run('renderQuestionMathPreview(state.questions[0])'),/katex/);
  h.run('publicState=buildPublicState(); renderScreen()'); assert.match(h.app.innerHTML,/katex/);
});
test('projector clipping never cuts a math span, and vendor CSS fonts all exist locally', () => {
  const h=setup(); h.context.text='a'.repeat(590)+'$\\frac{123456789}{123456789}$ tail';
  assert.equal(h.run('renderMath(projectionText(text,600)).errors.length'),0);
  assert.equal(h.run('projectionText("x".repeat(800),600).length'),600);
  const css=fs.readFileSync(`${__dirname}/vendor/katex/katex.min.css`,'utf8');
  for(const match of css.matchAll(/url\(([^)]+)\)/g)) assert.ok(fs.existsSync(`${__dirname}/vendor/katex/${match[1]}`),match[1]);
  assert.ok(!css.includes('https://'));
});
test('async image decoder failure is reported and replacement confirmation cancel is mutation-free', async () => {
  const h=setup(); h.context.Image=class { set src(v) { this.onerror(); } };
  h.run('state.questions = [migrateQuestion({...input[0],image:"data:image/png;base64,AAAA"})];');
  const failed=await h.run('brokenImages(state.questions)'); assert.equal(failed[0],'A');
  h.run('importDraft={rows:input,mode:"replace"}; isUnlocked=()=>true;');
  h.context.confirm=()=>false;
  const before=h.json('state'); await h.run('applyBatch()'); assert.deepEqual(h.json('state'),before);
  assert.equal(h.run('importDraft.busy'),false);
});
test('preview IDs remain stable through modes and existing duplicate IDs block update without overwriting', () => {
  const h=setup(); h.run('importDraft={rows:[{question:"Q",answer:"A"}],mode:"append"}');
  const id=h.run('prepareBatch().prepared[0].id'); assert.equal(h.run('prepareBatch().prepared[0].id'),id);
  h.run('importDraft.mode="replace"'); assert.equal(h.run('prepareBatch().prepared[0].id'),id);
  h.run('importDraft.mode="update"'); assert.ok(h.run('prepareBatch().errors.length'));
  h.run('state.questions=[migrateQuestion({id:"A",question:"one",answer:"A"}),migrateQuestion({id:"A",question:"two",answer:"B"})]');
  assert.ok(h.run('prepareQuestionImport([{id:"A",answer:"new"}],state.questions,"update",opts).errors.length'));
  assert.ok(h.json('checkPreparation(state,{validTime:validTimeLimit,safeImage,math:renderMath}).issues').some(i=>i.code==='duplicate-id'));
});
test('import disarms old reveal snapshots and resolves a recovered current missing reference', () => {
  const h=setup(); h.run('state.questions=input.map(migrateQuestion); state.sequence=[{type:"question",questionId:"A"}]; activateSequence(state,0); state.answerVisible=true; state.runtime.overlay={type:"screen",screenId:"judging"};');
  h.run('state=normalizeState(state);commitQuestionBatch(prepareQuestionImport([{id:"A",answer:"NEW"}],state.questions,"update",opts),"update")');
  assert.equal(h.run('state.answerVisible'),false); assert.equal(h.run('buildPublicState().question.answer'),'');
  h.run('state.questions=[]; activateSequence(state,0); commitQuestionBatch(prepareQuestionImport(input,[],"append",opts),"append")');
  assert.equal(h.run('state.displayMode'),'question'); assert.equal(h.run('buildPublicState().question.question'),source[0].question);
});
test('unsupported trusted math commands fall back to complete raw input and warn', () => {
  const h=setup();
  for (const text of ['$\\href{https://example.com}{link}$','$\\includegraphics{https://example.com/a}$','$\\url{https://example.com}$']) {
    h.context.text=text; assert.equal(h.run('renderMath(text).errors.length'),1); assert.ok(h.run('renderMath(text).html.includes("https://example.com")')); assert.doesNotMatch(h.run('richText(text)'),/<a |<img /);
  }
});
test('late full-backup reads cannot mutate or broadcast after PIN lock and restores disarm reveal snapshots', async () => {
  const h=setup(); const readers=[]; h.context.FileReader=class { constructor(){readers.push(this);} readAsText(){} };
  h.run('downloadBackup=()=>true; isUnlocked=()=>true; state=defaultState(); activateSequence(state,3); state.answerVisible=true; state.runtime.overlay={type:"screen",screenId:"judging"}; const backup=JSON.stringify(state); importData({target:{files:[{size:10}],value:""}});');
  readers[0].result=h.run('backup'); await readers[0].onload();
  assert.equal(h.run('state.runtime.returns.length'),0);
  h.run('importData({target:{files:[{size:10}],value:""}}); lockConsole();');
  const stored=h.storage.get('sigma-goldenbell-v1');
  readers[1].result=h.run('backup'); await readers[1].onload();
  assert.equal(h.run('state'),null); assert.equal(h.storage.get('sigma-goldenbell-v1'),stored);
});
test('full restore cancels older async batch/preflight and reset storage failure rolls back', async () => {
  const h=setup(); const readers=[]; h.context.FileReader=class { constructor(){readers.push(this);} readAsText(){} };
  h.run('downloadBackup=()=>true; isUnlocked=()=>true; let finishImages; brokenImages=()=>new Promise(resolve=>{finishImages=resolve}); importDraft={rows:input,mode:"append"}; const pending=applyBatch();');
  h.run('importData({target:{files:[{size:10}],value:""}})');
  readers[0].result=JSON.stringify({questions:[{id:'RESTORED',question:'Restored',answer:'A'}]}); await readers[0].onload();
  h.run('finishImages([])'); await h.run('pending');
  assert.deepEqual(h.json('state.questions.map(q=>q.id)'),['RESTORED']); assert.equal(h.run('importDraft'),null);
  h.run('const pendingCheck=runPreflight(); clearPreparationDrafts(); finishImages([])'); await h.run('pendingCheck'); assert.equal(h.run('preflightResult'),null);
  const before=h.json('state'); h.context.localStorage.setItem=()=>{throw new Error('quota')}; await h.run('handleAction("reset-all")'); assert.deepEqual(h.json('state'),before);
});

test('backup failure prevents reset, full restore and question import', async () => {
  const h=setup(); const readers=[];
  h.context.FileReader=class { constructor(){readers.push(this);} readAsText(){} };
  h.run('state.questions=input.map(migrateQuestion); saveState(); downloadBackup=()=>false; isUnlocked=()=>true; brokenImages=async()=>[]; importDraft={rows:[{id:"NEW",question:"New",answer:"A"}],mode:"append"};');
  const before=h.json('state');
  await h.run('handleAction("reset-all")');
  assert.deepEqual(h.json('state'),before);
  h.run('const pending=applyBatch()'); await h.run('pending');
  assert.deepEqual(h.json('state'),before);
  assert.match(h.run('importDraft.error'),/백업을 시작하지 못해/);
  h.run('importData({target:{files:[{size:10}],value:""}})');
  readers[0].result=JSON.stringify({questions:[{id:'RESTORED',question:'Restored',answer:'A'}]});
  await readers[0].onload();
  assert.deepEqual(h.json('state'),before);
});

test('backup reports failure instead of creating an empty file, and preserves unreadable source bytes', async () => {
  const h=setup(); const notices=[]; let clicked=0; let blob;
  h.context.Blob=Blob;
  h.context.URL={createObjectURL(value){blob=value;return 'blob:test';},revokeObjectURL(){}};
  h.context.document.createElement=()=>({click(){clicked++;}});
  h.context.setTimeout=callback=>callback();
  h.context.toast=message=>notices.push(message);
  await h.run('persistenceBlocked=true; exportData()');
  assert.equal(clicked,0);
  assert.ok(notices.some(message=>message.includes('시작하지 못했습니다')));
  assert.ok(!notices.some(message=>message.includes('요청했습니다')));
  h.storage.set('sigma-goldenbell-v1','{unreadable original');
  assert.equal(await h.run('downloadBackup()'),true);
  assert.equal(clicked,1);
  assert.equal(await blob.text(),'{unreadable original');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const create = require('./test-harness.cjs');

test('short question bodies use the same type size as ordinary question bodies', () => {
  const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
  assert.match(css, /\.screen-question\.short,\s*\.screen-question\.medium\s*\{\s*font-size:\s*46px;/);
  assert.doesNotMatch(css, /\.screen-question\.short\s*\{\s*font-size:\s*64px;/);
});

test('question sizing counts visible math rather than TeX command spelling', () => {
  const h = create();
  h.context.text = '다음 표를 확인하시오.\n$$\\begin{aligned}a\\circ b&=c\\\\d\\circ e&=f\\end{aligned}$$';
  assert.equal(h.run('questionSizeClass(text)'), 'short');
  assert.equal(h.run('questionSizeClass("가".repeat(120))'), 'long');
  assert.equal(h.run('questionSizeClass("가".repeat(301))'), 'xlong');
  assert.equal(h.run('questionDisplayLength("$\\\\alpha+\\\\beta$")'), 3);
});

test('a short image prompt uses an image-first composition without exposing answers', () => {
  const h = create();
  h.run('state.questions=[migrateQuestion({id:"PHOTO",question:"사진 속 도형을 확인하시오.",answer:"SECRET_ANSWER",image:"data:image/jpeg;base64,AAAA"})];state.sequence=[{type:"question",questionId:"PHOTO"}];activateSequence(state,0)');
  const html = h.run('renderScreenMarkup(buildPublicState())');
  assert.match(html, /has-image image-focus/);
  assert.match(html, /data:image\/jpeg;base64,AAAA/);
  assert.doesNotMatch(html, /SECRET_ANSWER/);
  const stylesheet = fs.readFileSync(__dirname + '/index.html', 'utf8').match(/href="(\.\/styles\.css\?v=[^"]+)"/)[1];
  assert.ok(h.run('presentationFrame(buildPublicState())').includes(stylesheet));
});

test('question fitting handles height and hidden display-math overflow and resets on repeated fits', () => {
  const h = create();
  let size = 64;
  const style = { removeProperty() { size = 64; }, set fontSize(value) { size = parseFloat(value); } };
  const math = { clientWidth: 500, get scrollWidth() { return size * 12; } };
  const question = { style, clientWidth: 600, get scrollHeight() { return size * 8; }, get scrollWidth() { return 600; }, querySelectorAll: () => [math] };
  const holder = { clientHeight: 400 };
  h.context.frame = { contentDocument: { querySelector: selector => selector === '.screen-question' ? question : holder }, contentWindow: { getComputedStyle: () => ({fontSize:'64px'}) } };
  h.run('fitQuestionText(frame)');
  assert.ok(size >= 40 && size <= 41);
  const first = size;
  h.run('fitQuestionText(frame)');
  assert.equal(size, first);
  holder.clientHeight = 600; math.clientWidth = 1000;
  h.run('fitQuestionText(frame)');
  assert.equal(size, 64);
  math.clientWidth = 766;
  h.run('fitQuestionText(frame)');
  assert.equal(size, 64, 'tiny KaTeX glyph overhang must not shrink an otherwise fitting table');
});

test('multiple-choice labels stay grouped with their text and math; complete display math is preserved', () => {
  const h = create();
  h.context.text = '식을 확인하시오.\n$$\\begin{aligned}a&=b\\\\c&=d\\end{aligned}$$\n① $a$　② $b$　③ $c$';
  const html = h.run('questionTextMarkup(text)');
  assert.equal((html.match(/class="screen-question-choice"/g) || []).length, 3);
  assert.match(html, /katex-display/);
  assert.doesNotMatch(html, /math-warning/);
  h.context.text = '일반 문장\n$$a+b=c$$';
  assert.equal(h.run('questionTextMarkup(text)'), h.run('richText(text)'));
});

test('ambiguous choice markers and split math fall back unchanged, and choice HTML remains escaped', () => {
  const h = create();
  for (const text of ['문제\n① 가　③ 나', '문제\n① + ② = ③', '문제\n① $x+②y$　③ z', '수식 $$a+\n① b　② c$$']) {
    h.context.text = text;
    assert.equal(h.run('questionTextMarkup(text)'), h.run('richText(text)'));
  }
  h.context.text = '보기\n① <img src=x onerror=alert(1)>　② 안전';
  const html = h.run('questionTextMarkup(text)');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('multi-row equation lists and data tables get compact math sizing without altering short expressions', () => {
  const h = create();
  h.context.value = '$$\\begin{array}{cc}a&b\\\\c&d\\end{array}$$';
  assert.equal(h.run('questionMathClass(value)'), 'math-table');
  h.context.value = '$$\\begin{aligned}a&=b\\\\c&=d\\\\e&=f\\end{aligned}$$';
  assert.equal(h.run('questionMathClass(value)'), 'math-steps');
  h.context.value = '$$\\begin{aligned}a&=b\\\\c&=d\\end{aligned}$$';
  assert.equal(h.run('questionMathClass(value)'), '');
  h.context.value = '$$\\begin{gathered}a=b\\\\c=d\\\\e=f\\end{gathered}$$';
  assert.equal(h.run('questionMathClass(value)'), 'math-steps');
  assert.equal(h.run('questionMathClass(\"일반 문장\")'), '');
});

test('plain numeric and O/X answers share the math renderer and scale while text remains safe', () => {
  const h = create();
  for (const value of ['17', '-2', '0.5', '2, 5', 'O', 'X']) {
    h.context.value = value;
    assert.match(h.run('answerTextMarkup(value)'), /class="katex"/);
    assert.doesNotMatch(h.run('answerTextMarkup(value)'), /math-warning/);
  }
  h.context.value = '$\\frac ab$';
  assert.equal(h.run('answerTextMarkup(value)'), h.run('richText(value)'));
  h.context.value = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(h.run('answerTextMarkup(value)'), /<img/);
  const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
  assert.match(css, /\.screen-answer-body > strong \.katex\s*\{\s*font-size:\s*1em;/);
});

test('a final condition note keeps its complete math but has separate visual hierarchy', () => {
  const h = create();
  h.context.value = '조건을 만족하는 값을 구하시오.\n(단, $t>0$이다.)';
  const html = h.run('questionTextMarkup(value)');
  assert.match(html, /class="screen-question-note"/);
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /math-warning/);
  h.context.value = '일반 문장 (단, 예시)';
  assert.equal(h.run('questionTextMarkup(value)'), h.run('richText(value)'));
});

test('quantities retain math numerals and a separate, subordinate unit', () => {
  const h = create();
  for (const value of ['18가지', '4개', '24경기', '-0.5도']) {
    h.context.value = value;
    const html = h.run('answerTextMarkup(value)');
    assert.equal(h.run('answerSizeClass(value)'), 'quantity');
    assert.match(html, /class="answer-quantity"/);
    assert.match(html, /class="katex"/);
    assert.match(html, /class="answer-unit">[가-힣]+<\/span>/);
    assert.doesNotMatch(html, /math-warning/);
  }
});

test('choice labels are distinct from numeric, symbolic, Korean, and authored-math values', () => {
  const h = create();
  for (const value of ['② 8', '③ =', '⑤ 원기둥', '① $\\frac12$']) {
    h.context.value = value;
    const html = h.run('answerTextMarkup(value)');
    assert.equal(h.run('answerSizeClass(value)'), 'choice');
    assert.match(html, /class="answer-choice-index">[①②③④⑤]<\/span>/);
    assert.match(html, /class="answer-choice-value"/);
    assert.doesNotMatch(html, /textcircled|math-warning/);
    if (value !== '⑤ 원기둥') assert.match(html, /class="katex"/);
    else assert.match(html, /class="answer-choice-value">원기둥<\/span>/);
  }
  for (const value of ['8<script>', '① $\\badcommand$', '3개\\href{x}{y}']) {
    h.context.value = value;
    assert.doesNotMatch(h.run('answerTextMarkup(value)'), /<script|<a /);
  }
});

test('answer sizing distinguishes prose and words from numbers without counting TeX command names', () => {
  const h = create();
  for (const value of ['두 경우를 모두 인정한다', '무수히 많다']) {
    h.context.value = value;
    assert.equal(h.run('answerSizeClass(value)'), 'verbal');
  }
  assert.equal(h.run('answerSizeClass("원기둥")'), 'text');
  for (const value of ['7', '-2', '1, 2', 'O', '$\\frac{1+\\sqrt5}{2}$']) {
    h.context.value = value;
    assert.equal(h.run('answerSizeClass(value)'), 'short');
  }
  assert.equal(h.run('answerSizeClass("가".repeat(25))'), 'medium');
  assert.equal(h.run('answerSizeClass("가".repeat(61))'), 'long');
});

test('answer scales keep words, units, and choice indices below the main numeric scale', () => {
  const css = fs.readFileSync(__dirname + '/styles.css', 'utf8');
  const numeric = Number([...css.matchAll(/\.screen-answer-body > strong\s*\{[^}]*font-size:\s*(\d+)px;/g)].at(-1)[1]);
  const prose = Number(css.match(/\.screen-answer-body > strong\.verbal\s*\{[^}]*font-size:\s*(\d+)px;/)[1]);
  assert.ok(numeric <= 88, 'short answers must not regain the oversized 132px default');
  assert.ok(prose <= 64 && prose < numeric);
  assert.match(css, /\.screen-answer-body > strong\.quantity,\s*\.screen-answer-body > strong\.choice,\s*\.screen-answer-body > strong\.text\s*\{\s*font-size:\s*72px;/);
  assert.match(css, /\.screen-answer-body \.answer-unit\s*\{\s*font-size:\s*\.75em;/);
  assert.match(css, /\.screen-answer-body \.answer-choice-index\s*\{[^}]*font-size:\s*\.55em;/);
});

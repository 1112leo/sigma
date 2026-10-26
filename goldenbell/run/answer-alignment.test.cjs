const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('./test-harness.cjs');

const METRICS = {
  fontBoundingBoxAscent: 30,
  fontBoundingBoxDescent: 10,
  actualBoundingBoxAscent: 20,
  actualBoundingBoxDescent: 5,
};

function makeText(value, top, { mathml = false, metricsStyle = {} } = {}) {
  const parentElement = {
    computedStyle: {
      fontStyle: 'normal', fontWeight: '400', fontSize: '40px', fontFamily: 'sans-serif',
      display: 'inline', visibility: 'visible', ...metricsStyle,
    },
    closest(selector) {
      return mathml && selector.split(',').some(part => part.trim() === '.katex-mathml') ? this : null;
    },
  };
  return {
    nodeValue: value,
    parentElement,
    rects: [{ top, left: 0, width: 12, height: 40 }],
  };
}

function makeElement(textNodes, { top = '', fontSize = '40px' } = {}) {
  const removedProperties = [];
  return {
    textNodes,
    nextElementSibling: null,
    computedStyle: {
      fontStyle: 'normal', fontWeight: '400', fontSize, fontFamily: 'sans-serif',
      display: 'inline', visibility: 'visible',
    },
    style: {
      top,
      fontSize: '40px',
      removeProperty(name) {
        removedProperties.push(name);
        if (name === 'top') this.top = '';
      },
      removedProperties,
    },
  };
}

function makeFrame({ index = null, value = null, signs = [], measureText = () => METRICS, canvasAvailable = true } = {}) {
  const context = {
    font: '',
    measureText(text) { return measureText(text, this.font); },
  };
  const doc = {
    querySelector(selector) {
      if (selector === '.screen-answer-body .answer-choice-index') return index;
      if (selector === '.screen-answer-body .answer-choice-value') return value;
      return null;
    },
    querySelectorAll(selector) {
      return selector === '.screen-answer-body .answer-sign' ? signs : [];
    },
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return { getContext: () => canvasAvailable ? context : null };
    },
    createTreeWalker(element, showText) {
      assert.equal(showText, 4);
      let offset = 0;
      return { nextNode: () => element.textNodes[offset++] || null };
    },
    createRange() {
      let selectedNode = null;
      return {
        selectNodeContents(node) { selectedNode = node; },
        getClientRects() { return selectedNode?.rects || []; },
      };
    },
  };
  return {
    contentDocument: doc,
    contentWindow: { getComputedStyle: element => element.computedStyle },
  };
}

function align(frame) {
  const harness = create();
  harness.context.frame = frame;
  harness.run('alignAnswerTypography(frame)');
}

test('choice indices align their ink centres with symbol and numeric answers', () => {
  for (const [answer, expectedTop] of [['+', '-20px'], ['8', '-10px']]) {
    const index = makeElement([makeText('②', 100)]);
    const value = makeElement([makeText(answer, answer === '+' ? 80 : 90)]);

    align(makeFrame({ index, value }));

    assert.equal(index.style.top, expectedTop, `choice index should align with ${answer}`);
    assert.equal(index.style.fontSize, '40px', 'alignment must not change font size');
  }
});

test('a plain signed number aligns its sign with the neighboring number glyph', () => {
  const sign = makeElement([makeText('−', 60)]);
  const number = makeElement([makeText('2', 80)]);
  sign.nextElementSibling = number;

  align(makeFrame({ signs: [sign] }));

  assert.equal(sign.style.top, '20px');
  assert.equal(sign.style.fontSize, '40px', 'alignment must not change font size');
});

test('repeated alignment resets top and does not accumulate the optical shift', () => {
  const sign = makeElement([makeText('+', 60)], { top: '9px' });
  const number = makeElement([makeText('5', 80)]);
  sign.nextElementSibling = number;
  const frame = makeFrame({ signs: [sign] });

  align(frame);
  assert.equal(sign.style.top, '20px');
  align(frame);

  assert.equal(sign.style.top, '20px');
  assert.deepEqual(sign.style.removedProperties, ['top', 'top']);
});

test('missing canvas metrics safely clear a previous shift without assigning a new one', () => {
  const sign = makeElement([makeText('−', 60)]);
  const number = makeElement([makeText('3', 80)]);
  sign.nextElementSibling = number;
  let available = true;
  const frame = makeFrame({
    signs: [sign],
    measureText: () => available ? METRICS : {},
  });

  align(frame);
  assert.equal(sign.style.top, '20px');
  available = false;
  assert.doesNotThrow(() => align(frame));
  assert.equal(sign.style.top, '', 'invalid metrics should leave the glyph at its CSS position');
});

test('choice alignment ignores hidden KaTeX MathML text when finding visible ink bounds', () => {
  const index = makeElement([
    makeText('②', 100),
    makeText('hidden alternative', -1000, { mathml: true }),
  ]);
  const value = makeElement([makeText('8', 80)]);
  assert.ok(index.textNodes[1].parentElement.closest('.katex-mathml'));

  align(makeFrame({ index, value }));

  assert.equal(index.style.top, '-20px');
});

test('answer markup marks generated numeric signs while preserving authored formulas', () => {
  const harness = create();
  for (const value of ['+5', '-2', '-0.5도']) {
    harness.context.value = value;
    assert.match(harness.run('answerTextMarkup(value)'), /class="mord answer-sign(?: answer-operator)?"/);
  }

  for (const formula of ['$-2$', '$-\\frac{1}{2}$', '$x-2$']) {
    harness.context.value = formula;
    assert.equal(harness.run('answerTextMarkup(value)').replace(/ answer-operator/g, ''), harness.run('richText(value)'));
    assert.doesNotMatch(harness.run('answerTextMarkup(value)'), /answer-sign/);
  }
  assert.doesNotMatch(harness.run('answerTextMarkup("−")'), /answer-sign/);
});

test('minus and equals retain KaTeX and MathML while sharing the answer operator style', () => {
  const harness = create();
  for (const value of ['-2', '⑤ =', '$x=2-1$']) {
    harness.context.value = value;
    const html = harness.run('answerTextMarkup(value)');
    assert.match(html, /class="katex"/);
    assert.match(html, /answer-operator/);
    assert.match(html, /<mo>[−=]<\/mo>/);
    assert.doesNotMatch(html, /math-warning/);
  }
  harness.context.value = '$x=2-1$';
  assert.equal(harness.run('styleAnswerMath(answerTextMarkup(value))'), harness.run('answerTextMarkup(value)'), 'operator styling is idempotent');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const script = fs.readFileSync(`${__dirname}/landing.js`, 'utf8');

function setup({ reduced = false, intersection = true, resize = true, context = true, brokenContext = false, hidden = false } = {}) {
  let intersectionCallback;
  let resizeCallback;
  let motionCallback;
  let clock = 1000;
  let nextFrameId = 1;
  const frameCallbacks = new Map();
  const cancelledFrames = [];
  const documentEvents = {};
  const windowEvents = {};
  const drawTimes = [];
  const transforms = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return context ? ctx : null; },
  };
  const hero = { getBoundingClientRect: () => ({ width: 1000, height: 645 }) };
  const gradient = { addColorStop() {} };
  const ctx = {
    setTransform(...args) {
      if (brokenContext) throw new Error('canvas transform unavailable');
      transforms.push(args);
    },
    createLinearGradient() { return gradient; },
    createRadialGradient() { return gradient; },
    clearRect() { drawTimes.push(clock); },
    fillRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {},
  };
  class IntersectionObserver {
    constructor(callback) { intersectionCallback = callback; }
    observe() {}
    disconnect() {}
  }
  class ResizeObserver {
    constructor(callback) { resizeCallback = callback; }
    observe() {}
    disconnect() {}
  }
  const motion = {
    matches: reduced,
    addEventListener(type, callback) { motionCallback = callback; },
  };
  const win = {
    devicePixelRatio: 2,
    performance: { now: () => clock },
    matchMedia: () => motion,
    addEventListener(type, callback) { windowEvents[type] = callback; },
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      frameCallbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      cancelledFrames.push(id);
      frameCallbacks.delete(id);
    },
  };
  if (intersection) win.IntersectionObserver = IntersectionObserver;
  if (resize) win.ResizeObserver = ResizeObserver;
  const doc = {
    hidden,
    querySelector: selector => selector === '.sigma-v8-hero' ? hero : null,
    getElementById: id => id === 'sigma-bg-graph' ? canvas : null,
    querySelectorAll: () => [],
    addEventListener(type, callback) { documentEvents[type] = callback; },
  };
  vm.runInNewContext(script, { window: win, document: doc, Date });

  return {
    canvas, cancelledFrames, drawTimes, transforms, frameCallbacks, motion, windowEvents, documentEvents,
    enter(isIntersecting) {
      intersectionCallback([{ target: hero, isIntersecting }]);
    },
    tick(timestamp) {
      clock = timestamp;
      const [id, callback] = frameCallbacks.entries().next().value || [];
      if (callback) {
        frameCallbacks.delete(id);
        callback(timestamp);
      }
    },
    resize() { resizeCallback?.(); },
    changeMotion(matches) {
      motion.matches = matches;
      motionCallback?.();
    },
    setHidden(value) {
      doc.hidden = value;
      documentEvents.visibilitychange?.();
    },
  };
}

test('the supplied background keeps its palette, curves, and open-registration default', () => {
  assert.match(script, /const REGISTRATION_CLOSED = false/);
  assert.match(script, /\.16 \* \(x - \.7\) \*\* 2 - 1\.2/);
  assert.match(script, /\.85 \* Math\.sin\(\.9 \* x \+ \.2\)/);
  assert.match(script, /-\.18 \* \(x \+ 1\.4\) \*\* 2 \+ 1\.25/);
  assert.match(script, /rgba\(255,215,127,\.68\)/);
  assert.match(script, /rgba\(167,216,255,\.71\)/);
  assert.match(script, /rgba\(190,184,255,\.40\)/);
});

test('closing registration replaces only the two CTAs and updates closed-state copy', () => {
  const closedScript = script.replace('const REGISTRATION_CLOSED = false;', 'const REGISTRATION_CLOSED = true;');
  assert.notEqual(closedScript, script, 'exercise the actual closed branch without changing the production default');

  const makeLink = (className, href) => ({
    className,
    href,
    replacements: [],
    replaceWith(replacement) { this.replacements.push(replacement); },
  });
  const heroCta = makeLink('button button-gold', 'https://forms.gle/HBcpW34hJzRkYkDi9');
  const formCta = makeLink('button button-gold registration-link', 'https://forms.gle/HBcpW34hJzRkYkDi9');
  const instagramLink = makeLink('instagram-link', 'https://www.instagram.com/sxxng_hx.10/');
  const operatorLink = makeLink('temporary-run-link', '/goldenbell/run/');
  const phoneLink = makeLink('phone-link', 'sms:01057075642');
  const notice = {};
  const footnote = {};
  const heading = {};
  const faq = {};
  const registrationSelector = '.hero-actions .button-gold, .form-card .registration-link';
  const queriedSelectors = [];
  const doc = {
    querySelectorAll(selector) {
      queriedSelectors.push(selector);
      return selector === registrationSelector ? [heroCta, formCta] : [];
    },
    createElement(tag) {
      return {
        tagName: tag,
        attributes: new Map(),
        setAttribute(name, value) { this.attributes.set(name, value); },
      };
    },
    getElementById(id) {
      return { 'form-notice': notice, 'registration-tab-note': footnote, 'sigma-bg-graph': null }[id] || null;
    },
    querySelector(selector) {
      return {
        '.form-heading h3': heading,
        '.faq-list details:first-child p': faq,
        '.sigma-v8-hero': null,
      }[selector] || null;
    },
  };

  vm.runInNewContext(closedScript, { document: doc, window: {} });

  for (const [link, expectedClass] of [[heroCta, 'button button-gold registration-closed'], [formCta, 'button button-gold registration-link registration-closed']]) {
    assert.equal(link.replacements.length, 1);
    const button = link.replacements[0];
    assert.equal(button.tagName, 'button');
    assert.equal(button.type, 'button');
    assert.equal(button.disabled, true);
    assert.equal(button.className, expectedClass);
    assert.equal(button.textContent, '참가 신청 마감');
    assert.equal(button.attributes.get('aria-label'), '참가 신청이 마감되었습니다');
    assert.equal(button.href, undefined);
    assert.equal(button.attributes.has('href'), false);
  }
  assert.equal(notice.innerHTML, '<strong>참가 신청이 마감되었습니다.</strong><br>선착순 모집이 종료되어 추가 신청을 받지 않습니다.');
  assert.equal(footnote.textContent, '신청 접수가 종료되었습니다.');
  assert.equal(heading.textContent, '참가 신청 마감');
  assert.equal(faq.textContent, '모집 정원은 최대 60명이며, 현재 참가 신청이 마감되었습니다.');
  assert.equal(instagramLink.href, 'https://www.instagram.com/sxxng_hx.10/');
  assert.equal(operatorLink.href, '/goldenbell/run/');
  assert.equal(phoneLink.href, 'sms:01057075642');
  assert.equal(operatorLink.replacements.length, 0);
  assert.equal(instagramLink.replacements.length, 0);
  assert.equal(phoneLink.replacements.length, 0);
  assert.deepEqual(queriedSelectors, [registrationSelector]);
});

test('canvas animation runs only while the hero is visible and resizes cleanly', () => {
  const state = setup();
  assert.equal(state.drawTimes.length, 0, 'wait for the hero intersection before drawing');
  state.enter(true);
  assert.equal(state.drawTimes.length, 1);
  assert.deepEqual(state.transforms[0], [1.8, 0, 0, 1.8, 0, 0]);
  assert.equal(state.canvas.width, 1800, 'device pixel ratio remains capped at 1.8');
  assert.equal(state.frameCallbacks.size, 1);

  state.tick(1040);
  assert.equal(state.drawTimes.length, 2, 'the dotted drift keeps its supplied 25 fps cadence');
  assert.equal(state.frameCallbacks.size, 1);
  const activeFrame = [...state.frameCallbacks.keys()][0];
  state.resize();
  assert.ok(state.cancelledFrames.includes(activeFrame), 'resizing cancels the old animation frame');
  assert.equal(state.frameCallbacks.size, 1, 'resizing starts one fresh frame loop');

  const resizeFrame = [...state.frameCallbacks.keys()][0];
  state.enter(false);
  assert.ok(state.cancelledFrames.includes(resizeFrame), 'leaving the hero cancels its pending frame');
  assert.equal(state.frameCallbacks.size, 0);
});

test('hidden tabs and reduced motion stop drift; restoring visibility restarts only when allowed', () => {
  const state = setup();
  state.enter(true);
  const initialFrame = [...state.frameCallbacks.keys()][0];
  state.setHidden(true);
  assert.ok(state.cancelledFrames.includes(initialFrame));
  assert.equal(state.frameCallbacks.size, 0);
  state.setHidden(false);
  assert.equal(state.frameCallbacks.size, 1);

  const visibleFrame = [...state.frameCallbacks.keys()][0];
  state.changeMotion(true);
  assert.ok(state.cancelledFrames.includes(visibleFrame));
  assert.equal(state.frameCallbacks.size, 0);
  assert.equal(state.drawTimes.at(-1), 1000, 'reduced motion draws one static frame');
  state.changeMotion(false);
  assert.equal(state.frameCallbacks.size, 1);
});

test('missing observers leave a static canvas and a window resize fallback', () => {
  const state = setup({ intersection: false, resize: false });
  assert.equal(state.drawTimes.length, 1);
  assert.equal(state.frameCallbacks.size, 0, 'without visibility observation, the canvas does not animate offscreen');
  assert.equal(typeof state.windowEvents.resize, 'function');
  state.windowEvents.resize();
  assert.equal(state.drawTimes.length, 2);
});

test('missing or unusable canvas context exits without scheduling work', () => {
  const state = setup({ context: false });
  assert.equal(state.drawTimes.length, 0);
  assert.equal(state.frameCallbacks.size, 0);

  const partial = setup({ brokenContext: true });
  partial.enter(true);
  assert.equal(partial.drawTimes.length, 0);
  assert.equal(partial.frameCallbacks.size, 0);
});

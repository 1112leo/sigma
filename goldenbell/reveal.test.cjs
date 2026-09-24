const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const script = fs.readFileSync(`${__dirname}/reveal.js`, 'utf8');

function setup({ reduced = false, supported = true } = {}) {
  let callback, change, focus, disconnected = false;
  const observed = new Set();
  const calls = [];
  const items = [100, 900, 1000].map(top => ({
    getBoundingClientRect: () => ({ top }),
    contains(target) { return target === this; },
    animate(frames, options) {
      const animation = { pause() { this.paused = true; }, play() { this.played = true; }, cancel() { this.cancelled = true; this.oncancel?.(); } };
      calls.push({ frames, options, animation });
      return animation;
    },
  }));
  const motion = { matches: reduced, addEventListener(type, fn) { change = fn; } };
  class Observer {
    constructor(fn) { callback = fn; }
    observe(item) { observed.add(item); }
    unobserve(item) { observed.delete(item); }
    disconnect() { observed.clear(); disconnected = true; }
  }
  vm.runInNewContext(script, {
    matchMedia: () => motion, window: supported ? { IntersectionObserver: Observer, addEventListener() {} } : {},
    IntersectionObserver: Observer, Element: { prototype: { animate() {} } }, innerHeight: 800,
    document: { querySelectorAll: () => items, addEventListener(type, fn) { focus = fn; } },
  });
  return { items, calls, observed, motion,
    enter: () => callback([...observed].map(target => ({ target, isIntersecting: true, boundingClientRect: { bottom: 500 } }))),
    reduce: () => { motion.matches = true; change(); return disconnected; },
    focus: target => focus({ target }),
  };
}

test('scroll reveal observes only below-fold content and stops observing after entrance', () => {
  const state = setup();
  assert.equal(state.observed.size, 2);
  assert.ok(state.calls.every(call => call.animation.paused && call.animation.currentTime === 0));
  state.enter();
  assert.equal(state.observed.size, 0);
  assert.equal(state.calls.length, 2);
  assert.ok(state.calls.every(call => call.animation.played));
  assert.equal(state.calls[0].options.fill, 'both');
});

test('reduced motion and unsupported browsers leave content unchanged', () => {
  for (const options of [{ reduced: true }, { supported: false }]) {
    const state = setup(options);
    assert.equal(state.observed.size, 0);
    assert.equal(state.calls.length, 0);
  }
});

test('keyboard focus and live reduced-motion changes cancel decorative animations', () => {
  const state = setup();
  state.enter();
  state.focus(state.items[1]);
  assert.equal(state.calls[0].animation.cancelled, true);
  assert.equal(state.reduce(), true);
  assert.equal(state.calls[1].animation.cancelled, true);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const script = fs.readFileSync(`${__dirname}/reveal.js`, 'utf8');

function setup({ reduced = false, supported = true, animateSupported = true, animateThrows = false } = {}) {
  let callback;
  let change;
  let focus;
  let disconnected = false;
  const events = {};
  const observed = new Set();
  const calls = [];
  const items = [100, 900, 1000].map(top => {
    const item = {
      top,
      attributes: new Set(),
      setAttribute(name) { this.attributes.add(name); },
      removeAttribute(name) { this.attributes.delete(name); },
      getBoundingClientRect() { return { top: this.top, bottom: this.top + 100 }; },
      contains(target) { return target === this; },
      animate(frames, options) {
        if (animateThrows) throw new Error('animation unavailable');
        const animation = {
          cancel() {
            this.cancelled = true;
            this.oncancel?.();
          },
        };
        calls.push({ item: this, frames, options, animation });
        return animation;
      },
    };
    return item;
  });
  const hero = {
    animate(frames, options) {
      if (animateThrows) throw new Error('animation unavailable');
      const animation = { cancel() { this.cancelled = true; } };
      calls.push({ item: this, frames, options, animation, hero: true });
      return animation;
    },
  };
  const motion = { matches: reduced, addEventListener(type, fn) { change = fn; } };
  class Observer {
    constructor(fn) { callback = fn; }
    observe(item) { observed.add(item); }
    unobserve(item) { observed.delete(item); }
    disconnect() { observed.clear(); disconnected = true; }
  }
  const win = {
    matchMedia: () => motion,
    addEventListener(type, fn) { events[type] = fn; },
  };
  if (supported) win.IntersectionObserver = Observer;
  const element = animateSupported ? { prototype: { animate() {} } } : { prototype: {} };
  const doc = {
    querySelectorAll: () => items,
    querySelector: selector => selector === '.sigma-v8-hero .hero-copy' ? hero : null,
    addEventListener(type, fn) { focus = fn; },
  };
  vm.runInNewContext(script, { window: win, document: doc, Element: element, innerHeight: 800 });

  return {
    items, calls, observed, motion, events, hero,
    enter() {
      callback([...observed].map(target => ({ target, isIntersecting: true, boundingClientRect: { bottom: 500 } })));
    },
    reduce() {
      motion.matches = true;
      change();
      return disconnected;
    },
    focus(target) { focus({ target }); },
    scroll() { events.scroll(); },
    get disconnected() { return disconnected; },
  };
}

test('scroll reveal observes only below-fold content and adapts the supplied hero selector', () => {
  const state = setup();
  assert.equal(state.observed.size, 2);
  assert.equal(state.calls.length, 1, 'only the visible hero copy animates immediately');
  assert.equal(state.calls[0].item, state.hero);
  assert.ok(state.items.slice(1).every(item => item.attributes.has('data-scroll-pending')));
  state.enter();
  assert.equal(state.observed.size, 0);
  assert.equal(state.calls.length, 3);
  assert.ok(state.items.slice(1).every(item => item.attributes.has('data-scroll-pending')));
  assert.equal(state.calls[1].options.fill, 'both');
  assert.equal(state.calls[1].frames.at(-1).transform, 'translateY(0)');
  state.calls[1].animation.onfinish();
  assert.equal(state.items[1].attributes.has('data-scroll-pending'), false);
});

test('reduced motion and unsupported browsers leave content visible', () => {
  for (const options of [{ reduced: true }, { supported: false }, { animateSupported: false }]) {
    const state = setup(options);
    assert.equal(state.observed.size, 0);
    assert.equal(state.calls.length, 0);
    assert.ok(state.items.every(item => !item.attributes.has('data-scroll-pending')));
  }
});

test('keyboard focus and live reduced-motion changes cancel animations and release pending content', () => {
  const state = setup();
  state.enter();
  state.focus(state.items[1]);
  assert.equal(state.calls[1].animation.cancelled, true);
  assert.equal(state.items[1].attributes.has('data-scroll-pending'), false);
  assert.equal(state.reduce(), true);
  assert.equal(state.calls[2].animation.cancelled, true);
  assert.ok(state.items.every(item => !item.attributes.has('data-scroll-pending')));
});

test('fast scroll releases items that passed above the viewport without leaving them hidden', () => {
  const state = setup();
  state.items[1].top = -120;
  state.scroll();
  assert.equal(state.items[1].attributes.has('data-scroll-pending'), false);
  assert.equal(state.observed.has(state.items[1]), false);
  state.enter();
  assert.equal(state.calls.filter(call => call.item === state.items[1]).length, 0,
    'a skipped item is not animated after it has already passed');
});

test('canceled entrance animations and printing release hidden content', () => {
  const canceled = setup();
  canceled.enter();
  canceled.calls[1].animation.cancel();
  assert.equal(canceled.items[1].attributes.has('data-scroll-pending'), false);

  const printing = setup();
  printing.events.beforeprint();
  assert.equal(printing.observed.size, 0);
  assert.ok(printing.items.every(item => !item.attributes.has('data-scroll-pending')));
  assert.equal(printing.calls[0].animation.cancelled, true);
});

test('animation failures reveal content instead of leaving a pending opacity', () => {
  const state = setup({ animateThrows: true });
  state.enter();
  assert.ok(state.items.every(item => !item.attributes.has('data-scroll-pending')));
});

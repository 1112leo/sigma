const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const script = fs.readFileSync(`${__dirname}/principle-reveal.js`, 'utf8');

function setup() {
  const items = [120, 940, 1650].map(top => ({
    top, attrs: new Set(), animations: [],
    getBoundingClientRect() { return { top: this.top, bottom: this.top + 200 }; },
    setAttribute(name) { this.attrs.add(name); },
    removeAttribute(name) { this.attrs.delete(name); },
    animate(frames, options) {
      const animation = { frames, options, cancel() { this.cancelled = true; } };
      this.animations.push(animation);
      return animation;
    },
  }));
  let callback, change, beforeprint;
  const observed = new Set();
  const motion = { matches: false, addEventListener(_, fn) { change = fn; } };
  class Observer {
    constructor(fn) { callback = fn; }
    observe(item) { observed.add(item); }
    unobserve(item) { observed.delete(item); }
    disconnect() { observed.clear(); }
  }
  vm.runInNewContext(script, {
    document: { querySelectorAll: () => items }, matchMedia: () => motion,
    window: { IntersectionObserver: Observer, addEventListener(_, fn) { beforeprint = fn; } },
    IntersectionObserver: Observer, Element: { prototype: { animate() {} } }, innerHeight: 800,
  });
  return { items, observed, motion, change, beforeprint,
    enter(item, bottom = 500) { callback([{ target: item, isIntersecting: true, boundingClientRect: { bottom } }]); },
  };
}

test('principle reveal starts only below fold without repeated class or inline-style changes', () => {
  const state = setup();
  assert.equal(state.observed.size, 2);
  assert.equal(state.items[0].attrs.size, 0);
  state.enter(state.items[1]);
  assert.equal(state.items[1].animations.length, 1);
  assert.equal(state.items[1].animations[0].options.fill, 'both');
  assert.equal(state.items[1].animations[0].frames[0].transform, 'translateY(14px)');
  state.items[1].animations[0].onfinish();
  assert.equal(state.items[1].attrs.size, 0);
  assert.equal(state.items[1].animations[0].cancelled, true);
  state.enter(state.items[1]);
  assert.equal(state.items[1].animations.length, 1);
});

test('fast scroll and repeated entry leave no permanently hidden section', () => {
  const state = setup();
  state.enter(state.items[2], -20);
  assert.equal(state.items[2].attrs.size, 0);
  assert.equal(state.items[2].animations.length, 0);
  state.enter(state.items[1]);
  state.beforeprint();
  assert.equal(state.observed.size, 0);
  assert.equal(state.items[1].attrs.size, 0);
  assert.equal(state.items[1].animations[0].cancelled, true);
});

test('reduced-motion change releases every pending section', () => {
  const state = setup();
  state.motion.matches = true;
  state.change();
  assert.equal(state.observed.size, 0);
  assert.ok(state.items.every(item => item.attrs.size === 0));
});

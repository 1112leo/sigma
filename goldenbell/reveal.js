(() => {
  const motion = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };
  const Observer = window.IntersectionObserver;
  if (motion.matches || typeof Observer !== 'function' || typeof Element === 'undefined'
      || typeof Element.prototype.animate !== 'function') return;

  // Visible by default: unsupported animation never hides content.
  const items = [...document.querySelectorAll('.event-strip, .about-body, .benefits-section .section-heading, .benefit-card, .benefit-note, .apply-copy, .form-card, .questions-section')];
  const pending = new Set();
  const active = new Map();
  const reveal = item => {
    pending.delete(item);
    item.removeAttribute('data-scroll-pending');
    const animation = active.get(item);
    active.delete(item);
    animation?.cancel();
  };
  let observer;
  try {
    observer = new Observer(entries => {
      entries.filter(entry => entry.isIntersecting).forEach(entry => {
        observer.unobserve(entry.target);
        if (!pending.has(entry.target)) return;
        if (motion.matches || entry.boundingClientRect.bottom <= 0) {
          reveal(entry.target);
          return;
        }
        try {
          // Keep the pending opacity until animation completion, avoiding a one-frame flash.
          const animation = entry.target.animate([
            { opacity: 0, transform: 'translateY(18px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ], { duration: 760, easing: 'cubic-bezier(.22, .7, .2, 1)', fill: 'both' });
          active.set(entry.target, animation);
          animation.onfinish = () => reveal(entry.target);
          // If the browser cancels an animation, do not leave its content hidden.
          animation.oncancel = () => reveal(entry.target);
        } catch {
          reveal(entry.target);
        }
      });
    }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });
  } catch {
    return;
  }

  // Sections already on screen remain visible; later sections wait for actual entry.
  items.filter(item => item.getBoundingClientRect().top >= innerHeight - 8).forEach(item => {
    pending.add(item);
    item.setAttribute('data-scroll-pending', '');
    observer.observe(item);
  });

  // The supplied page has one hero copy block and no hero illustration.
  const heroCopy = document.querySelector('.sigma-v8-hero .hero-copy');
  if (heroCopy) {
    try {
      const animation = heroCopy.animate([
        { opacity: 0, transform: 'translateY(16px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 800, easing: 'cubic-bezier(.22, .7, .2, 1)', fill: 'backwards' });
      active.set(heroCopy, animation);
      animation.onfinish = () => active.delete(heroCopy);
    } catch {
      // The hero is visible by default if its decorative entrance cannot run.
    }
  }

  document.addEventListener('focusin', event => {
    for (const item of items) {
      if (item.contains(event.target)) {
        observer.unobserve(item);
        reveal(item);
      }
    }
  });

  // A very fast scroll can skip an observer's brief intersection callback.
  // Release content that has passed above the viewport so it cannot stay hidden.
  const revealPassedItems = () => {
    for (const item of pending) {
      if (item.getBoundingClientRect().bottom <= 0) {
        observer.unobserve(item);
        reveal(item);
      }
    }
  };
  window.addEventListener('scroll', revealPassedItems, { passive: true });

  const showAll = () => {
    observer.disconnect();
    for (const item of [...pending]) reveal(item);
    for (const animation of active.values()) animation.cancel();
    active.clear();
  };
  const onMotionChange = () => {
    if (motion.matches) showAll();
  };
  if (typeof motion.addEventListener === 'function') motion.addEventListener('change', onMotionChange);
  else if (typeof motion.addListener === 'function') motion.addListener(onMotionChange);
  window.addEventListener('beforeprint', showAll);
})();

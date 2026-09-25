(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches || !('IntersectionObserver' in window) || !Element.prototype.animate) return;

  // Visible by default: blocked JavaScript or unsupported animation never hides content.
  const items = [...document.querySelectorAll('.event-strip, .about-body, .benefits-section .section-heading, .benefit-card, .benefit-note, .apply-copy, .form-card, .questions-section')];
  const pending = new Set();
  const active = new Map();
  const reveal = item => {
    pending.delete(item);
    item.removeAttribute('data-scroll-pending');
    active.get(item)?.cancel();
  };
  const observer = new IntersectionObserver(entries => {
    entries.filter(entry => entry.isIntersecting).forEach(entry => {
      observer.unobserve(entry.target);
      if (!pending.has(entry.target)) return;
      if (motion.matches || entry.boundingClientRect.bottom <= 0) {
        reveal(entry.target);
        return;
      }
      // Only entering elements own an animation/layer, not the entire offscreen page.
      const animation = entry.target.animate([
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'none' },
      ], { duration: 600, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'backwards' });
      entry.target.removeAttribute('data-scroll-pending');
      pending.delete(entry.target);
      active.set(entry.target, animation);
      animation.oncancel = animation.onfinish = () => active.delete(entry.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px 96px 0px' });

  // Prepare below-fold items BEFORE they enter view: never flash visible content to zero.
  items.filter(item => item.getBoundingClientRect().top >= innerHeight + 96).forEach(item => {
    pending.add(item);
    item.setAttribute('data-scroll-pending', '');
    observer.observe(item);
  });
  document.addEventListener('focusin', event => {
    for (const item of items) {
      if (item.contains(event.target)) {
        observer.unobserve(item);
        reveal(item);
      }
    }
  });
  const showAll = () => {
    observer.disconnect();
    for (const item of pending) item.removeAttribute('data-scroll-pending');
    pending.clear();
    for (const animation of active.values()) animation.cancel();
    active.clear();
  };
  motion.addEventListener('change', () => {
    if (motion.matches) showAll();
  });
  window.addEventListener('beforeprint', showAll);
  window.addEventListener('hashchange', showAll);
})();

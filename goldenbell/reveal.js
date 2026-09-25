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
      // Keep the pending opacity until animation completion, avoiding a one-frame flash.
      const animation = entry.target.animate([
        { opacity: 0, transform: 'translateY(18px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 760, easing: 'cubic-bezier(.22, .7, .2, 1)', fill: 'both' });
      active.set(entry.target, animation);
      animation.onfinish = () => reveal(entry.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });

  // Sections already on screen remain visible; later sections wait for actual entry.
  items.filter(item => item.getBoundingClientRect().top >= innerHeight - 8).forEach(item => {
    pending.add(item);
    item.setAttribute('data-scroll-pending', '');
    observer.observe(item);
  });
  [...document.querySelectorAll('.hero-copy, .hero-art')].forEach((item, index) => {
    const animation = item.animate([
      { opacity: 0, transform: 'translateY(16px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 800, delay: index * 110, easing: 'cubic-bezier(.22, .7, .2, 1)', fill: 'backwards' });
    active.set(item, animation);
    animation.onfinish = () => active.delete(item);
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
    for (const item of [...pending]) reveal(item);
    for (const animation of active.values()) animation.cancel();
    active.clear();
  };
  motion.addEventListener('change', () => {
    if (motion.matches) showAll();
  });
  window.addEventListener('beforeprint', showAll);
})();

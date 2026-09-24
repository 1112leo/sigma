(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches || !('IntersectionObserver' in window) || !Element.prototype.animate) return;

  // Visible by default: blocked JavaScript or unsupported animation never hides content.
  const items = [...document.querySelectorAll('.event-strip, .about-body > *, .benefits-section .section-heading, .benefit-card, .benefit-note, .apply-copy, .form-card, .questions-section > *')];
  const active = new Map();
  const observer = new IntersectionObserver(entries => {
    entries.filter(entry => entry.isIntersecting).forEach(entry => {
      observer.unobserve(entry.target);
      const animation = active.get(entry.target);
      if (motion.matches || entry.boundingClientRect.bottom <= 0) animation?.cancel();
      else animation?.play();
    });
  }, { threshold: 0, rootMargin: '0px 0px 48px 0px' });

  // Prepare below-fold items BEFORE they enter view: never flash visible content to zero.
  items.filter(item => item.getBoundingClientRect().top >= innerHeight + 48).forEach(item => {
    const animation = item.animate([
      { opacity: 0, transform: 'translateY(12px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 650, easing: 'cubic-bezier(.25, .65, .35, 1)', fill: 'both' });
    animation.pause();
    animation.currentTime = 0;
    active.set(item, animation);
    animation.oncancel = () => active.delete(item);
    animation.onfinish = () => animation.cancel();
    observer.observe(item);
  });
  document.addEventListener('focusin', event => {
    for (const item of items) {
      if (item.contains(event.target)) {
        observer.unobserve(item);
        active.get(item)?.cancel();
      }
    }
  });
  const showAll = () => {
    observer.disconnect();
    for (const animation of active.values()) animation.cancel();
    active.clear();
  };
  motion.addEventListener('change', () => {
    if (motion.matches) showAll();
  });
  window.addEventListener('beforeprint', showAll);
  window.addEventListener('hashchange', showAll);
})();

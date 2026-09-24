(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches || !('IntersectionObserver' in window) || !Element.prototype.animate) return;

  // Visible by default: blocked JavaScript or unsupported animation never hides content.
  const items = [...document.querySelectorAll('.event-strip, .about-body > *, .benefits-section .section-heading, .benefit-card, .benefit-note, .apply-copy, .form-card, .questions-section > *')];
  const active = new Map();
  const observer = new IntersectionObserver(entries => {
    entries.filter(entry => entry.isIntersecting).forEach((entry, index) => {
      observer.unobserve(entry.target);
      if (motion.matches || entry.boundingClientRect.bottom <= 0) return;
      const animation = entry.target.animate([
        { opacity: 0, transform: 'translateY(22px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 580, delay: Math.min(index, 2) * 80, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'backwards' });
      active.set(entry.target, animation);
      animation.onfinish = animation.oncancel = () => active.delete(entry.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -16px 0px' });

  // Do not animate the initial viewport or content already passed on anchor navigation.
  items.filter(item => item.getBoundingClientRect().top >= innerHeight).forEach(item => observer.observe(item));
  document.addEventListener('focusin', event => {
    for (const item of items) {
      if (item.contains(event.target)) {
        observer.unobserve(item);
        active.get(item)?.cancel();
      }
    }
  });
  motion.addEventListener('change', () => {
    if (!motion.matches) return;
    observer.disconnect();
    for (const animation of active.values()) animation.cancel();
    active.clear();
  });
})();

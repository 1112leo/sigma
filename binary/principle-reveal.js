(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches || !('IntersectionObserver' in window) || !Element.prototype.animate) return;

  const items = [...document.querySelectorAll('.lesson-section, .worked-example')];
  const pending = new Set();
  const active = new Map();
  const release = item => {
    pending.delete(item);
    item.removeAttribute('data-principle-pending');
    active.get(item)?.cancel();
    active.delete(item);
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      if (!pending.has(entry.target)) continue;
      if (entry.boundingClientRect.bottom <= 0 || motion.matches) { release(entry.target); continue; }
      const animation = entry.target.animate([
        { opacity: 0, transform: 'translateY(14px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 620, easing: 'cubic-bezier(.22, .7, .2, 1)', fill: 'both' });
      active.set(entry.target, animation);
      animation.onfinish = () => release(entry.target);
    }
  }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });

  // Already visible sections stay visible; only genuinely offscreen sections wait.
  for (const item of items) if (item.getBoundingClientRect().top >= innerHeight - 8) {
    pending.add(item);
    item.setAttribute('data-principle-pending', '');
    observer.observe(item);
  }
  const showAll = () => {
    observer.disconnect();
    for (const item of pending) release(item);
    for (const item of active.keys()) release(item);
  };
  motion.addEventListener('change', () => { if (motion.matches) showAll(); });
  window.addEventListener('beforeprint', showAll);
})();

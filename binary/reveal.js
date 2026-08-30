(() => {
  const items = [...document.querySelectorAll('.choice-card,.concept-card,.lesson-section,.worked-example,.info-card,.quiz-card,.review-callout')];
  if (!items.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.documentElement.classList.add('reveal-ready');
  items.forEach((item, index) => {
    item.dataset.reveal = '';
    item.style.setProperty('--reveal-delay', `${(index % 3) * 90}ms`);
  });
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.16, rootMargin: '0px 0px -6% 0px' });
  items.forEach(item => observer.observe(item));
})();

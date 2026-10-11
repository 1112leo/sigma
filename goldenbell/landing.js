// 참가 신청 상태 — 마감 후 true로 바꾸어 배포하세요.
// 구글 설문지 자체의 응답 접수 중지는 Google Forms에서 별도로 설정해야 합니다.
const REGISTRATION_CLOSED = false;

function applyRegistrationStatus() {
  if (!REGISTRATION_CLOSED) return; // 열린 상태에서는 기존 링크와 문구를 그대로 유지

  document.querySelectorAll('.hero-actions .button-gold, .form-card .registration-link').forEach(link => {
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = true;
    button.className = link.className + ' registration-closed';
    button.textContent = '참가 신청 마감';
    button.setAttribute('aria-label', '참가 신청이 마감되었습니다');
    link.replaceWith(button);
  });
  const notice = document.getElementById('form-notice');
  if (notice) notice.innerHTML = '<strong>참가 신청이 마감되었습니다.</strong><br>선착순 모집이 종료되어 추가 신청을 받지 않습니다.';
  const footnote = document.getElementById('registration-tab-note');
  if (footnote) footnote.textContent = '신청 접수가 종료되었습니다.';
  const heading = document.querySelector('.form-heading h3');
  if (heading) heading.textContent = '참가 신청 마감';
  const faq = document.querySelector('.faq-list details:first-child p');
  if (faq) faq.textContent = '모집 정원은 최대 60명이며, 현재 참가 신청이 마감되었습니다.';
}

applyRegistrationStatus();

(() => {
  const hero = document.querySelector('.sigma-v8-hero');
  const canvas = document.getElementById('sigma-bg-graph');
  if (!hero || !canvas || typeof canvas.getContext !== 'function') return;

  let ctx;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    return;
  }
  if (!ctx) return;

  const reduced = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };
  const supportsIntersectionObserver = typeof window.IntersectionObserver === 'function';
  const supportsResizeObserver = typeof window.ResizeObserver === 'function';
  const canAnimate = supportsIntersectionObserver
    && typeof window.requestAnimationFrame === 'function'
    && typeof window.cancelAnimationFrame === 'function';

  let w = 0;
  let h = 0;
  let raf = null;
  let last = 0;
  let visible = !supportsIntersectionObserver;
  let drawingFailed = false;
  let intersectionObserver = null;
  let resizeObserver = null;

  const curveA = x => .16 * (x - .7) ** 2 - 1.2;
  const curveB = x => .85 * Math.sin(.9 * x + .2);
  const curveC = x => -.18 * (x + 1.4) ** 2 + 1.25;
  const now = () => (window.performance?.now?.() ?? Date.now());

  function resize() {
    const box = hero.getBoundingClientRect();
    w = Math.max(1, box.width);
    h = Math.max(1, box.height);
    const d = Math.min(window.devicePixelRatio || 1, 1.8);
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  function fadeEdges() {
    // These masks fade every backdrop pixel into the surrounding page.
    // No opaque rectangular image or cutoff is left at the hero boundaries.
    ctx.globalCompositeOperation = 'destination-in';
    const x = ctx.createLinearGradient(0, 0, w, 0);
    x.addColorStop(0, 'rgba(0,0,0,0)');
    x.addColorStop(.16, 'rgba(0,0,0,.70)');
    x.addColorStop(.38, 'rgba(0,0,0,1)');
    x.addColorStop(.83, 'rgba(0,0,0,1)');
    x.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = x;
    ctx.fillRect(0, 0, w, h);
    const y = ctx.createLinearGradient(0, 0, 0, h);
    y.addColorStop(0, 'rgba(0,0,0,0)');
    y.addColorStop(.13, 'rgba(0,0,0,1)');
    y.addColorStop(.94, 'rgba(0,0,0,1)');
    y.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = y;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  function draw(time) {
    ctx.clearRect(0, 0, w, h);
    const mobile = w < 820;
    const ox = w * (mobile ? .73 : .70);
    const oy = h * (mobile ? .775 : .785) - 10;
    const s = Math.min(w * (mobile ? .105 : .077), h * .16);
    const X = x => ox + x * s;
    const Y = y => oy - y * s;
    const aura = ctx.createRadialGradient(w * .71, h * .695, 0, w * .71, h * .695, Math.max(w, h) * .65);
    aura.addColorStop(0, 'rgba(90,129,200,.14)');
    aura.addColorStop(.43, 'rgba(233,180,95,.055)');
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, w, h);

    // Sparse graph-paper dots instead of a separate graph panel.
    ctx.fillStyle = 'rgba(151,184,235,.18)';
    for (let x = -8; x <= 8; x++) {
      const px = X(x);
      if (px < 0 || px > w) continue;
      for (let py = 10; py < h - 10; py += 18) {
        ctx.beginPath();
        ctx.arc(px, py, .95, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let y = -7; y <= 7; y++) {
      const py = Y(y);
      if (py < 0 || py > h) continue;
      for (let px = 10; px < w - 10; px += 18) {
        ctx.beginPath();
        ctx.arc(px, py, .95, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(188,213,247,.30)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(0, oy);
    ctx.lineTo(w, oy);
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // All three curves remain dotted; visible but restrained drift.
    const flowDots = (f, color, radius, spacing, speed) => {
      const offset = (((-time * speed) % spacing) + spacing) % spacing;
      ctx.fillStyle = color;
      for (let x = -10 + offset; x <= 10; x += spacing) {
        const px = X(x);
        const py = Y(f(x));
        if (px < 0 || px > w || py < 0 || py > h) continue;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    flowDots(curveA, 'rgba(255,215,127,.68)', 1.65, .16, .085);

    // The blue dotted sine profile itself travels left as points drift along it.
    // No solid blue line: retain the original dotted aesthetic.
    const blue = x => curveB(x + time * .15);
    flowDots(blue, 'rgba(167,216,255,.71)', 1.6, .18, .085);

    flowDots(curveC, 'rgba(190,184,255,.40)', 1.4, .18, .07);

    // Static point and mathematically correct tangent to the quadratic.
    const a = 1.1;
    const b = curveA(a);
    const slope = .32 * (a - .7);
    const px = X(a);
    const py = Y(b);
    ctx.strokeStyle = 'rgba(255,232,187,.29)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 7]);
    ctx.beginPath();
    ctx.moveTo(X(a - 1.7), Y(b - slope * 1.7));
    ctx.lineTo(X(a + 1.7), Y(b + slope * 1.7));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,245,218,.95)';
    ctx.beginPath();
    ctx.arc(px, py, 3.4, 0, Math.PI * 2);
    ctx.fill();

    // Minimal geometry diagram, same visual plane as the graph.
    const cx = w * (mobile ? .63 : .58) - 8;
    const cy = h * .435 + 8;
    const r = mobile ? 25 : 32;
    ctx.strokeStyle = 'rgba(241,215,151,.25)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    const v = time * .2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r * Math.cos(v), cy + r * Math.sin(v));
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r * Math.cos(v + 1.1), cy + r * Math.sin(v + 1.1));
    ctx.stroke();

    fadeEdges();
  }

  function stop() {
    if (raf !== null) {
      window.cancelAnimationFrame(raf);
      raf = null;
    }
  }

  function failCanvas() {
    drawingFailed = true;
    stop();
    intersectionObserver?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener?.('resize', start);
  }

  function frame(timestamp) {
    raf = null;
    if (drawingFailed || !canAnimate || reduced.matches || document.hidden || !visible) return;
    if (timestamp - last >= 40) {
      try {
        draw(timestamp / 1000);
        last = timestamp;
      } catch {
        failCanvas();
        return;
      }
    }
    raf = window.requestAnimationFrame(frame);
  }

  function start() {
    stop();
    if (drawingFailed || !visible || document.hidden) return;
    const timestamp = now();
    try {
      resize();
      draw(reduced.matches || !canAnimate ? 0 : timestamp / 1000);
    } catch {
      failCanvas();
      return;
    }
    last = timestamp;
    if (canAnimate && !reduced.matches) raf = window.requestAnimationFrame(frame);
  }

  function handleVisibilityChange() {
    if (document.hidden) stop();
    else start();
  }

  function handleMotionChange() {
    if (visible && !document.hidden) start();
    else if (reduced.matches) stop();
  }

  if (supportsIntersectionObserver) {
    intersectionObserver = new window.IntersectionObserver(entries => {
      const entry = entries.find(item => item.target === hero);
      if (!entry) return;
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    });
    intersectionObserver.observe(hero);
  }

  if (supportsResizeObserver) {
    resizeObserver = new window.ResizeObserver(start);
    resizeObserver.observe(hero);
  } else {
    window.addEventListener('resize', start, { passive: true });
  }

  if (typeof reduced.addEventListener === 'function') reduced.addEventListener('change', handleMotionChange);
  else if (typeof reduced.addListener === 'function') reduced.addListener(handleMotionChange);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  start();
})();

const PRIVATE_STORAGE_KEY = 'sigma-goldenbell-v1';
const PUBLIC_STORAGE_KEY = 'sigma-goldenbell-public-v2';
const AUTH_STORAGE_KEY = 'sigma-goldenbell-auth-v1';
const AUTH_SESSION_KEY = 'sigma-goldenbell-session-v1';
const AUTH_ATTEMPT_KEY = 'sigma-goldenbell-attempts-v1';
const PROJECTOR_SESSION_KEY = 'sigma-goldenbell-projector-session-v1';
const PRE_IMPORT_BACKUP_KEY = 'sigma-goldenbell-pre-import-v1';
const CHANNEL_NAME = 'sigma-goldenbell-projector-v2';
const PBKDF2_ITERATIONS = 210000;
const MAX_IMAGE_FILE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_DATA_LENGTH = 900 * 1024;
const MAX_TOTAL_IMAGE_DATA_LENGTH = 3 * 1024 * 1024;
const SCREEN_MODES = new Set(['lobby', 'opening', 'rules', 'question', 'break', 'ending']);
const TABS = new Set(['live', 'questions', 'settings']);
const params = new URLSearchParams(location.search);
const IS_SCREEN = params.get('view') === 'screen' || params.get('screen') === '1';
const screenHash = new URLSearchParams(location.hash.replace(/^#/, ''));
const SCREEN_SESSION_ID = IS_SCREEN ? screenHash.get('session') : null;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;

const categoryMeta = {
  basic: { label: '기본문제', className: 'blue' },
  hard: { label: '고난도', className: 'red' },
  revival: { label: '스페셜', className: 'green' },
  tiebreak: { label: '등수결정', className: 'yellow' },
};

const screenModeMeta = {
  lobby: { label: '대기 화면', shortLabel: '대기' },
  opening: { label: '오프닝 화면', shortLabel: '오프닝' },
  rules: { label: '진행 안내', shortLabel: '안내' },
  question: { label: '문제 화면', shortLabel: '문제' },
  break: { label: '휴식 화면', shortLabel: '휴식' },
  ending: { label: '마침 화면', shortLabel: '마침' },
};

let state = null;
let publicState = null;
let timerHandle = null;
let modal = null;
let authMessage = '';

function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function createPlaceholderQuestions() {
  const specs = [
    ['basic', 35],
    ['hard', 10],
    ['revival', 5],
    ['tiebreak', 10],
  ];
  let order = 1;
  return specs.flatMap(([category, count]) =>
    Array.from({ length: count }, (_, index) => ({
      id: createId(),
      order: order++,
      category,
      title: `${categoryMeta[category].label} ${index + 1}`,
      question: '',
      answer: '',
      explanation: '',
      note: '',
      image: '',
      imageAlt: '',
      seconds: category === 'tiebreak' ? 45 : 30,
    }))
  );
}

function defaultState() {
  return {
    event: {
      title: '2026 시그마 수학 골든벨',
      date: '2026.10.23(금) 15:50~17:30',
      place: '체육관',
    },
    messages: {
      lobby: '잠시 후 시작합니다',
      opening: '지금, 골든벨을 시작합니다',
      tagline: '수학으로 하나 되는 시간',
      rules: '문제가 나오면 제한시간 안에 답을 적어주세요.\n정답 공개 전까지 답판을 들지 말아주세요.\n판정이 애매한 경우 진행자의 안내를 따라주세요.',
      break: '잠시 쉬어갑니다',
      ending: '도전해 주신 여러분, 고맙습니다',
    },
    questions: createPlaceholderQuestions(),
    currentIndex: 0,
    answerVisible: false,
    displayMode: 'lobby',
    timer: { remaining: 30, running: false, endAt: null },
    tab: 'live',
  };
}

function safeText(value, maxLength = 5000) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function projectionText(value, maxLength) {
  const text = safeText(value, 5000);
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

function safeImage(value) {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_DATA_LENGTH) return '';
  return /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value) ? value : '';
}

function totalImageDataLength(questions) {
  return questions.reduce((total, question) => total + (question.image?.length || 0), 0);
}

function hasProjectionOverflow(question) {
  return Boolean(question && (
    question.question.length > 600 ||
    question.answer.length > 200 ||
    question.explanation.length > 400
  ));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeState(candidate) {
  const base = defaultState();
  const raw = candidate && typeof candidate === 'object' ? candidate : {};
  const rawEvent = raw.event && typeof raw.event === 'object' ? raw.event : {};
  const rawMessages = raw.messages && typeof raw.messages === 'object' ? raw.messages : {};
  const questions = Array.isArray(raw.questions)
    ? raw.questions.slice(0, 500).map((question, index) => {
        const item = question && typeof question === 'object' ? question : {};
        const category = Object.hasOwn(categoryMeta, item.category) ? item.category : 'basic';
        return {
          id: /^[\w-]{8,80}$/.test(String(item.id || '')) ? String(item.id) : createId(),
          order: index + 1,
          category,
          title: (() => {
            const title = safeText(item.title, 100);
            if (category === 'revival' && /^패자부활 \d+$/.test(title)) return title.replace('패자부활', '스페셜');
            return title || `${categoryMeta[category].label} ${index + 1}`;
          })(),
          question: safeText(item.question, 2000),
          answer: safeText(item.answer, 500),
          explanation: safeText(item.explanation, 1500),
          note: safeText(item.note, 2000),
          image: safeImage(item.image),
          imageAlt: safeText(item.imageAlt, 160).trim(),
          seconds: Math.round(clampNumber(item.seconds, 1, 600, category === 'tiebreak' ? 45 : 30)),
        };
      })
    : base.questions;
  const currentIndex = questions.length
    ? Math.round(clampNumber(raw.currentIndex, 0, questions.length - 1, 0))
    : 0;
  const current = questions[currentIndex];
  const rawTimer = raw.timer && typeof raw.timer === 'object' ? raw.timer : {};
  let running = Boolean(rawTimer.running) && Number.isFinite(Number(rawTimer.endAt));
  let endAt = running ? Number(rawTimer.endAt) : null;
  let remaining = clampNumber(rawTimer.remaining, 0, 600, current?.seconds || 30);
  if (running) {
    remaining = Math.max(0, (endAt - Date.now()) / 1000);
    if (remaining <= 0) {
      running = false;
      endAt = null;
      remaining = 0;
    }
  }
  return {
    event: {
      title: safeText(rawEvent.title, 100).trim() || base.event.title,
      date: safeText(rawEvent.date, 100).trim(),
      place: safeText(rawEvent.place, 100).trim(),
    },
    messages: {
      lobby: safeText(rawMessages.lobby, 100).trim() || base.messages.lobby,
      opening: safeText(rawMessages.opening, 100).trim() || base.messages.opening,
      tagline: safeText(rawMessages.tagline, 100).trim() || base.messages.tagline,
      rules: safeText(rawMessages.rules, 2000).trim() || base.messages.rules,
      break: safeText(rawMessages.break, 100).trim() || base.messages.break,
      ending: safeText(rawMessages.ending, 100).trim() || base.messages.ending,
    },
    questions,
    currentIndex,
    answerVisible: Boolean(raw.answerVisible),
    displayMode: SCREEN_MODES.has(raw.displayMode) ? raw.displayMode : 'lobby',
    timer: { remaining, running, endAt },
    tab: TABS.has(raw.tab) ? raw.tab : 'live',
  };
}

function loadPrivateState() {
  try {
    const raw = localStorage.getItem(PRIVATE_STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : defaultState();
  } catch {
    return defaultState();
  }
}

function loadPublicState() {
  try {
    const raw = localStorage.getItem(PUBLIC_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!SCREEN_SESSION_ID || parsed?.sessionId !== SCREEN_SESSION_ID) return null;
    if (parsed.answerVisible && Date.now() - Number(parsed.publishedAt || 0) > 120000) {
      parsed.answerVisible = false;
      if (parsed.question) {
        parsed.question.answer = '';
        parsed.question.explanation = '';
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function getProjectorSessionId() {
  let sessionId = sessionStorage.getItem(PROJECTOR_SESSION_KEY);
  if (!sessionId) {
    sessionId = createId();
    sessionStorage.setItem(PROJECTOR_SESSION_KEY, sessionId);
  }
  return sessionId;
}

function currentQuestion() {
  return state?.questions[state.currentIndex] || null;
}

function getTimerRemaining(timer = state?.timer || publicState?.timer) {
  if (!timer) return 0;
  return timer.running && timer.endAt
    ? Math.max(0, (Number(timer.endAt) - Date.now()) / 1000)
    : Math.max(0, Number(timer.remaining) || 0);
}

function buildPublicState() {
  const question = currentQuestion();
  const mayShowQuestion = state.displayMode === 'question';
  const mayShowAnswer = mayShowQuestion && state.answerVisible;
  return {
    version: 2,
    sessionId: getProjectorSessionId(),
    event: { ...state.event },
    messages: { ...state.messages, rules: projectionText(state.messages.rules, 1200) },
    displayMode: state.displayMode,
    currentIndex: state.currentIndex,
    totalQuestions: state.questions.length,
    question: mayShowQuestion && question ? {
      title: question.title,
      question: projectionText(question.question, 600),
      category: question.category,
      seconds: question.seconds,
      answer: mayShowAnswer ? projectionText(question.answer, 200) : '',
      explanation: mayShowAnswer ? projectionText(question.explanation, 400) : '',
      image: safeImage(question.image),
      imageAlt: safeText(question.imageAlt, 160),
    } : null,
    answerVisible: mayShowAnswer,
    timer: { ...state.timer, remaining: getTimerRemaining(state.timer) },
    publishedAt: Date.now(),
  };
}

function publishPublicState({ broadcast = true } = {}) {
  if (!state) return;
  const next = buildPublicState();
  try {
    localStorage.setItem(PUBLIC_STORAGE_KEY, JSON.stringify(next));
  } catch {
    if (!IS_SCREEN) toast('사진 용량이 너무 커 프로젝터로 보낼 수 없습니다. 사진을 교체해주세요.');
    return false;
  }
  if (broadcast) channel?.postMessage({ type: 'public-state', state: next });
  return true;
}

function saveState({ broadcast = true } = {}) {
  if (!state) return;
  try {
    localStorage.setItem(PRIVATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast('브라우저 저장 공간이 부족합니다. 사진을 줄이거나 JSON 백업 후 정리해주세요.');
    return false;
  }
  publishPublicState({ broadcast });
  return true;
}

function syncPrivateState(next) {
  if (!state || IS_SCREEN) return;
  state = normalizeState(next);
  render();
  syncTicker();
}

function syncPublicState(next) {
  if (!IS_SCREEN || !next || typeof next !== 'object' || !SCREEN_SESSION_ID || next.sessionId !== SCREEN_SESSION_ID) return;
  publicState = next;
  renderScreen();
  syncTicker();
}

channel?.addEventListener('message', event => {
  if (event.data?.type === 'public-state') syncPublicState(event.data.state);
});

window.addEventListener('storage', event => {
  if (IS_SCREEN && event.key === PUBLIC_STORAGE_KEY && event.newValue) {
    try { syncPublicState(JSON.parse(event.newValue)); } catch {}
  }
  if (!IS_SCREEN && state && event.key === PRIVATE_STORAGE_KEY && event.newValue) {
    try { syncPrivateState(JSON.parse(event.newValue)); } catch {}
  }
});

function update(mutator, options = {}) {
  const previous = structuredClone(state);
  mutator(state);
  if (!saveState(options)) state = previous;
  render();
  syncTicker();
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function multiline(value = '') {
  return esc(value).replace(/\r?\n/g, '<br>');
}

function questionSizeClass(value = '') {
  const length = String(value).replace(/\s/g, '').length;
  if (length > 300) return 'xlong';
  if (length > 180) return 'very-long';
  if (length > 115) return 'long';
  if (length > 65) return 'medium';
  return 'short';
}

function answerSizeClass(value = '') {
  const length = String(value).replace(/\s/g, '').length;
  if (length > 100) return 'long';
  if (length > 50) return 'medium';
  return 'short';
}

function toast(message) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.setAttribute('role', 'status');
  element.textContent = message;
  document.body.appendChild(element);
  setTimeout(() => element.remove(), 2400);
}

function formatTime(seconds) {
  const value = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, '0')}` : String(rest);
}

function categoryBadge(question) {
  const meta = categoryMeta[question?.category] || categoryMeta.basic;
  return `<span class="badge ${meta.className}">${esc(meta.label)}</span>`;
}

function timerClass(timer) {
  const remaining = getTimerRemaining(timer);
  return remaining <= 0 ? 'expired' : remaining <= 5 ? 'danger' : '';
}

function refreshTimerDom() {
  const timer = IS_SCREEN ? publicState?.timer : state?.timer;
  if (!timer) return;
  const remaining = getTimerRemaining(timer);
  document.querySelectorAll('[data-timer-value]').forEach(element => {
    element.textContent = formatTime(remaining);
    element.classList.toggle('danger', remaining > 0 && remaining <= 5);
    element.classList.toggle('expired', remaining <= 0);
  });
  document.querySelectorAll('[data-timer-label]').forEach(element => {
    element.textContent = remaining <= 0 ? '시간 종료' : '남은 시간';
  });
  document.querySelectorAll('[data-timer-progress]').forEach(element => {
    const total = IS_SCREEN ? publicState?.question?.seconds : currentQuestion()?.seconds;
    const percent = total ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
    element.style.width = `${percent}%`;
  });
  if (remaining <= 0 && timer.running) {
    timer.running = false;
    timer.endAt = null;
    timer.remaining = 0;
    if (!IS_SCREEN) saveState();
    clearInterval(timerHandle);
    timerHandle = null;
    render();
  }
}

function syncTicker() {
  const timer = IS_SCREEN ? publicState?.timer : state?.timer;
  clearInterval(timerHandle);
  timerHandle = null;
  refreshTimerDom();
  if (timer?.running) timerHandle = setInterval(refreshTimerDom, 200);
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function derivePin(pin, salt, iterations = PBKDF2_ITERATIONS) {
  if (!crypto.subtle) throw new Error('secure-context-required');
  const source = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    source,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}

function loadAuthRecord() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (!record?.salt || !record?.hash || !Number.isFinite(Number(record.iterations))) return null;
    return record;
  } catch {
    return null;
  }
}

function isUnlocked() {
  const record = loadAuthRecord();
  return Boolean(record && sessionStorage.getItem(AUTH_SESSION_KEY) === record.hash);
}

function loadAttemptState() {
  try {
    return JSON.parse(sessionStorage.getItem(AUTH_ATTEMPT_KEY)) || { failures: 0, lockedUntil: 0 };
  } catch {
    return { failures: 0, lockedUntil: 0 };
  }
}

function saveAttemptState(attempts) {
  sessionStorage.setItem(AUTH_ATTEMPT_KEY, JSON.stringify(attempts));
}

function renderAuth() {
  const setup = !loadAuthRecord();
  const attempts = loadAttemptState();
  const lockedSeconds = Math.max(0, Math.ceil((attempts.lockedUntil - Date.now()) / 1000));
  document.getElementById('app').innerHTML = `
    <main class="auth-shell">
      <section class="auth-card" aria-labelledby="auth-title">
        <div class="auth-brand" aria-hidden="true">Σ</div>
        <p class="eyebrow">진행자 전용 콘솔</p>
        <h1 id="auth-title">${setup ? '접근 PIN을 만들어주세요' : '진행 PIN을 입력하세요'}</h1>
        <p class="auth-copy">${setup
          ? '이 브라우저의 프레젠테이션 콘솔을 잠글 4~12자리 숫자 PIN을 설정합니다.'
          : '문제·정답·진행 메모는 잠금 해제 후에만 열립니다.'}</p>
        <form id="auth-form" class="auth-form" novalidate>
          <label for="pin">${setup ? '새 PIN' : '진행 PIN'}</label>
          <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="12" autocomplete="${setup ? 'new-password' : 'current-password'}" aria-describedby="auth-help auth-error" ${lockedSeconds ? 'disabled' : ''} required />
          ${setup ? `<label for="pin-confirm">PIN 확인</label><input id="pin-confirm" name="pin-confirm" type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="12" autocomplete="new-password" required />` : ''}
          <div id="auth-error" class="auth-error" role="alert">${lockedSeconds ? `${lockedSeconds}초 후에 다시 시도해주세요.` : esc(authMessage)}</div>
          <button class="btn primary auth-submit" type="submit" ${lockedSeconds ? 'disabled' : ''}>${setup ? 'PIN 설정하고 시작' : '관리 화면 열기'}</button>
        </form>
        <div id="auth-help" class="auth-help"><strong>로컬 진행 모드</strong><span>프로젝터는 읽기 전용이며, 이 탭을 닫으면 다시 PIN을 요청합니다.</span></div>
      </section>
    </main>`;
  document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);
  if (lockedSeconds) setTimeout(renderAuth, Math.min(1000, lockedSeconds * 1000));
  else requestAnimationFrame(() => document.getElementById('pin')?.focus());
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const pin = form.elements.pin.value.trim();
  const setup = !loadAuthRecord();
  if (!/^\d{4,12}$/.test(pin)) {
    authMessage = '4~12자리 숫자 PIN을 입력해주세요.';
    return renderAuth();
  }
  if (setup && pin !== form.elements['pin-confirm'].value.trim()) {
    authMessage = 'PIN 확인이 일치하지 않습니다.';
    return renderAuth();
  }
  button.disabled = true;
  button.textContent = '확인 중…';
  try {
    if (setup) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await derivePin(pin, salt);
      const record = { version: 1, salt: bytesToBase64(salt), hash, iterations: PBKDF2_ITERATIONS, createdAt: new Date().toISOString() };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(record));
      sessionStorage.setItem(AUTH_SESSION_KEY, hash);
    } else {
      const record = loadAuthRecord();
      const attempts = loadAttemptState();
      if (attempts.lockedUntil > Date.now()) return renderAuth();
      const hash = await derivePin(pin, base64ToBytes(record.salt), Number(record.iterations));
      if (hash !== record.hash) {
        attempts.failures += 1;
        if (attempts.failures >= 5) {
          attempts.failures = 0;
          attempts.lockedUntil = Date.now() + 30000;
          authMessage = 'PIN 오류가 반복되어 30초간 잠겼습니다.';
        } else {
          authMessage = `PIN이 맞지 않습니다. ${5 - attempts.failures}번 더 시도할 수 있습니다.`;
        }
        saveAttemptState(attempts);
        return renderAuth();
      }
      sessionStorage.setItem(AUTH_SESSION_KEY, record.hash);
      sessionStorage.removeItem(AUTH_ATTEMPT_KEY);
    }
    authMessage = '';
    state = loadPrivateState();
    saveState();
    render();
    syncTicker();
  } catch (error) {
    authMessage = error.message === 'secure-context-required'
      ? 'PIN 보호를 위해 localhost 또는 HTTPS로 열어주세요.'
      : 'PIN을 처리하지 못했습니다. 다시 시도해주세요.';
    renderAuth();
  }
}

function render() {
  if (IS_SCREEN) return renderScreen();
  if (!isUnlocked()) {
    state = null;
    return renderAuth();
  }
  if (!state) state = loadPrivateState();
  document.getElementById('app').innerHTML = `
    <div class="app-frame">
      <header class="topbar">
        <div class="brand"><div class="logo" aria-hidden="true">Σ</div><div><p class="eyebrow">프레젠테이션 콘솔</p><h1>${esc(state.event.title)}</h1><p class="event-meta">${esc(state.event.date)}${state.event.date && state.event.place ? '<span>·</span>' : ''}${esc(state.event.place)}</p></div></div>
        <div class="top-actions"><span class="live-chip"><span></span>${esc(screenModeMeta[state.displayMode].label)}</span><button class="btn screen-launch" data-action="open-screen">프로젝터 열기</button><button class="btn ghost" data-action="lock">잠금</button></div>
      </header>
      <nav class="tabs" aria-label="주요 메뉴">
        ${[['live', '실시간 진행'], ['questions', '문제 편집'], ['settings', '행사·슬라이드 설정']]
          .map(([id, label]) => `<button class="tab ${state.tab === id ? 'active' : ''}" data-tab="${id}" aria-current="${state.tab === id ? 'page' : 'false'}">${label}</button>`).join('')}
      </nav>
      <main class="workspace">${renderTab()}</main>
    </div>
    ${modal ? renderModal() : ''}
    <div class="sr-only" aria-live="polite" id="live-region"></div>`;
  bindEvents();
  if (modal) focusModal();
  refreshTimerDom();
}

function renderTab() {
  if (state.tab === 'questions') return renderQuestions();
  if (state.tab === 'settings') return renderSettings();
  return renderLive();
}

function renderPreview() {
  const question = currentQuestion();
  const mode = state.displayMode;
  if (mode === 'rules') {
    const rules = state.messages.rules.split(/\r?\n/).filter(Boolean).slice(0, 6).map(rule => safeText(rule, 180));
    return `<div class="preview-scene preview-rules"><p>HOW TO PLAY</p><strong>진행 안내</strong><ol>${rules.map(rule => `<li>${esc(rule)}</li>`).join('')}</ol></div>`;
  }
  if (mode !== 'question') {
    const copy = state.messages[mode] || state.messages.lobby;
    const kicker = mode === 'lobby' ? 'SIGMA GOLDEN BELL' : mode === 'opening' ? 'LET\'S BEGIN' : mode === 'break' ? 'BREAK TIME' : 'THANK YOU';
    return `<div class="preview-scene preview-${mode}"><div class="preview-watermark" aria-hidden="true">Σ</div><p>${esc(kicker)}</p><strong>${esc(copy)}</strong><span>${esc(state.messages.tagline)}</span></div>`;
  }
  if (!question) return `<div class="preview-scene"><strong>문제를 준비 중입니다.</strong></div>`;
  const meta = categoryMeta[question.category] || categoryMeta.basic;
  const image = safeImage(question.image);
  return `
    <div class="preview-question-scene ${state.answerVisible ? 'show-answer' : ''}">
      <div class="preview-topline"><span>${esc(meta.label)}</span><span>${state.currentIndex + 1} / ${state.questions.length}</span></div>
      <div class="preview-question-content ${image ? 'has-image' : ''}">${image ? `<img class="preview-question-image" src="${image}" alt="${esc(question.imageAlt || '문제 참고 이미지')}">` : ''}<div class="preview-question ${questionSizeClass(projectionText(question.question, 600))}">${multiline(projectionText(question.question, 600) || '문제를 준비 중입니다.')}</div></div>
      ${state.answerVisible ? `<div class="preview-answer"><small>정답</small><strong class="${answerSizeClass(projectionText(question.answer, 200))}">${multiline(projectionText(question.answer, 200) || '정답 미입력')}</strong>${question.explanation ? `<span>${multiline(projectionText(question.explanation, 400))}</span>` : ''}</div>` : ''}
      <div class="preview-bottomline"><span>${esc(question.title)}</span><strong data-timer-value class="${timerClass(state.timer)}">${formatTime(getTimerRemaining(state.timer))}</strong></div>
    </div>`;
}

function presentationAdvanceLabel() {
  if (state.displayMode === 'lobby') return '오프닝 시작';
  if (state.displayMode === 'opening') return '진행 안내 보기';
  if (state.displayMode === 'rules') return `${state.currentIndex + 1}번 문제 시작`;
  if (state.displayMode === 'break') return `${state.currentIndex + 1}번 문제로 돌아가기`;
  if (state.displayMode === 'ending') return '대기 화면으로';
  if (!state.answerVisible) return '정답 공개';
  return state.currentIndex < state.questions.length - 1 ? '다음 문제' : '마침 화면';
}

function renderLive() {
  const question = currentQuestion();
  const total = state.questions.length;
  const progress = total ? ((state.currentIndex + 1) / total) * 100 : 0;
  const missingQuestions = state.questions.filter(item => !item.question || !item.answer || hasProjectionOverflow(item)).length;
  const remaining = getTimerRemaining(state.timer);
  return `
    <div class="live-layout">
      <section class="stack">
        <article class="card stage-card">
          <div class="section-head stage-heading"><div><p class="eyebrow">프로젝터 미리보기</p><h2>${esc(screenModeMeta[state.displayMode].label)}</h2></div><button class="btn sm" data-action="open-screen">새 창으로 열기</button></div>
          <div class="stage-preview" aria-label="프로젝터 화면 미리보기">${renderPreview()}</div>
          ${question ? `<div class="primary-controls"><button class="btn timer-toggle" data-action="timer-toggle"><span>${state.timer.running ? '타이머 일시정지' : remaining <= 0 ? '타이머 다시 시작' : '타이머 시작'}</span><kbd>Space</kbd></button><button class="btn presentation-next" data-action="next-step" ${state.displayMode === 'question' && !state.answerVisible && !question.answer ? 'disabled' : ''}><span>${presentationAdvanceLabel()}</span><kbd>→</kbd></button></div>
          <div class="transport-controls"><button class="btn" data-action="prev" ${state.currentIndex === 0 ? 'disabled' : ''}>← 이전 문제</button><button class="btn" data-action="reset-timer">시간 초기화</button><button class="btn" data-action="edit-current">현재 문제 수정</button><button class="btn" data-action="next" ${state.currentIndex >= total - 1 ? 'disabled' : ''}>다음 문제 →</button></div>` : `<div class="empty-state compact"><p>문제 편집에서 첫 문제를 추가해주세요.</p></div>`}
        </article>
        ${question ? `<article class="card current-question-card"><div class="stage-line"><div class="row">${categoryBadge(question)}<span class="question-index">전체 ${state.currentIndex + 1} / ${total}</span></div><span class="question-title">${esc(question.title)}</span></div>${question.image ? `<img class="operator-question-image" src="${safeImage(question.image)}" alt="${esc(question.imageAlt || '문제 참고 이미지')}">` : ''}<div class="operator-question ${questionSizeClass(question.question)}">${multiline(question.question || '아직 문제 내용이 입력되지 않았습니다.')}</div><div class="operator-answer ${state.answerVisible ? 'visible' : ''}"><span>정답</span><strong>${multiline(question.answer || '미입력')}</strong>${question.explanation ? `<p>${multiline(question.explanation)}</p>` : ''}${question.note ? `<small>진행 메모 · ${multiline(question.note)}</small>` : ''}</div></article>` : ''}
      </section>
      <aside class="stack control-rail">
        ${question ? `<article class="card timer-card"><div class="timer-status"><span data-timer-label>${remaining <= 0 ? '시간 종료' : '남은 시간'}</span><span>${question.seconds}초 문제</span></div><div class="timer ${timerClass(state.timer)}" data-timer-value>${formatTime(remaining)}</div><div class="timer-track"><div data-timer-progress></div></div><div class="timer-adjust"><button class="btn sm" data-action="timer-minus">-5초</button><button class="btn sm" data-action="reset-timer">초기화</button><button class="btn sm" data-action="timer-plus">+5초</button></div></article>` : ''}
        <article class="card mode-card"><div class="section-head"><div><p class="eyebrow">PPT 대신 송출</p><h2>슬라이드 선택</h2></div></div><div class="mode-grid">${Object.entries(screenModeMeta).map(([id, meta]) => `<button class="mode-button ${state.displayMode === id ? 'active' : ''}" data-screen-mode="${id}" aria-pressed="${state.displayMode === id}"><span class="mode-dot"></span>${esc(meta.shortLabel)}</button>`).join('')}</div><p class="sub mode-help">대기·오프닝·안내·휴식·마침 슬라이드를 바로 송출할 수 있습니다.</p></article>
        <article class="card overview-card"><div class="section-head"><div><p class="eyebrow">프레젠테이션 진행</p><h2>${total ? `${state.currentIndex + 1}번 문제` : '문제 없음'}</h2></div><strong>${Math.round(progress)}%</strong></div><div class="progress"><div style="width:${progress}%"></div></div><div class="stat-grid"><div class="stat"><span>전체 문제</span><strong>${total}</strong></div><div class="stat ${missingQuestions ? 'warning' : ''}"><span>확인 필요</span><strong>${missingQuestions}</strong></div></div></article>
        <article class="card shortcut-card"><h2>진행 단축키</h2><div class="shortcut-list"><span><kbd>Space</kbd>타이머</span><span><kbd>A</kbd>정답</span><span><kbd>←</kbd><kbd>→</kbd>문제 이동</span><span><kbd>B</kbd>휴식</span><span><kbd>E</kbd>마침</span></div></article>
      </aside>
    </div>`;
}

function renderQuestions() {
  const counts = Object.keys(categoryMeta).map(key => [key, state.questions.filter(question => question.category === key).length]);
  const missing = state.questions.filter(question => !question.question || !question.answer || hasProjectionOverflow(question)).length;
  return `
    <div class="content-layout">
      <section class="card content-card"><div class="section-head responsive-head"><div><p class="eyebrow">출제 콘솔</p><h2>문제 슬라이드</h2><p class="sub">총 ${state.questions.length}문제 · 확인 필요 ${missing}문제</p></div><button class="btn primary" data-action="add-question">+  문제 추가</button></div>
      <div class="filter-row">${counts.map(([key, count]) => `<span class="badge ${categoryMeta[key].className}">${categoryMeta[key].label} ${count}</span>`).join('')}</div>
      ${state.questions.length ? `<div class="q-list">${state.questions.map((question, index) => `<article class="q-item ${index === state.currentIndex ? 'current' : ''} ${!question.question || !question.answer || hasProjectionOverflow(question) ? 'incomplete' : ''}"><div class="q-no"><span>${String(index + 1).padStart(2, '0')}</span>${index === state.currentIndex ? '<small>현재</small>' : ''}</div><div class="q-copy"><strong>${esc(question.question || question.title || '미입력 문제')}</strong><span>${esc(categoryMeta[question.category].label)} · ${question.seconds}초${question.image ? ' · 사진 포함' : ''}${!question.question || !question.answer ? ' · 문제/정답 확인 필요' : hasProjectionOverflow(question) ? ' · 프로젝터 길이 확인 필요' : question.explanation ? ' · 해설 포함' : ''}</span></div><div class="q-actions"><button class="btn sm" data-edit-q="${esc(question.id)}">수정</button><button class="btn sm" data-go-q="${index}">송출</button><button class="btn sm danger-ghost" data-delete-q="${esc(question.id)}">삭제</button></div></article>`).join('')}</div>` : `<div class="empty-state"><h3>문제가 없습니다</h3><p>새 문제를 추가해주세요.</p></div>`}</section>
      <aside class="stack side-notes"><article class="card"><p class="eyebrow">현장 전 확인</p><h2>프레젠테이션 체크</h2><ul class="check-list"><li class="${missing ? '' : 'done'}">문제와 정답 입력</li><li>수식·기호의 프로젝터 가독성</li><li>문제별 제한시간</li><li>정답 해설과 진행 메모 구분</li><li>예비 JSON 백업</li></ul></article><article class="card note-card"><strong>PPT처럼 사용하기</strong><p>문제 하나가 슬라이드 하나입니다. 정답 공개 버튼을 누르면 같은 화면에서 정답과 해설이 이어서 나옵니다.</p></article></aside>
    </div>`;
}

function renderSettings() {
  return `
    <div class="settings-grid"><section class="stack"><article class="card content-card"><p class="eyebrow">행사 정보</p><h2>프레젠테이션 설정</h2><form id="settings-form" class="form-grid settings-form">
      <div class="field wide"><label for="event-title">행사명</label><input id="event-title" maxlength="100" value="${esc(state.event.title)}"></div><div class="field"><label for="event-date">일시</label><input id="event-date" maxlength="100" value="${esc(state.event.date)}"></div><div class="field"><label for="event-place">장소</label><input id="event-place" maxlength="100" value="${esc(state.event.place)}"></div>
      <div class="field wide"><label for="message-tagline">공통 부제</label><input id="message-tagline" maxlength="100" value="${esc(state.messages.tagline)}"></div><div class="field wide"><label for="message-lobby">대기 슬라이드</label><input id="message-lobby" maxlength="100" value="${esc(state.messages.lobby)}"></div><div class="field wide"><label for="message-opening">오프닝 슬라이드</label><input id="message-opening" maxlength="100" value="${esc(state.messages.opening)}"></div><div class="field wide"><label for="message-rules">진행 안내 (한 줄에 하나씩)</label><textarea id="message-rules" maxlength="2000">${esc(state.messages.rules)}</textarea><span class="field-help">프로젝터에는 최대 1,200자까지만 표시됩니다.</span></div><div class="field wide"><label for="message-break">휴식 슬라이드</label><input id="message-break" maxlength="100" value="${esc(state.messages.break)}"></div><div class="field wide"><label for="message-ending">마침 슬라이드</label><input id="message-ending" maxlength="100" value="${esc(state.messages.ending)}"></div><div class="wide"><button class="btn primary" type="submit">설정 저장</button></div>
    </form></article></section>
    <aside class="stack"><article class="card"><p class="eyebrow">접근 보호</p><h2>진행 PIN 변경</h2><div class="form-grid one-column"><div class="field"><label for="current-pin">현재 PIN</label><input id="current-pin" type="password" inputmode="numeric" maxlength="12" autocomplete="current-password"></div><div class="field"><label for="new-pin">새 PIN (4~12자리 숫자)</label><input id="new-pin" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div><div class="field"><label for="new-pin-confirm">새 PIN 확인</label><input id="new-pin-confirm" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div><button class="btn" data-action="change-pin">PIN 변경</button></div><p class="security-caption">이 PIN은 진행 노트북의 관리 화면을 잠그는 용도입니다. 공개 인터넷 서비스용 계정 인증은 아닙니다.</p></article>
      <article class="card"><p class="eyebrow">현장 백업</p><h2>데이터 보관</h2><p class="sub">문제와 슬라이드 문구는 이 브라우저에 자동 저장됩니다. 행사 전날과 시작 직전에 JSON 백업을 받아두세요.</p><div class="data-actions"><button class="btn" data-action="export">JSON 백업</button><label class="btn file-button">백업 불러오기<input data-action="import" type="file" accept="application/json" hidden></label><button class="btn danger-ghost" data-action="reset-all">전체 초기화</button></div></article>
      <article class="card local-note"><strong>한 노트북 진행 구조</strong><p>배포본에서도 진행자와 프로젝터 창은 같은 브라우저에서 연결됩니다. 다른 노트북에서는 JSON 백업을 불러와 이어갈 수 있습니다.</p></article>
    </aside></div>`;
}

function renderScreen() {
  const app = document.getElementById('app');
  if (!publicState) {
    app.innerHTML = `<main class="screen-mode screen-waiting"><div class="screen-watermark" aria-hidden="true">Σ</div><section class="screen-message"><p>PROJECTOR</p><h1>진행자 화면에 연결 중입니다</h1><span>진행자 콘솔을 먼저 열어주세요.</span></section>${renderScreenTool()}</main>`;
    bindScreenEvents();
    return;
  }
  const mode = SCREEN_MODES.has(publicState.displayMode) ? publicState.displayMode : 'lobby';
  const event = publicState.event || {};
  const messages = publicState.messages || {};
  if (mode === 'rules') {
    const rules = safeText(messages.rules, 1200).split(/\r?\n/).filter(Boolean).slice(0, 6).map(rule => safeText(rule, 180));
    app.innerHTML = `<main class="screen-mode screen-rules"><header class="screen-head"><div class="screen-brand"><span>Σ</span>${esc(event.title || '시그마 수학 골든벨')}</div><div class="screen-status"><span></span>진행 안내</div></header><section class="screen-rules-wrap"><p>HOW TO PLAY</p><h1>진행 안내</h1><ol>${rules.map(rule => `<li>${esc(rule)}</li>`).join('')}</ol></section><footer class="screen-simple-footer"><span>${esc(messages.tagline || '')}</span><span>SIGMA</span></footer>${renderScreenTool()}</main>`;
    bindScreenEvents();
    return;
  }
  if (mode !== 'question') {
    const title = messages[mode] || messages.lobby || '잠시 후 시작합니다';
    const kicker = mode === 'lobby' ? 'SIGMA GOLDEN BELL' : mode === 'opening' ? 'LET\'S BEGIN' : mode === 'break' ? 'BREAK TIME' : 'THANK YOU';
    app.innerHTML = `<main class="screen-mode screen-${mode}"><header class="screen-head"><div class="screen-brand"><span>Σ</span>${esc(event.title || '시그마 수학 골든벨')}</div><div class="screen-status"><span></span>${esc(screenModeMeta[mode].label)}</div></header><div class="screen-watermark" aria-hidden="true">Σ</div><section class="screen-message"><p>${esc(kicker)}</p><h1>${esc(title)}</h1><span>${mode === 'lobby' ? `${esc(event.date || '')}${event.date && event.place ? ' · ' : ''}${esc(event.place || '')}` : esc(messages.tagline || '')}</span></section><footer class="screen-simple-footer"><span>${esc(messages.tagline || '')}</span><span>SIGMA</span></footer>${renderScreenTool()}</main>`;
    bindScreenEvents();
    return;
  }
  const question = publicState.question;
  if (!question) {
    app.innerHTML = `<main class="screen-mode screen-waiting"><section class="screen-message"><p>PLEASE WAIT</p><h1>문제를 준비 중입니다</h1></section>${renderScreenTool()}</main>`;
    bindScreenEvents();
    return;
  }
  const category = categoryMeta[question.category] || categoryMeta.basic;
  const remaining = getTimerRemaining(publicState.timer);
  const image = safeImage(question.image);
  app.innerHTML = `<main class="screen-mode screen-question-mode ${publicState.answerVisible ? 'answer-open' : ''}"><header class="screen-head"><div class="screen-brand"><span>Σ</span>${esc(event.title || '시그마 수학 골든벨')}</div><div class="screen-round"><span class="screen-category ${category.className}">${esc(category.label)}</span><strong>${Number(publicState.currentIndex) + 1}</strong><span>/ ${Number(publicState.totalQuestions) || 0}</span></div></header><section class="screen-question-wrap"><p class="screen-q-title">${esc(question.title || `문제 ${Number(publicState.currentIndex) + 1}`)}</p><div class="screen-question-content ${image ? 'has-image' : ''}">${image ? `<img class="screen-question-image" src="${image}" alt="${esc(question.imageAlt || '문제 참고 이미지')}">` : ''}<h1 class="screen-question ${questionSizeClass(question.question)}">${multiline(question.question || '문제를 준비 중입니다.')}</h1></div>${publicState.answerVisible ? `<div class="screen-answer"><span>정답</span><strong class="${answerSizeClass(question.answer)}">${multiline(question.answer || '정답 미입력')}</strong>${question.explanation ? `<p>${multiline(question.explanation)}</p>` : ''}</div>` : ''}</section><footer class="screen-footer"><div class="screen-timer-copy"><span data-timer-label>${remaining <= 0 ? '시간 종료' : '남은 시간'}</span><strong data-timer-value class="${timerClass(publicState.timer)}">${formatTime(remaining)}</strong></div><div class="screen-motto">${esc(messages.tagline || 'SIGMA GOLDEN BELL')}</div></footer><div class="screen-progress"><div data-timer-progress></div></div>${renderScreenTool()}</main>`;
  bindScreenEvents();
  refreshTimerDom();
}

function renderScreenTool() {
  return `<button class="screen-tool" data-screen-action="fullscreen" aria-label="프로젝터 전체 화면">전체 화면</button>`;
}

function bindScreenEvents() {
  document.querySelector('[data-screen-action="fullscreen"]')?.addEventListener('click', async () => {
    try { await document.documentElement.requestFullscreen?.(); } catch {}
  });
}

function renderModal() {
  if (modal.type !== 'question') return '';
  const question = modal.question;
  return `<div class="modal-backdrop" data-action="close-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="section-head"><div><p class="eyebrow">출제 콘솔</p><h2 id="modal-title">${question.id ? '문제 수정' : '문제 추가'}</h2></div><button class="btn sm ghost" data-action="close-modal" aria-label="닫기">닫기</button></div><div class="form-grid"><div class="field"><label for="q-category">구분</label><select id="q-category">${Object.entries(categoryMeta).map(([key, value]) => `<option value="${key}" ${question.category === key ? 'selected' : ''}>${value.label}</option>`).join('')}</select></div><div class="field"><label for="q-seconds">제한시간(초)</label><input id="q-seconds" type="number" min="1" max="600" value="${question.seconds || 30}"></div><div class="field wide"><label for="q-title">문제 이름</label><input id="q-title" maxlength="100" value="${esc(question.title || '')}" placeholder="예: 기본문제 1"></div><div class="field wide"><label for="q-question">문제</label><textarea id="q-question" maxlength="600" placeholder="문제 내용을 입력하세요">${esc(question.question || '')}</textarea><span class="field-help">600자 이내 · 긴 문제는 의미 단위로 줄바꿈해주세요.</span></div><div class="field wide"><label for="q-image">문제 그림·사진 (선택)</label><label class="image-picker" for="q-image">${question.image ? `<img src="${safeImage(question.image)}" alt="${esc(question.imageAlt || '선택한 문제 이미지')}"><span>다른 사진으로 교체</span>` : '<strong>사진 선택</strong><span>JPG·PNG·WebP · 자동으로 프로젝터용 압축</span>'}<input id="q-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>${question.image ? '<button class="btn sm danger-ghost image-remove" type="button" data-action="remove-question-image">사진 삭제</button>' : ''}<input id="q-image-alt" maxlength="160" value="${esc(question.imageAlt || '')}" placeholder="사진 설명 (예: 좌표평면 위의 삼각형 ABC)"><span class="field-help">사진은 JSON 백업에도 함께 포함됩니다. 여러 장이 필요하면 한 장으로 합쳐 올려주세요.</span></div><div class="field wide"><label for="q-answer">정답</label><input id="q-answer" maxlength="200" value="${esc(question.answer || '')}" placeholder="정답"></div><div class="field wide"><label for="q-explanation">정답 해설 (프로젝터에 표시)</label><textarea id="q-explanation" maxlength="400" placeholder="정답 공개 시 함께 보여줄 짧은 해설">${esc(question.explanation || '')}</textarea></div><div class="field wide"><label for="q-note">진행자 메모 (프로젝터에 표시하지 않음)</label><textarea id="q-note" maxlength="2000" placeholder="판정 기준, 진행 주의사항 등">${esc(question.note || '')}</textarea></div><div class="wide modal-actions"><button class="btn" data-action="close-modal">취소</button><button class="btn primary" data-action="save-question">저장</button></div></div></section></div>`;
}

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach(element => element.addEventListener('click', () => update(next => { next.tab = element.dataset.tab; })));
  document.querySelectorAll('[data-screen-mode]').forEach(element => element.addEventListener('click', () => setScreenMode(element.dataset.screenMode)));
  document.querySelectorAll('[data-action]').forEach(element => {
    const action = element.dataset.action;
    if (element.tagName === 'INPUT' && action === 'import') element.addEventListener('change', importData);
    else element.addEventListener('click', event => {
      if (action === 'close-backdrop' && event.target !== element) return;
      handleAction(action);
    });
  });
  document.getElementById('q-image')?.addEventListener('change', handleQuestionImage);
  document.getElementById('settings-form')?.addEventListener('submit', event => {
    event.preventDefault();
    saveSettings();
  });
  document.querySelectorAll('[data-edit-q]').forEach(element => element.addEventListener('click', () => openQuestion(element.dataset.editQ)));
  document.querySelectorAll('[data-go-q]').forEach(element => element.addEventListener('click', () => goQuestion(Number(element.dataset.goQ))));
  document.querySelectorAll('[data-delete-q]').forEach(element => element.addEventListener('click', () => deleteQuestion(element.dataset.deleteQ)));
}

function focusModal() {
  requestAnimationFrame(() => document.querySelector('.modal input, .modal textarea, .modal select, .modal button')?.focus());
}

function handleAction(action) {
  const question = currentQuestion();
  if (action === 'open-screen') return openScreen();
  if (action === 'lock') return lockConsole();
  if (action === 'export') return exportData();
  if (action === 'prev') return goQuestion(state.currentIndex - 1);
  if (action === 'next') return goQuestion(state.currentIndex + 1);
  if (action === 'next-step') return advancePresentation();
  if (action === 'toggle-answer') return toggleAnswer();
  if (action === 'reset-timer') return resetTimer();
  if (action === 'timer-toggle') return state.timer.running ? pauseTimer() : startTimer();
  if (action === 'timer-minus') return adjustTimer(-5);
  if (action === 'timer-plus') return adjustTimer(5);
  if (action === 'edit-current' && question) return openQuestion(question.id);
  if (action === 'add-question') return openQuestion();
  if (action === 'close-modal' || action === 'close-backdrop') { modal = null; return render(); }
  if (action === 'save-question') return saveQuestion();
  if (action === 'remove-question-image' && modal?.type === 'question') {
    modal.question.image = '';
    modal.question.imageAlt = '';
    return render();
  }
  if (action === 'change-pin') return changePin();
  if (action === 'reset-all' && confirm('문제와 행사 설정을 모두 초기화할까요? 진행 PIN은 유지됩니다.')) {
    downloadBackup('before-reset');
    state = defaultState();
    saveState();
    return render();
  }
}

function openScreen() {
  publishPublicState();
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('view', 'screen');
  url.hash = new URLSearchParams({ session: getProjectorSessionId() }).toString();
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
}

function lockConsole() {
  if (state.timer.running) state.timer.remaining = getTimerRemaining(state.timer);
  state.timer.running = false;
  state.timer.endAt = null;
  state.answerVisible = false;
  state.displayMode = 'lobby';
  clearInterval(timerHandle);
  timerHandle = null;
  saveState();
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  state = null;
  authMessage = '';
  render();
}

function setScreenMode(mode) {
  if (!SCREEN_MODES.has(mode)) return;
  if (mode !== 'question') {
    pauseTimer(false);
    state.answerVisible = false;
  }
  update(next => { next.displayMode = mode; });
}

function advancePresentation() {
  if (state.displayMode === 'lobby') return setScreenMode('opening');
  if (state.displayMode === 'opening') return setScreenMode('rules');
  if (state.displayMode === 'rules' || state.displayMode === 'break') return setScreenMode('question');
  if (state.displayMode === 'ending') return setScreenMode('lobby');
  if (!state.answerVisible) return toggleAnswer();
  if (state.currentIndex < state.questions.length - 1) return goQuestion(state.currentIndex + 1);
  return setScreenMode('ending');
}

function goQuestion(index) {
  if (index < 0 || index >= state.questions.length) return;
  clearInterval(timerHandle);
  update(next => {
    next.currentIndex = index;
    next.answerVisible = false;
    next.displayMode = 'question';
    next.timer = { remaining: Number(next.questions[index].seconds || 30), running: false, endAt: null };
  });
}

function toggleAnswer() {
  if (!currentQuestion()?.answer) return toast('정답을 먼저 입력해주세요.');
  const opening = !state.answerVisible;
  if (opening && state.timer.running) pauseTimer(false);
  update(next => {
    next.displayMode = 'question';
    next.answerVisible = !next.answerVisible;
  });
}

function startTimer() {
  if (!currentQuestion()) return;
  if (getTimerRemaining(state.timer) <= 0) state.timer.remaining = Number(currentQuestion().seconds || 30);
  state.displayMode = 'question';
  state.timer.running = true;
  state.timer.endAt = Date.now() + state.timer.remaining * 1000;
  saveState();
  render();
  syncTicker();
}

function pauseTimer(shouldRender = true) {
  if (state.timer.running) state.timer.remaining = getTimerRemaining(state.timer);
  state.timer.running = false;
  state.timer.endAt = null;
  clearInterval(timerHandle);
  timerHandle = null;
  saveState();
  if (shouldRender) render();
}

function resetTimer(shouldRender = true) {
  clearInterval(timerHandle);
  timerHandle = null;
  const question = currentQuestion();
  state.timer = { remaining: Number(question?.seconds || 30), running: false, endAt: null };
  saveState();
  if (shouldRender) render();
}

function adjustTimer(delta) {
  if (state.timer.running) {
    state.timer.endAt = Math.max(Date.now(), state.timer.endAt + delta * 1000);
    state.timer.remaining = getTimerRemaining(state.timer);
  } else {
    state.timer.remaining = Math.max(0, Math.min(600, getTimerRemaining(state.timer) + delta));
  }
  saveState();
  render();
  syncTicker();
}

function openQuestion(id = null) {
  const existing = id ? state.questions.find(question => question.id === id) : null;
  modal = { type: 'question', question: existing ? { ...existing } : { id: null, category: 'basic', title: '', question: '', answer: '', explanation: '', note: '', image: '', imageAlt: '', seconds: 30 } };
  render();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
}

async function compressQuestionImage(file) {
  if (!file.type.startsWith('image/') || file.size > MAX_IMAGE_FILE_BYTES) throw new Error('invalid-image');
  const source = await fileToDataUrl(file);
  const image = await loadImage(source);
  const scale = Math.min(1, 1600 / image.naturalWidth, 1000 / image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  let blob = await canvasToBlob(canvas, 0.86);
  if (!blob) throw new Error('image-encode-failed');
  if (blob.size > 650 * 1024) blob = await canvasToBlob(canvas, 0.7);
  if (!blob || blob.size > 700 * 1024) throw new Error('image-too-large');
  return fileToDataUrl(blob);
}

async function handleQuestionImage(event) {
  const file = event.target.files?.[0];
  if (!file || !modal?.question) return;
  try {
    toast('사진을 프로젝터용으로 압축하고 있습니다…');
    const image = await compressQuestionImage(file);
    modal.question.image = image;
    modal.question.imageAlt ||= file.name.replace(/\.[^.]+$/, '');
    render();
    toast('사진을 추가했습니다. 문제 저장을 눌러 완료해주세요.');
  } catch {
    toast('사진을 처리하지 못했습니다. 12MB 이하의 JPG·PNG·WebP를 사용해주세요.');
  }
}

function saveQuestion() {
  const category = document.getElementById('q-category').value;
  const seconds = Math.round(clampNumber(document.getElementById('q-seconds').value, 1, 600, 30));
  const questionText = document.getElementById('q-question').value.trim();
  const answerText = document.getElementById('q-answer').value.trim();
  const explanationText = document.getElementById('q-explanation').value.trim();
  if (questionText.length > 600 || answerText.length > 200 || explanationText.length > 400) {
    return toast('프로젝터 가독성을 위해 문제 600자·정답 200자·해설 400자 이하로 줄여주세요.');
  }
  const data = {
    id: modal.question.id || createId(),
    category: Object.hasOwn(categoryMeta, category) ? category : 'basic',
    title: safeText(document.getElementById('q-title').value.trim(), 100),
    question: questionText,
    answer: answerText,
    explanation: explanationText,
    note: safeText(document.getElementById('q-note').value.trim(), 2000),
    image: safeImage(modal.question.image),
    imageAlt: safeText(document.getElementById('q-image-alt').value.trim(), 160),
    seconds,
  };
  const index = state.questions.findIndex(question => question.id === data.id);
  const isCurrent = index === state.currentIndex;
  const previousQuestions = state.questions.map(question => ({ ...question }));
  if (index >= 0) state.questions[index] = { ...state.questions[index], ...data };
  else state.questions.push({ ...data, order: state.questions.length + 1 });
  if (totalImageDataLength(state.questions) > MAX_TOTAL_IMAGE_DATA_LENGTH) {
    state.questions = previousQuestions;
    return toast('전체 사진 용량이 너무 큽니다. 기존 사진을 줄이거나 삭제한 뒤 다시 저장해주세요.');
  }
  if (isCurrent && !state.timer.running) state.timer.remaining = seconds;
  modal = null;
  if (!saveState()) {
    state.questions = previousQuestions;
    return render();
  }
  render();
  toast(data.question && data.answer ? '문제를 저장했습니다.' : '저장했습니다. 문제와 정답을 다시 확인해주세요.');
}

function deleteQuestion(id) {
  const index = state.questions.findIndex(question => question.id === id);
  if (index < 0 || !confirm(`'${state.questions[index].title}' 문제를 삭제할까요?`)) return;
  state.questions.splice(index, 1);
  state.questions.forEach((question, questionIndex) => { question.order = questionIndex + 1; });
  state.currentIndex = Math.min(state.currentIndex, Math.max(0, state.questions.length - 1));
  state.answerVisible = false;
  resetTimer(false);
  saveState();
  render();
}

function saveSettings() {
  const rulesText = document.getElementById('message-rules').value.trim();
  const previousEvent = { ...state.event };
  const previousMessages = { ...state.messages };
  state.event.title = safeText(document.getElementById('event-title').value.trim(), 100) || state.event.title;
  state.event.date = safeText(document.getElementById('event-date').value.trim(), 100);
  state.event.place = safeText(document.getElementById('event-place').value.trim(), 100);
  state.messages.tagline = safeText(document.getElementById('message-tagline').value.trim(), 100) || defaultState().messages.tagline;
  state.messages.lobby = safeText(document.getElementById('message-lobby').value.trim(), 100) || defaultState().messages.lobby;
  state.messages.opening = safeText(document.getElementById('message-opening').value.trim(), 100) || defaultState().messages.opening;
  state.messages.rules = safeText(rulesText, 2000) || defaultState().messages.rules;
  state.messages.break = safeText(document.getElementById('message-break').value.trim(), 100) || defaultState().messages.break;
  state.messages.ending = safeText(document.getElementById('message-ending').value.trim(), 100) || defaultState().messages.ending;
  if (!saveState()) {
    state.event = previousEvent;
    state.messages = previousMessages;
    return render();
  }
  render();
  toast('행사와 슬라이드 설정을 저장했습니다.');
}

async function changePin() {
  const currentPin = document.getElementById('current-pin').value.trim();
  const newPin = document.getElementById('new-pin').value.trim();
  const confirmation = document.getElementById('new-pin-confirm').value.trim();
  if (!/^\d{4,12}$/.test(newPin)) return toast('새 PIN은 4~12자리 숫자로 입력해주세요.');
  if (newPin !== confirmation) return toast('새 PIN 확인이 일치하지 않습니다.');
  const record = loadAuthRecord();
  try {
    const currentHash = await derivePin(currentPin, base64ToBytes(record.salt), Number(record.iterations));
    if (currentHash !== record.hash) return toast('현재 PIN이 맞지 않습니다.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derivePin(newPin, salt);
    const nextRecord = { version: 1, salt: bytesToBase64(salt), hash, iterations: PBKDF2_ITERATIONS, createdAt: record.createdAt, updatedAt: new Date().toISOString() };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextRecord));
    sessionStorage.setItem(AUTH_SESSION_KEY, hash);
    render();
    toast('PIN을 변경했습니다.');
  } catch {
    toast('PIN을 변경하지 못했습니다.');
  }
}

function downloadBackup(label = '') {
  if (!state) return;
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  const suffix = label ? `-${label}` : '';
  anchor.download = `sigma-goldenbell${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
}

function exportData() {
  downloadBackup();
  toast('백업 파일을 저장했습니다.');
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    alert('10MB 이하의 백업 파일만 불러올 수 있습니다.');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.questions)) throw new Error('invalid-backup');
      if (!confirm('현재 문제·슬라이드 설정을 백업 파일로 교체할까요? 기존 상태는 자동 백업됩니다.')) return;
      downloadBackup('before-import');
      const imported = normalizeState(parsed);
      if (totalImageDataLength(imported.questions) > MAX_TOTAL_IMAGE_DATA_LENGTH) {
        throw new Error('image-storage-limit');
      }
      try { localStorage.setItem(PRE_IMPORT_BACKUP_KEY, JSON.stringify(state)); } catch {}
      const previous = state;
      state = imported;
      state.timer.running = false;
      state.timer.endAt = null;
      state.answerVisible = false;
      state.displayMode = 'lobby';
      if (!saveState()) {
        state = previous;
        throw new Error('storage-limit');
      }
      render();
      toast('백업을 안전하게 불러왔습니다.');
    } catch (error) {
      alert(error.message === 'image-storage-limit' || error.message === 'storage-limit'
        ? '사진 용량이 너무 커 이 브라우저에 복원할 수 없습니다.'
        : '올바른 골든벨 백업 JSON 파일이 아닙니다.');
    } finally {
      event.target.value = '';
    }
  };
  reader.onerror = () => {
    alert('백업 파일을 읽지 못했습니다.');
    event.target.value = '';
  };
  reader.readAsText(file);
}

window.addEventListener('keydown', event => {
  if (IS_SCREEN) {
    if (event.key.toLowerCase() === 'f') document.documentElement.requestFullscreen?.();
    return;
  }
  if (!state || state.tab !== 'live' || modal || event.repeat) return;
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName)) return;
  if (event.code === 'Space') {
    event.preventDefault();
    state.timer.running ? pauseTimer() : startTimer();
  }
  if (event.key.toLowerCase() === 'a') toggleAnswer();
  if (event.key.toLowerCase() === 'b') setScreenMode('break');
  if (event.key.toLowerCase() === 'e') setScreenMode('ending');
  if (event.key === 'ArrowLeft') goQuestion(state.currentIndex - 1);
  if (event.key === 'ArrowRight') advancePresentation();
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && modal) {
    modal = null;
    render();
  }
});

document.addEventListener('fullscreenchange', () => {
  document.documentElement.classList.toggle('is-fullscreen', Boolean(document.fullscreenElement));
});

if (IS_SCREEN) {
  publicState = loadPublicState();
  renderScreen();
  syncTicker();
} else if (isUnlocked()) {
  state = loadPrivateState();
  saveState({ broadcast: false });
  render();
  syncTicker();
} else {
  renderAuth();
}

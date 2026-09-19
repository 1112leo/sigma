import { defaultRuntime, validClockTime, validEventDate, normalizeRuntime, effectiveSequence, runtimePosition, activeItem, runtimeLog, roundProgress, eventClock } from './runtime.js?v=20260831-runtime4';
import { renderMath, richText, mathProjection } from './math.js?v=20260831-preparation5';
import { parseQuestionImport, prepareQuestionImport, checkPreparation } from './preparation.js?v=20260831-preparation5';

const PRIVATE_STORAGE_KEY = 'sigma-goldenbell-v1';
const PUBLIC_STORAGE_KEY = 'sigma-goldenbell-public-v2';
const AUTH_STORAGE_KEY = 'sigma-goldenbell-auth-v1';
const AUTH_SESSION_KEY = 'sigma-goldenbell-session-v1';
const AUTH_ATTEMPT_KEY = 'sigma-goldenbell-attempts-v1';
const PROJECTOR_SESSION_KEY = 'sigma-goldenbell-projector-session-v1';
const PRE_IMPORT_BACKUP_KEY = 'sigma-goldenbell-pre-import-v1';
const CHANNEL_NAME = 'sigma-goldenbell-projector-v2';
const SCHEMA_VERSION = 3;
const questionEnums = {
  category: ['basic', 'hard', 'revival', 'tiebreak'],
  round: [null, 'main1', 'revival1', 'main2', 'revival2', 'main3', 'final'],
  usageStatus: ['active', 'reserve', 'disabled'],
  difficulty: ['easy', 'normal', 'hard', 'extreme'],
  reviewStatus: ['draft', 'self-reviewed', 'peer-reviewed', 'final'],
};
const PBKDF2_ITERATIONS = 210000;
const MAX_IMAGE_FILE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_DATA_LENGTH = 900 * 1024;
const MAX_TOTAL_IMAGE_DATA_LENGTH = 3 * 1024 * 1024;
const SCREEN_MODES = new Set(['lobby', 'opening', 'rules', 'question', 'break', 'ending', 'screen']);
const TABS = new Set(['live', 'questions', 'sequence', 'settings', 'preparation']);
const screenStyles = { blue: '블루', gold: '골드', green: '그린', plain: '기본' };
const technicalScreen = { title: '기술 문제 발생', subtitle: '', description: '잠시만 기다려주세요. 곧 진행을 재개합니다.', emphasis: '', style: 'plain' };
const legacyScreenIds = { lobby: 'waiting', opening: 'opening', rules: 'rules', break: 'standby', ending: 'end' };
const params = new URLSearchParams(location.search);
const IS_SCREEN = params.get('view') === 'screen' || params.get('screen') === '1';
const screenHash = new URLSearchParams(location.hash.replace(/^#/, ''));
const SCREEN_SESSION_ID = IS_SCREEN ? screenHash.get('session') : null;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;

const categoryMeta = {
  basic: { label: '기본', className: 'blue' },
  hard: { label: '고난도', className: 'red' },
  revival: { label: '패자부활', className: 'green' },
  tiebreak: { label: '등수결정', className: 'yellow' },
};

const roundLabels = { main1: '본게임1', revival1: '패자부활전1', main2: '본게임2', revival2: '패자부활전2', main3: '본게임 후반', final: '등수결정전' };
const usageLabels = { active: '사용', reserve: '예비', disabled: '미사용' };
const difficultyLabels = { easy: '쉬움', normal: '보통', hard: '어려움', extreme: '최상' };
const reviewLabels = { draft: '초안', 'self-reviewed': '본인 검수', 'peer-reviewed': '교차 검수', final: '최종 확정' };
let questionFilters = {};

const screenModeMeta = {
  screen: { label: '안내 화면', shortLabel: '안내' },
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
let syncingTicker = false;
let completingTimer = false;
let timerSaveRetryAt = 0;
let modal = null;
let authMessage = '';
let persistenceBlocked = false;
let importDraft = null;
let preflightResult = null;
let preflightBusy = false;
let backupReadToken = 0;
let preparationEpoch = 0;
const startupChecks = new Set();

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
    Array.from({ length: count }, (_, index) => migrateQuestion({
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
    }, order - 2))
  );
}

function defaultState() {
  const base = {
    schemaVersion: SCHEMA_VERSION,
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
    runtime: defaultRuntime(),
    runSettings: { safetyLock: true, eventDate: '2026-10-23', startTime: '15:50', endTime: '17:30' },
  };
  base.customScreens = createDefaultScreens(base);
  base.sequence = buildAutoSequence(base.questions);
  base.sequenceIndex = 0;
  base.displayMode = 'screen';
  base.timer.remaining = 0;
  return base;
}

function createDefaultScreens(source) {
  const messages = source.messages;
  return [
    ['waiting', messages.lobby, '', 'blue'], ['opening', messages.opening, '', 'gold'],
    ['rules', '진행 안내', messages.rules, 'blue'],
    ['revival1-start', '패자부활전 1', '진행자의 안내를 따라주세요.', 'green'],
    ['main-resume', '본게임 재개', '다시 도전을 이어갑니다.', 'blue'],
    ['revival2-start', '패자부활전 2', '진행자의 안내를 따라주세요.', 'green'],
    ['main3-start', '본게임 후반', '끝까지 도전해주세요.', 'blue'],
    ['final-start', '등수결정전', '최종 도전을 시작합니다.', 'gold'],
    ['judging', '판정 중입니다', '잠시만 기다려주세요.', 'plain'],
    ['invalid-question', '문제 무효 안내', '진행자의 안내를 따라주세요.', 'plain'],
    ['standby', messages.break, '', 'green'], ['result', '결과 발표', '', 'gold'],
    ['awards', '시상식', '도전해 주신 여러분께 박수를 보냅니다.', 'gold'],
    ['end', messages.ending, '', 'gold'],
  ].map(([id, title, description, style]) => ({ id, title, subtitle: '', description, emphasis: '', style }));
}

function buildAutoSequence(questions) {
  const sequence = ['waiting', 'opening', 'rules'].map(screenId => ({ type: 'screen', screenId }));
  const roundScreens = { revival1: 'revival1-start', main2: 'main-resume', revival2: 'revival2-start', main3: 'main3-start', final: 'final-start' };
  let previousRound = null;
  for (const question of questions.filter(item => item.usageStatus === 'active')) {
    if (question.round !== previousRound && roundScreens[question.round]) sequence.push({ type: 'screen', screenId: roundScreens[question.round] });
    sequence.push({ type: 'question', questionId: question.id });
    previousRound = question.round;
  }
  sequence.push({ type: 'screen', screenId: 'end' });
  return sequence;
}

function normalizePresentation(raw, next) {
  const defaults = createDefaultScreens(next);
  if (raw.customScreens !== undefined && !Array.isArray(raw.customScreens)) throw new Error('invalid-screens');
  if (raw.sequence !== undefined && !Array.isArray(raw.sequence)) throw new Error('invalid-sequence');
  if (raw.customScreens?.length > 200 || raw.sequence?.length > 2000) throw new Error('sequence-limit');
  next.customScreens = defaults;
  for (const screen of raw.customScreens || []) {
    if (!screen || typeof screen.id !== 'string' || !screen.id.trim()) throw new Error('invalid-screen');
    const index = next.customScreens.findIndex(item => item.id === screen.id);
    const fallback = next.customScreens[index] || {};
    const normalized = { id: screen.id, title: settingText(screen.title, 100, fallback.title || ''), subtitle: settingText(screen.subtitle, 150, fallback.subtitle || ''), description: settingText(screen.description, 2000, fallback.description || ''), emphasis: settingText(screen.emphasis, 150, fallback.emphasis || ''), style: Object.hasOwn(screenStyles, screen.style) ? screen.style : 'blue' };
    if (index >= 0) next.customScreens[index] = normalized;
    else next.customScreens.push(normalized);
  }
  if (next.customScreens.length > 200) throw new Error('sequence-limit');
  // Built-in screen content is authoritative; legacy settings edit the same values.
  for (const [key, id] of Object.entries(legacyScreenIds)) {
    const screen = next.customScreens.find(item => item.id === id);
    next.messages[key] = screen[id === 'rules' ? 'description' : 'title'];
  }
  next.sequence = Array.isArray(raw.sequence) ? raw.sequence.map(item => {
    if (item?.type === 'question' && typeof item.questionId === 'string') return { type: 'question', questionId: item.questionId };
    if (item?.type === 'screen' && typeof item.screenId === 'string') return { type: 'screen', screenId: item.screenId };
    throw new Error('invalid-sequence-item');
  }) : buildAutoSequence(next.questions);
  if (raw.sequence === undefined) {
    const legacyQuestionId = next.questions[next.currentIndex]?.id;
    const screenId = legacyScreenIds[raw.displayMode || 'lobby'];
    let position = next.sequence.findIndex(item => raw.displayMode === 'question' ? item.questionId === legacyQuestionId : item.screenId === screenId);
    if (position < 0 && raw.displayMode === 'question' && legacyQuestionId) {
      // Preserve an already-presented legacy reserve/disabled question, not auto-selection.
      position = Math.max(0, next.sequence.length - 1);
      next.sequence.splice(position, 0, { type: 'question', questionId: legacyQuestionId });
    }
    if (position < 0 && screenId) {
      position = Math.max(0, next.sequence.findIndex(item => item.questionId === legacyQuestionId));
      next.sequence.splice(position, 0, { type: 'screen', screenId });
    }
    next.sequenceIndex = Math.max(0, position);
  } else next.sequenceIndex = next.sequence.length ? Math.round(clampNumber(raw.sequenceIndex, 0, next.sequence.length - 1, 0)) : -1;
  next.runtime = normalizeRuntime(raw.runtime, next.sequence.length);
  next.runSettings = { safetyLock: raw.runSettings?.safetyLock !== false, eventDate: validEventDate(raw.runSettings?.eventDate) ? raw.runSettings.eventDate : '2026-10-23', startTime: validClockTime(raw.runSettings?.startTime) ? raw.runSettings.startTime : '15:50', endTime: validClockTime(raw.runSettings?.endTime) ? raw.runSettings.endTime : '17:30' };
  const item = activeItem(next);
  const index = item?.type === 'question' ? next.questions.findIndex(question => question.id === item.questionId) : -1;
  next.displayMode = index >= 0 ? 'question' : 'screen';
  if (index >= 0) next.currentIndex = index;
  else {
    next.answerVisible = false;
    next.timer = { remaining: 0, running: false, endAt: null };
  }
  if (next.displayMode === 'question' && raw.timer?.running && Number.isFinite(Number(raw.timer.endAt)) && Number(raw.timer.endAt) > 0 && Number(raw.timer.endAt) <= Date.now()) runtimeLog(next, 'timer-end', `${item.questionId} 시간 종료 (재접속 확인)`);
  return next;
}

function safeText(value, maxLength = 5000) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

// Defaults apply only to missing fields, never to an intentionally empty value.
function settingText(value, maxLength, fallback = '') {
  return typeof value === 'string' ? safeText(value, maxLength).trim() : fallback;
}

function projectionText(value, maxLength) {
  const text = safeText(value, 5000);
  return mathProjection(text, maxLength);
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

function validTimeLimit(value) {
  return ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 600;
}

function validateQuestion(question) {
  const errors = [];
  for (const [field, values] of Object.entries(questionEnums)) {
    if (!values.includes(question[field])) errors.push({ field, message: `${field}: 허용되지 않은 값입니다.` });
  }
  if (!validTimeLimit(question.timeLimit)) errors.push({ field: 'timeLimit', message: '제한시간은 1~600초의 정수여야 합니다.' });
  return errors;
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

// This is the single entry point for legacy question data, including old JSON backups.
// seconds remains a synchronized compatibility alias; timeLimit is authoritative.
function migrateQuestion(candidate, index = 0, now = new Date().toISOString()) {
  const item = candidate && typeof candidate === 'object' ? candidate : {};
  const enumValue = (field, fallback) => questionEnums[field].includes(item[field]) ? item[field] : fallback;
  const category = enumValue('category', 'basic');
  const rawTime = item.timeLimit ?? item.seconds;
  const timeLimit = validTimeLimit(rawTime) ? Number(rawTime) : category === 'tiebreak' ? 45 : 30;
  const createdAt = validTimestamp(item.createdAt) ? item.createdAt : now;
  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id : createId(),
    order: Number.isInteger(item.order) && item.order > 0 ? item.order : index + 1,
    category,
    round: enumValue('round', null),
    title: typeof item.title === 'string' ? safeText(item.title, 100) : `${categoryMeta[category].label} ${index + 1}`,
    question: safeText(item.question, 2000),
    answer: safeText(item.answer, 500),
    explanation: safeText(item.explanation, 1500),
    acceptedAnswers: safeText(item.acceptedAnswers, 2000),
    judgeNote: safeText(item.judgeNote, 2000),
    author: safeText(item.author, 100),
    note: safeText(item.note, 2000),
    difficulty: enumValue('difficulty', 'normal'),
    usageStatus: enumValue('usageStatus', 'active'),
    reviewStatus: enumValue('reviewStatus', 'draft'),
    timeLimit,
    seconds: timeLimit,
    image: safeImage(item.image),
    imageAlt: safeText(item.imageAlt, 160),
    createdAt,
    updatedAt: validTimestamp(item.updatedAt) ? item.updatedAt : createdAt,
  };
}

function migrateState(candidate) {
  const raw = candidate && typeof candidate === 'object' ? candidate : {};
  const version = raw.schemaVersion ?? 0;
  if (!Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) throw new Error('unsupported-schema');
  if (Array.isArray(raw.questions) && raw.questions.length > 500) throw new Error('question-limit');
  const now = new Date().toISOString();
  return {
    ...raw,
    schemaVersion: SCHEMA_VERSION,
    ...(Array.isArray(raw.questions) ? { questions: raw.questions.map((question, index) => migrateQuestion(question, index, now)) } : {}),
  };
}

function normalizeState(candidate) {
  const base = defaultState();
  const raw = migrateState(candidate);
  const rawEvent = raw.event && typeof raw.event === 'object' ? raw.event : {};
  const rawMessages = raw.messages && typeof raw.messages === 'object' ? raw.messages : {};
  const questions = Array.isArray(raw.questions) ? raw.questions : base.questions;
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
  return normalizePresentation(raw, {
    schemaVersion: SCHEMA_VERSION,
    event: {
      title: settingText(rawEvent.title, 100, base.event.title),
      date: safeText(rawEvent.date, 100).trim(),
      place: safeText(rawEvent.place, 100).trim(),
    },
    messages: {
      lobby: settingText(rawMessages.lobby, 100, base.messages.lobby),
      opening: settingText(rawMessages.opening, 100, base.messages.opening),
      tagline: settingText(rawMessages.tagline, 100, base.messages.tagline),
      rules: settingText(rawMessages.rules, 2000, base.messages.rules),
      break: settingText(rawMessages.break, 100, base.messages.break),
      ending: settingText(rawMessages.ending, 100, base.messages.ending),
    },
    questions,
    currentIndex,
    answerVisible: Boolean(raw.answerVisible),
    displayMode: SCREEN_MODES.has(raw.displayMode) ? raw.displayMode : 'lobby',
    timer: { remaining, running, endAt },
    tab: TABS.has(raw.tab) ? raw.tab : 'live',
  });
}

function loadPrivateState() {
  try {
    const raw = localStorage.getItem(PRIVATE_STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.questions)) throw new Error('invalid-backup');
    return normalizeState(parsed);
  } catch {
    // Never overwrite an unreadable or newer backup with an empty/default session.
    persistenceBlocked = true;
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
  const item = activeItem(state);
  return item?.type === 'question' ? state.questions.find(question => question.id === item.questionId) || null : null;
}

function currentScreen(source = state) {
  const item = activeItem(source);
  if (item?.type === 'screen' && item.screenId === 'technical') return technicalScreen;
  return source?.customScreens.find(screen => item?.type === 'screen' && screen.id === item.screenId) || { title: item ? '구성 항목을 찾을 수 없습니다' : '행사 구성을 준비해주세요', subtitle: '', description: item ? '진행자가 다음 항목을 확인하고 있습니다.' : '', emphasis: '', style: 'plain' };
}

function sequenceItemLabel(item) {
  if (!item) return '마지막 항목입니다';
  if (item.type === 'screen' && item.screenId === 'technical') return technicalScreen.title;
  if (item.type === 'screen') return state.customScreens.find(screen => screen.id === item.screenId)?.title || item.screenId;
  const question = state.questions.find(question => question.id === item.questionId);
  return question ? `${question.id} · ${question.title || question.question || '미입력 문제'}` : `누락된 문제 · ${item.questionId}`;
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
    version: 3,
    sessionId: getProjectorSessionId(),
    event: { title: state.event.title, date: state.event.date, place: state.event.place },
    messages: { tagline: state.messages.tagline },
    displayMode: state.displayMode,
    currentIndex: questionProgress().current - 1,
    totalQuestions: questionProgress().total,
    screen: !mayShowQuestion ? publicScreen(currentScreen()) : null,
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
    timer: mayShowQuestion ? { ...state.timer, remaining: getTimerRemaining(state.timer) } : null,
    publishedAt: Date.now(),
  };
}

function questionProgress() {
  const sequence = effectiveSequence(state);
  const total = sequence.filter(item => item.type === 'question').length;
  const current = sequence.slice(0, runtimePosition(state) + 1).filter(item => item.type === 'question').length;
  return { current: currentQuestion() ? Math.max(1, current) : current, total: currentQuestion() ? Math.max(1, total) : total };
}

function publicScreen(screen) {
  const template = Object.entries(legacyScreenIds).find(([, id]) => id === screen.id)?.[0] || (Object.hasOwn(legacyScreenIds, screen.template) ? screen.template : '');
  return { template, title: safeText(screen.title, 100), subtitle: safeText(screen.subtitle, 150), description: safeText(screen.description, 1200), emphasis: safeText(screen.emphasis, 150), style: Object.hasOwn(screenStyles, screen.style) ? screen.style : 'plain' };
}

function publishPublicState({ broadcast = true, locked = false } = {}) {
  if (!state) return;
  const next = buildPublicState();
  if (locked) {
    next.displayMode = 'screen';
    next.question = null;
    next.timer = null;
    next.answerVisible = false;
    next.screen = publicScreen(state.customScreens.find(screen => screen.id === 'waiting') || {});
  }
  let stored = false;
  let sent = false;
  try {
    localStorage.setItem(PUBLIC_STORAGE_KEY, JSON.stringify(next));
    stored = true;
  } catch {
    // Never leave a previous answer in the cache after a failed screen/lock update.
    try { localStorage.removeItem(PUBLIC_STORAGE_KEY); } catch {}
  }
  // Storage and live delivery are independent: quota exhaustion must not stop a live projector.
  if (broadcast && channel) {
    try { channel.postMessage({ type: 'public-state', state: next }); sent = true; } catch {}
  }
  if (!stored && !sent && !IS_SCREEN) toast('프로젝터 화면을 갱신하지 못했습니다. 송출 화면을 확인하고 사진 용량을 줄여주세요.');
  return stored || sent;
}

function saveState({ broadcast = true, locked = false } = {}) {
  if (!state) return;
  if (persistenceBlocked) {
    toast('기존 데이터 보호 중입니다. 원본 JSON을 백업하고 호환되는 백업을 불러와주세요.');
    return false;
  }
  try {
    localStorage.setItem(PRIVATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast('브라우저 저장 공간이 부족합니다. 사진을 줄이거나 JSON 백업 후 정리해주세요.');
    return false;
  }
  publishPublicState({ broadcast, locked });
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
  if (!IS_SCREEN && state && event.data?.type === 'request-public-state' && event.data.sessionId === getProjectorSessionId()) publishPublicState();
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
  const saved = saveState(options);
  if (!saved) state = previous;
  if (options.render !== false) render();
  syncTicker();
  return saved;
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
  if (remaining <= 0 && timer.running && !completingTimer && Date.now() >= timerSaveRetryAt) {
    completingTimer = true;
    try {
      if (IS_SCREEN) {
        timer.running = false; timer.endAt = null; timer.remaining = 0;
        renderScreen();
      } else {
        captureQuestionDraft();
        const saved = update(next => {
          next.timer = { remaining: 0, running: false, endAt: null };
          runtimeLog(next, 'timer-end', `${activeItem(next)?.questionId || ''} 시간 종료`);
        }, { render: state.tab === 'live' && !modal && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) });
        timerSaveRetryAt = saved ? 0 : Date.now() + 5000;
      }
    } finally { completingTimer = false; }
  }
}

function syncTicker() {
  // Expiry saves state, which can call this function again before the outer refresh returns.
  if (syncingTicker) return;
  syncingTicker = true;
  try {
    clearInterval(timerHandle);
    timerHandle = null;
    refreshTimerDom();
    refreshEventClock();
    const timer = IS_SCREEN ? publicState?.timer : state?.timer;
    if (timer?.running || (!IS_SCREEN && state)) timerHandle = setInterval(() => { refreshTimerDom(); refreshEventClock(); }, timer?.running ? 200 : 1000);
  } finally { syncingTicker = false; }
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
        ${[['live', '실시간 진행'], ['questions', '문제 편집'], ['sequence', '행사 구성'], ['preparation', '행사 점검·가져오기'], ['settings', '행사·슬라이드 설정']]
          .map(([id, label]) => `<button class="tab ${state.tab === id ? 'active' : ''}" data-tab="${id}" aria-current="${state.tab === id ? 'page' : 'false'}">${label}</button>`).join('')}
      </nav>
      <main class="workspace">${persistenceBlocked ? '<p class="overflow-notice" role="alert">저장 데이터를 읽을 수 없거나 더 최신 버전입니다. 원본은 보존되어 있으며 변경은 저장되지 않습니다. 설정에서 JSON 백업 후 호환되는 파일을 불러와주세요.</p>' : ''}${renderTab()}</main>
    </div>
    ${modal ? renderModal() : ''}
    <div class="sr-only" aria-live="polite" id="live-region"></div>`;
  bindEvents();
  if (modal) focusModal();
  refreshTimerDom();
  refreshEventClock();
}

function renderTab() {
  if (state.tab === 'questions') return renderQuestions();
  if (state.tab === 'sequence') return renderSequence();
  if (state.tab === 'settings') return renderSettings();
  if (state.tab === 'preparation') return renderPreparation();
  return renderLive();
}

function renderPreview() {
  const question = currentQuestion();
  const mode = state.displayMode;
  if (mode === 'screen') return renderScreenContent(currentScreen(), true);
  if (mode === 'rules') {
    const rules = state.messages.rules.split(/\r?\n/).filter(Boolean).slice(0, 6).map(rule => safeText(rule, 180));
    return `<div class="preview-scene preview-rules"><p>HOW TO PLAY</p><strong>진행 안내</strong><ol>${rules.map(rule => `<li>${esc(rule)}</li>`).join('')}</ol></div>`;
  }
  if (mode !== 'question') {
    const copy = state.messages[mode] ?? state.messages.lobby;
    const kicker = mode === 'lobby' ? 'SIGMA GOLDEN BELL' : mode === 'opening' ? 'LET\'S BEGIN' : mode === 'break' ? 'BREAK TIME' : 'THANK YOU';
    return `<div class="preview-scene preview-${mode}"><div class="preview-watermark" aria-hidden="true">Σ</div><p>${esc(kicker)}</p><strong>${esc(copy)}</strong><span>${esc(state.messages.tagline)}</span></div>`;
  }
  if (!question) return `<div class="preview-scene"><strong>문제를 준비 중입니다.</strong></div>`;
  const meta = categoryMeta[question.category] || categoryMeta.basic;
  const image = safeImage(question.image);
  return `
    <div class="preview-question-scene ${state.answerVisible ? 'show-answer' : ''}">
      <div class="preview-topline"><span>${esc(meta.label)}</span><span>${questionProgress().current} / ${questionProgress().total}</span></div>
      <div class="preview-question-content ${image ? 'has-image' : ''}">${image ? `<img class="preview-question-image" src="${image}" alt="${esc(question.imageAlt || '문제 참고 이미지')}">` : ''}<div class="preview-question ${questionSizeClass(projectionText(question.question, 600))}">${richText(projectionText(question.question, 600) || '문제를 준비 중입니다.')}</div></div>
      ${state.answerVisible ? `<div class="preview-answer"><small>정답</small><strong class="${answerSizeClass(projectionText(question.answer, 200))}">${richText(projectionText(question.answer, 200) || '정답 미입력')}</strong>${question.explanation ? `<span>${richText(projectionText(question.explanation, 400))}</span>` : ''}</div>` : ''}
      <div class="preview-bottomline"><span>${esc(question.title)}</span><strong data-timer-value class="${timerClass(state.timer)}">${formatTime(getTimerRemaining(state.timer))}</strong></div>
    </div>`;
}

function currentRoundLabel() {
  if (currentQuestion()?.round) return roundLabels[currentQuestion().round];
  const screenRounds = { 'revival1-start': 'revival1', 'main-resume': 'main2', 'revival2-start': 'revival2', 'main3-start': 'main3', 'final-start': 'final' };
  for (let index = state.sequenceIndex; index >= 0; index--) {
    const item = state.sequence[index];
    const round = item.type === 'question' ? state.questions.find(question => question.id === item.questionId)?.round : screenRounds[item.screenId];
    if (round) return roundLabels[round];
  }
  return '라운드 미지정';
}

function renderLive() {
  const question = currentQuestion();
  const liveSequence = effectiveSequence(state);
  const cursor = runtimePosition(state);
  const total = liveSequence.length;
  const position = total ? cursor + 1 : 0;
  const remaining = getTimerRemaining(state.timer);
  const progress = total ? position / total * 100 : 0;
  const title = sequenceItemLabel(activeItem(state));
  return `<div class="live-layout"><section class="stack">
    <article class="card stage-card"><div class="section-head stage-heading"><div><p class="eyebrow">프로젝터 미리보기 · ${position} / ${total}</p><h2>${esc(question ? question.title : currentScreen().title)}</h2></div><button class="btn sm" data-action="open-screen">새 창으로 열기</button></div>
    <div class="stage-preview" aria-label="프로젝터 화면 미리보기">${renderPreview()}</div>
    ${question ? `<div class="primary-controls"><button class="btn timer-toggle" data-action="timer-toggle"><span>${state.timer.running ? '타이머 일시정지' : '타이머 시작'}</span><kbd>Space</kbd></button><button class="btn presentation-next" data-action="toggle-answer" ${question.answer ? '' : 'disabled'}><span>${state.answerVisible ? '정답 숨기기' : '정답 공개'}</span><kbd>A</kbd></button></div>` : ''}
    <div class="transport-controls sequence-transport"><button class="btn" data-action="prev" ${cursor <= 0 ? 'disabled' : ''}>← 이전 항목</button><button class="btn primary" data-action="next" ${cursor >= total - 1 ? 'disabled' : ''}>다음 항목 →</button></div>
    ${question ? '<div class="row"><button class="btn sm ghost" data-action="reset-timer">시간 초기화 (R)</button><button class="btn sm ghost" data-action="edit-current">현재 문제 수정</button></div>' : ''}</article>
    ${question ? `<article class="card current-question-card"><div class="stage-line"><div class="row">${categoryBadge(question)}<span class="question-index">${esc(currentRoundLabel())}</span></div><span class="question-title">${esc(question.id)}</span></div>${question.image ? `<img class="operator-question-image" src="${safeImage(question.image)}" alt="${esc(question.imageAlt || '문제 참고 이미지')}">` : ''}<div class="operator-question ${questionSizeClass(question.question)}">${richText(question.question || '아직 문제 내용이 입력되지 않았습니다.')}</div><div class="operator-answer visible"><span>진행자 전용 · 정답</span><strong>${richText(question.answer || '미입력')}</strong>${question.explanation ? `<p>${richText(question.explanation)}</p>` : ''}${question.acceptedAnswers ? `<p>인정 답안 · ${multiline(question.acceptedAnswers)}</p>` : ''}${question.judgeNote ? `<p>판정 메모 · ${multiline(question.judgeNote)}</p>` : ''}${question.note ? `<small>진행 메모 · ${multiline(question.note)}</small>` : ''}</div></article>` : ''}
    ${renderRuntimeControls()}
    </section><aside class="stack control-rail">${renderSlideSelector()}
    <article class="card overview-card"><p class="eyebrow">행사 진행</p><div class="section-head"><h2>${esc(currentRoundLabel())}</h2><strong>${position} / ${total}</strong></div><div class="progress"><div style="width:${progress}%"></div></div><p class="sub">현재 · ${esc(title)}</p><div class="next-item"><small>다음 항목</small><strong>${esc(sequenceItemLabel(liveSequence[cursor + 1]))}</strong></div></article>
    ${question ? `<article class="card timer-card"><div class="timer-status"><span data-timer-label>${remaining <= 0 ? '시간 종료' : '남은 시간'}</span><span>${question.timeLimit}초 문제</span></div><div class="timer ${timerClass(state.timer)}" data-timer-value>${formatTime(remaining)}</div><form id="manual-timer-form" class="manual-timer"><label for="manual-timer">시간 직접 설정(초)</label><input id="manual-timer" type="number" min="0" max="600" step="1" value="${Math.ceil(remaining)}"><button class="btn sm" type="submit">적용</button></form><div class="timer-track"><div data-timer-progress></div></div><div class="timer-adjust"><button class="btn sm" data-action="timer-minus">-5초</button><button class="btn sm" data-action="reset-timer">초기화</button><button class="btn sm" data-action="timer-plus">+5초</button></div></article>` : '<article class="card note-card"><strong>안내 화면 송출 중</strong><p>문제·정답·타이머는 표시하지 않습니다. 다음 항목으로 이동해 진행하세요.</p></article>'}
    ${renderEventStatus()}
    <article class="card shortcut-card"><h2>진행 단축키</h2><div class="shortcut-list"><span><kbd>Space</kbd>타이머</span><span><kbd>A</kbd>정답 공개/숨김</span><span><kbd>←</kbd><kbd>→</kbd>항목 이동</span><span><kbd>R</kbd>타이머 초기화</span></div></article>
    <article class="card"><h2>진행 백업</h2><p class="sub">현재 문제·사진·행사 순서·진행 위치를 함께 내려받습니다. 노트북 교체에 대비해 별도로 보관하세요.</p><button class="btn" data-action="export">현재 진행 JSON 백업</button></article>
    </aside></div>`;
}

function renderRuntimeControls() {
  const question = currentQuestion();
  const invalid = question && state.runtime.invalidQuestions.some(row => row.questionId === question.id);
  return `<article class="card runtime-card"><div class="section-head"><div><p class="eyebrow">운영자 전용 · 원본 구성 유지</p><h2>돌발상황 대응</h2></div><span class="badge ${state.runSettings.safetyLock ? 'green' : ''}">진행 안전 잠금 ${state.runSettings.safetyLock ? 'ON' : 'OFF'}</span></div>
    ${state.runtime.overlay ? '<p class="overflow-notice">즉시 송출 중 · 복귀하거나 다음 항목으로 이동할 수 있습니다.</p>' : ''}
    ${invalid ? '<p class="overflow-notice">이번 진행에서 무효 처리한 문제입니다. 원본은 유지됩니다.</p>' : ''}
    <div class="runtime-buttons">${[['judging','판정 중'],['standby','잠시 대기'],['invalid-question','문제 무효 안내'],['technical','기술 문제 발생']].map(([id,label])=>`<button class="btn" data-immediate-screen="${id}">${label}</button>`).join('')}
    <button class="btn primary" data-action="reserve-picker">예비문제</button><button class="btn" data-action="runtime-return" ${state.runtime.returns.length ? '' : 'disabled'}>직전 화면 복귀</button><button class="btn danger-ghost" data-action="invalid-question" ${question ? '' : 'disabled'}>현재 문제 무효 처리</button><button class="btn ghost" data-action="runtime-clear">임시 진행 정리</button></div>
    <div class="runtime-jump"><label for="runtime-jump">특정 항목으로 이동 (복귀 가능)</label><select id="runtime-jump">${effectiveSequence(state).map((item,index)=>`<option value="${index}" ${index === runtimePosition(state) ? 'selected' : ''}>${index+1}. ${esc(sequenceItemLabel(item))}${item.insertionId ? ' · 임시 예비문제' : ''}</option>`).join('')}</select><button class="btn" data-action="runtime-jump" ${effectiveSequence(state).length ? '' : 'disabled'}>선택 항목으로 이동</button></div>
    <p class="sub">예비 사용 ${state.runtime.reserveUses.length}회 · 임시 삽입 ${state.runtime.insertions.length}개 · 무효 ${state.runtime.invalidQuestions.length}개. 복귀 후 타이머는 직접 재개합니다.</p></article>
    <details class="card runtime-logs"><summary>진행 로그 (${state.runtime.logs.length}개 · 최근 2,000개 저장)</summary><button class="btn sm danger-ghost" data-action="clear-logs">로그 초기화</button><ol>${state.runtime.logs.slice(-50).reverse().map(row=>`<li><time>${esc(new Date(row.at).toLocaleTimeString('ko-KR'))}</time> ${esc(row.label)}</li>`).join('') || '<li>아직 기록이 없습니다.</li>'}</ol><p class="sub">화면에는 최근 50개를 표시합니다. 전체 기록은 JSON 백업에 포함됩니다.</p></details>`;
}

function renderReservePicker() {
  const reserves = state.questions.filter(question => question.usageStatus === 'reserve');
  return `<div class="modal-backdrop" data-action="close-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="section-head"><h2 id="modal-title">예비문제 선택</h2><button class="btn" data-action="close-modal">닫기</button></div><p class="sub">원본 행사 구성은 바꾸지 않습니다. 즉시 송출 후에는 복귀할 수 있습니다.</p><div class="stack">${reserves.map(question=>`<article class="card"><strong>${esc(question.id)}</strong><p class="sub">${categoryMeta[question.category].label} · ${difficultyLabels[question.difficulty]} · ${question.timeLimit}초</p><p>${esc(question.question.slice(0,160) || '문제 미입력')}</p><div class="row"><button class="btn primary" data-reserve-id="${esc(question.id)}" data-reserve-mode="immediate">즉시 송출</button><button class="btn" data-reserve-id="${esc(question.id)}" data-reserve-mode="insert">다음에 임시 삽입</button></div></article>`).join('') || '<p>예비문제가 없습니다. 문제 편집에서 사용 상태를 예비로 지정해주세요.</p>'}</div></section></div>`;
}

function renderEventStatus() {
  const clock = eventClock(state);
  return `<article class="card"><p class="eyebrow">행사 시간 · 진행자 전용</p><div class="event-clock"><div><small>${state.runtime.startedAt ? '시작 버튼 기준 경과' : '예정 시작 기준 경과'}</small><strong data-event-elapsed>${formatClock(clock.elapsed)}</strong></div><div><small>예정 종료까지</small><strong data-event-remaining>${formatClock(Math.abs(clock.remaining))}</strong></div></div><p class="sub">${esc(state.runSettings.eventDate)} · ${state.runSettings.startTime} ~ ${state.runSettings.endTime}</p><button class="btn sm" data-action="event-start">${state.runtime.startedAt ? '경과시간 다시 시작' : '지금 행사 시작'}</button></article><article class="card"><h2>라운드 진행</h2><ul class="round-progress">${Object.entries(roundProgress(state)).map(([round,row])=>`<li><span>${roundLabels[round]}</span><strong>${row.passed === row.total ? '완료' : row.passed + ' / ' + row.total}</strong></li>`).join('') || '<li>문제의 라운드를 지정해주세요.</li>'}</ul><p class="sub">지나간 항목 / 전체 항목 기준</p></article>`;
}

function renderRunSettings() {
  const settings = state.runSettings;
  return `<article class="card"><h2>진행 안전·시간 설정</h2><form id="run-settings-form" class="form-grid settings-form"><label class="filter-checkbox wide"><input id="run-safety" type="checkbox" ${settings.safetyLock ? 'checked' : ''}>진행 안전 잠금 (실행 중 이동 경고)</label><div class="field wide"><label for="run-date">행사 날짜</label><input id="run-date" type="date" value="${esc(settings.eventDate)}" required></div><div class="field"><label for="run-start">예정 시작</label><input id="run-start" type="time" value="${settings.startTime}" required></div><div class="field"><label for="run-end">예정 종료</label><input id="run-end" type="time" value="${settings.endTime}" required></div><button class="btn wide" type="submit">진행 설정 저장</button></form><p class="sub">종료 시각이 시작 이전이면 다음 날로 계산합니다. 긴급 화면은 안전 잠금과 관계없이 즉시 타이머를 멈춥니다.</p></article>`;
}

function renderSlideSelector() {
  const active = publicScreen(currentScreen()).template;
  return `<article class="card mode-card"><div class="section-head"><div><p class="eyebrow">PPT 대신 송출</p><h2>슬라이드 선택</h2></div></div><div class="mode-grid">${Object.entries(legacyScreenIds).map(([mode,id]) => `<button class="mode-button ${state.displayMode === 'screen' && active === mode ? 'active' : ''}" data-immediate-screen="${id}" aria-pressed="${state.displayMode === 'screen' && active === mode}"><span class="mode-dot"></span>${esc(screenModeMeta[mode].shortLabel)}</button>`).join('')}<button class="mode-button" data-action="runtime-return" ${state.runtime.returns.length ? '' : 'disabled'}><span class="mode-dot"></span>직전 화면 복귀</button></div><p class="sub mode-help">대기·오프닝·안내·휴식·마침을 바로 송출하고, 진행하던 화면으로 복귀할 수 있습니다.</p></article>`;
}

function screenTheme(screen, preview = false) {
  const defaults = { lobby: 'blue', opening: 'gold', rules: 'blue', break: 'green', ending: 'gold' };
  return screen.template && screen.style === defaults[screen.template] ? `${preview ? 'preview' : 'screen'}-${screen.template}` : `slide-${screen.style}`;
}

function renderScreenContent(screen, preview = false, event = state?.event || {}, messages = state?.messages || {}) {
  const safe = publicScreen(screen);
  if (safe.template) {
    const rules = safe.template === 'rules';
    const kicker = { lobby: 'SIGMA GOLDEN BELL', opening: "LET'S BEGIN", rules: 'HOW TO PLAY', break: 'BREAK TIME', ending: 'THANK YOU' }[safe.template];
    const titleTag = preview ? 'strong' : 'h1';
    const detail = safe.template === 'lobby' ? [event.date, event.place].filter(Boolean).join(' · ') : messages.tagline;
    return `<section class="restored-screen ${preview ? `preview-scene preview-${safe.template} ${screenTheme(safe, true)}` : rules ? 'screen-rules-wrap' : 'screen-message'}">${!rules && preview ? '<div class="preview-watermark" aria-hidden="true">Σ</div>' : ''}<p>${esc(kicker)}</p><${titleTag}>${esc(safe.title)}</${titleTag}>${safe.subtitle ? `<h2>${esc(safe.subtitle)}</h2>` : ''}${rules ? `<ol>${safe.description.split(/\r?\n/).filter(Boolean).map(line => `<li>${esc(line)}</li>`).join('')}</ol>` : safe.description ? `<div class="slide-description ${safe.description.length > 500 ? 'long' : ''}">${multiline(safe.description)}</div>` : ''}${safe.emphasis ? `<div class="slide-emphasis">${esc(safe.emphasis)}</div>` : ''}${!rules && detail ? `<span>${esc(detail)}</span>` : ''}</section>`;
  }
  return `<section class="${preview ? 'preview-scene' : 'screen-message'} custom-screen-content slide-${safe.style}"><h1>${esc(safe.title)}</h1>${safe.subtitle ? `<h2>${esc(safe.subtitle)}</h2>` : ''}${safe.description ? `<div class="slide-description ${safe.description.length > 500 ? 'long' : ''}">${multiline(safe.description)}</div>` : ''}${safe.emphasis ? `<strong class="slide-emphasis">${esc(safe.emphasis)}</strong>` : ''}</section>`;
}

function renderSequence() {
  return `<div class="content-layout"><section class="card content-card"><div class="section-head"><div><p class="eyebrow">PPT처럼 구성하기</p><h2>행사 구성</h2><p class="sub">${state.sequence.length}개 항목 · 현재 위치 ${Math.max(0, state.sequenceIndex + 1)}</p></div><button class="btn" data-action="sequence-auto">사용 문제로 자동 구성</button></div>
    <p class="sub">안내 화면과 문제를 원하는 위치에 배치하세요. 문제 목록의 순서를 바꿔도 이 구성은 유지됩니다.</p><div class="q-list">
    ${state.sequence.map((item, index) => {
      const question = item.type === 'question' ? state.questions.find(q => q.id === item.questionId) : null;
      const missing = item.type === 'question' ? !question : !state.customScreens.some(screen => screen.id === item.screenId);
      return `<article class="q-item ${state.sequenceIndex === index ? 'current' : ''}"><div class="q-no">${index + 1}</div><div class="q-copy"><strong>${esc(sequenceItemLabel(item))}</strong><span>${item.type === 'question' ? '문제' : '안내 화면'}${question ? ` · ${esc(roundLabels[question.round] || '미지정')} · ${usageLabels[question.usageStatus]}` : ''}${missing ? ' · 참조 누락: 수정 필요' : ''}</span></div><div class="q-actions"><button class="btn sm" data-sequence-edit="up" data-index="${index}" aria-label="항목 ${index + 1} 위로" ${index ? '' : 'disabled'}>↑</button><button class="btn sm" data-sequence-edit="down" data-index="${index}" aria-label="항목 ${index + 1} 아래로" ${index === state.sequence.length - 1 ? 'disabled' : ''}>↓</button><button class="btn sm" data-sequence-go="${index}">이동</button><button class="btn sm danger-ghost" data-sequence-edit="remove" data-index="${index}">구성에서 빼기</button></div></article>`;
    }).join('') || '<div class="empty-state"><p>구성이 비어 있습니다. 오른쪽에서 항목을 추가해주세요.</p></div>'}</div></section>
    <aside class="stack"><article class="card"><h2>항목 추가</h2><p class="sub">선택한 항목을 구성 마지막에 추가합니다.</p><div class="form-grid one-column"><div class="field"><label for="sequence-question">문제 선택</label><select id="sequence-question"><option value="">문제를 선택하세요</option>${state.questions.filter(q => q.usageStatus !== 'disabled').map(q => `<option value="${esc(q.id)}">${esc(`${q.id} · ${q.title || q.question || '미입력'} · ${usageLabels[q.usageStatus]}`)}</option>`).join('')}</select></div><button class="btn" data-action="sequence-add-question">문제 추가</button><div class="field"><label for="sequence-screen">안내 화면 선택</label><select id="sequence-screen">${state.customScreens.map(screen => `<option value="${esc(screen.id)}">${esc(screen.title || screen.id)}</option>`).join('')}</select></div><button class="btn" data-action="sequence-add-screen">화면 추가</button></div></article>
    <article class="card"><div class="section-head"><h2>안내 화면 편집</h2><button class="btn sm" data-action="add-screen">+ 새 화면</button></div><div class="screen-library">${state.customScreens.map(screen => `<button class="btn ghost" data-edit-screen="${esc(screen.id)}">${esc(screen.title || '(제목 없음)')}<small>${esc(screen.id)}</small></button>`).join('')}</div></article></aside></div>`;
}

function activateSequence(next, index) {
  next.sequenceIndex = next.sequence.length ? Math.min(Math.max(0, index), next.sequence.length - 1) : -1;
  next.runtime.currentInsertionId = null;
  next.runtime.overlay = null;
  activateCurrentItem(next);
}

function activateCurrentItem(next) {
  const item = activeItem(next);
  const questionIndex = item?.type === 'question' ? next.questions.findIndex(question => question.id === item.questionId) : -1;
  next.displayMode = questionIndex >= 0 ? 'question' : 'screen';
  if (questionIndex >= 0) next.currentIndex = questionIndex;
  next.answerVisible = false;
  next.timer = { remaining: questionIndex >= 0 ? next.questions[questionIndex].timeLimit : 0, running: false, endAt: null };
}

function mayNavigate() {
  return !state.runSettings.safetyLock || !state.timer.running || getTimerRemaining(state.timer) <= 0 || confirm('타이머가 실행 중입니다. 시간을 멈추고 이동할까요?');
}

function logCurrentItem(next) {
  const item = activeItem(next);
  runtimeLog(next, item?.type === 'question' ? 'question-start' : 'screen', item?.type === 'question' ? `${item.questionId} 시작` : `${sequenceItemLabel(item)} 화면`);
}

function rememberPosition(next, kind) {
  if (next.runtime.returns.length >= 20) next.runtime.returns.shift();
  next.runtime.returns.push({ kind, sequenceIndex: next.sequenceIndex, currentInsertionId: next.runtime.currentInsertionId, overlay: next.runtime.overlay ? { ...next.runtime.overlay } : null, remaining: getTimerRemaining(next.timer), answerVisible: next.answerVisible });
}

function goSequence(index, remember = false) {
  if (!Number.isInteger(index) || index < 0 || index >= state.sequence.length) return;
  const position = effectiveSequence(state).findIndex(item => !item.insertionId && item.baseIndex === index);
  return goRuntimePosition(position, remember);
}

function goRuntimePosition(position, remember = false) {
  const target = effectiveSequence(state)[position];
  if (!target || !mayNavigate()) return;
  return update(next => {
    if (remember) rememberPosition(next, 'jump');
    else if (next.runtime.overlay && next.runtime.returns.at(-1)?.kind === 'override') next.runtime.returns.pop();
    next.sequenceIndex = target.baseIndex;
    next.runtime.currentInsertionId = target.insertionId || null;
    next.runtime.overlay = null;
    activateCurrentItem(next);
    runtimeLog(next, 'sequence-move', `${position + 1}번 항목으로 이동`);
    logCurrentItem(next);
  });
}

function showImmediateScreen(screenId, invalidate = false) {
  if (screenId !== 'technical' && !state.customScreens.some(screen => screen.id === screenId)) return;
  const question = currentQuestion();
  return update(next => {
    if (!next.runtime.overlay || next.runtime.overlay.type === 'question') rememberPosition(next, 'override');
    if (invalidate && question && !next.runtime.invalidQuestions.some(row => row.questionId === question.id)) {
      next.runtime.invalidQuestions.push({ questionId: question.id, at: new Date().toISOString() });
      runtimeLog(next, 'invalid', `${question.id} 문제 무효`);
    }
    next.runtime.overlay = { type: 'screen', screenId };
    activateCurrentItem(next);
    runtimeLog(next, 'immediate-screen', `${sequenceItemLabel(next.runtime.overlay)} 즉시 송출`);
  });
}

function returnToPrevious() {
  if (!state.runtime.returns.length || !mayNavigate()) return;
  return update(next => {
    const saved = next.runtime.returns.pop();
    next.sequenceIndex = next.sequence.length ? Math.min(next.sequence.length - 1, Math.max(0, saved.sequenceIndex)) : -1;
    next.runtime.currentInsertionId = next.runtime.insertions.some(row => row.id === saved.currentInsertionId) ? saved.currentInsertionId : null;
    next.runtime.overlay = saved.overlay;
    activateCurrentItem(next);
    if (next.displayMode === 'question') {
      next.timer.remaining = saved.remaining;
      next.answerVisible = saved.answerVisible && !next.runtime.invalidQuestions.some(row => row.questionId === activeItem(next)?.questionId);
    }
    runtimeLog(next, 'return', '직전 화면으로 복귀 · 타이머 일시정지');
  });
}

function useReserve(questionId, mode) {
  const question = state.questions.find(item => item.id === questionId && item.usageStatus === 'reserve');
  if (!question || !['immediate', 'insert'].includes(mode)) return;
  if (mode === 'insert' && state.runtime.insertions.length >= 500) return toast('임시 삽입은 최대 500개입니다.');
  if (mode === 'immediate' && !mayNavigate()) return;
  const saved = update(next => {
    if (mode === 'immediate') {
      rememberPosition(next, 'override');
      next.runtime.overlay = { type: 'question', questionId };
      activateCurrentItem(next);
      logCurrentItem(next);
    } else {
      const row = { id: createId(), questionId, afterIndex: next.sequenceIndex };
      const current = next.runtime.insertions.findIndex(item => item.id === next.runtime.currentInsertionId);
      const firstAfter = next.runtime.insertions.findIndex(item => item.afterIndex === next.sequenceIndex);
      const at = current >= 0 ? current + 1 : firstAfter >= 0 ? firstAfter : next.runtime.insertions.length;
      next.runtime.insertions.splice(at, 0, row);
    }
    next.runtime.reserveUses.push({ questionId, mode, at: new Date().toISOString() });
    if (next.runtime.reserveUses.length > 2000) next.runtime.reserveUses.shift();
    runtimeLog(next, 'reserve-use', `${questionId} 예비문제 ${mode === 'insert' ? '다음에 임시 삽입' : '즉시 사용'}`);
  });
  if (saved) { modal = null; render(); }
}

function canEditSequence() {
  if (state.runtime.insertions.length || state.runtime.returns.length || state.runtime.overlay) {
    toast('임시 진행을 정리한 뒤 원본 구성을 편집해주세요.');
    return false;
  }
  return mayNavigate();
}

function clearInterventions() {
  if (!confirm('임시 삽입과 복귀 위치를 정리할까요? 원본 구성과 사용·무효·진행 로그는 유지합니다.')) return;
  update(next => {
    next.runtime.insertions = [];
    next.runtime.returns = [];
    activateSequence(next, next.sequenceIndex);
    runtimeLog(next, 'runtime-clear', '임시 진행 정리');
  });
}

function appendSequence(type, id) {
  if (!canEditSequence()) return;
  if (!id || state.sequence.length >= 2000) return toast('추가할 항목을 선택해주세요. 구성은 최대 2,000개입니다.');
  if (type === 'question') {
    const question = state.questions.find(item => item.id === id);
    if (!question || question.usageStatus === 'disabled') return toast('미사용 문제는 구성에 추가할 수 없습니다.');
    if (question.usageStatus === 'reserve' && !confirm('예비 문제를 본 행사 구성에 추가할까요?')) return;
  } else if (type !== 'screen' || !state.customScreens.some(screen => screen.id === id)) return;
  update(next => {
    next.sequence.push(type === 'question' ? { type, questionId: id } : { type, screenId: id });
    if (next.sequenceIndex < 0) activateSequence(next, 0);
  });
}

function editSequence(index, action) {
  if (!canEditSequence()) return;
  if (!state.sequence[index]) return;
  const target = action === 'up' ? index - 1 : index + 1;
  if (action !== 'remove' && (target < 0 || target >= state.sequence.length)) return;
  const active = state.sequence[state.sequenceIndex];
  update(next => {
    if (action === 'remove') next.sequence.splice(index, 1);
    else [next.sequence[index], next.sequence[target]] = [next.sequence[target], next.sequence[index]];
    const position = next.sequence.indexOf(active);
    if (position >= 0) next.sequenceIndex = position;
    else activateSequence(next, Math.min(index, next.sequence.length - 1));
  });
}

function openScreenEditor(id = null) {
  const screen = id ? state.customScreens.find(item => item.id === id) : null;
  if (id && !screen) return;
  modal = { type: 'screen', screen: screen ? { ...screen } : { id: null, title: '', subtitle: '', description: '', emphasis: '', style: 'blue' } };
  render();
}

function renderScreenEditor() {
  const screen = modal.screen;
  return `<div class="modal-backdrop" data-action="close-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="section-head"><h2 id="modal-title">안내 화면 편집</h2><button class="btn" data-action="close-modal">닫기</button></div><form id="screen-form" class="form-grid">${[['title', '제목', 100], ['subtitle', '부제', 150], ['description', '설명', 2000], ['emphasis', '강조 문구', 150]].map(([field, label, max]) => `<div class="field wide"><label for="screen-${field}">${label}</label>${field === 'description' ? `<textarea id="screen-${field}" maxlength="${max}">${esc(screen[field])}</textarea>` : `<input id="screen-${field}" maxlength="${max}" value="${esc(screen[field])}">`}</div>`).join('')}<div class="field wide"><label for="screen-style">화면 스타일</label><select id="screen-style">${selectOptions(screenStyles, screen.style)}</select></div><p class="field-help wide">설명은 최대 2,000자 저장되며 프로젝터에는 1,200자까지 표시됩니다. 빈칸은 빈칸으로 저장됩니다. 이 화면을 사용하는 모든 구성 항목에 반영됩니다.</p><div class="wide modal-actions"><button class="btn" type="button" data-action="close-modal">취소</button><button class="btn primary" type="submit">화면 저장</button></div></form></section></div>`;
}

function saveScreen() {
  if (modal?.type !== 'screen') return;
  if (!modal.screen.id && state.customScreens.length >= 200) return toast('안내 화면은 최대 200개입니다.');
  const fields = Object.fromEntries(['title','subtitle','description','emphasis','style'].map(field => [field, document.getElementById(`screen-${field}`).value.trim()]));
  const data = { id: modal.screen.id || createId(), ...publicScreen(fields), description: safeText(fields.description, 2000) };
  const previous = structuredClone(state);
  const index = state.customScreens.findIndex(screen => screen.id === data.id);
  if (index < 0) state.customScreens.push(data);
  else state.customScreens[index] = data;
  const messageKey = Object.keys(legacyScreenIds).find(key => legacyScreenIds[key] === data.id);
  if (messageKey) state.messages[messageKey] = data.id === 'rules' ? data.description : data.title;
  if (!saveState()) { state = previous; return; }
  modal = null;
  render();
  toast('안내 화면을 저장했습니다.');
}

function renderQuestions() {
  const visible = filteredQuestions();
  const missing = state.questions.filter(question => !question.question || !question.answer || hasProjectionOverflow(question)).length;
  const unfinal = state.questions.filter(question => question.usageStatus === 'active' && question.reviewStatus !== 'final').length;
  const filters = [
    ['category', '구분', Object.fromEntries(Object.entries(categoryMeta).map(([key, value]) => [key, value.label]))],
    ['round', '라운드', { none: '미지정', ...roundLabels }], ['usageStatus', '사용 상태', usageLabels],
    ['difficulty', '난이도', difficultyLabels], ['reviewStatus', '검수 상태', reviewLabels],
    ['author', '출제자', Object.fromEntries([...new Set(state.questions.map(q => q.author).filter(Boolean))].sort().map(author => [author, author]))],
  ];
  return `
    <div class="content-layout">
      <section class="card content-card"><div class="section-head responsive-head"><div><p class="eyebrow">출제 콘솔</p><h2>문제 슬라이드</h2><p class="sub">전체 ${state.questions.length}문제 · 검색 결과 ${visible.length}문제 · 내용 확인 ${missing}문제</p></div><button class="btn primary" data-action="add-question">+ 문제 추가</button></div>
      <form id="question-filters" class="question-filters"><div class="field filter-search"><label for="filter-search">문제·정답·ID 검색</label><input id="filter-search" name="search" type="search" value="${esc(questionFilters.search || '')}" placeholder="검색어 입력"></div>
      ${filters.map(([key, label, values]) => `<div class="field"><label for="filter-${key}">${label}</label><select id="filter-${key}" name="${key}"><option value="">전체</option>${selectOptions(values, questionFilters[key])}</select></div>`).join('')}
      <label class="filter-checkbox"><input name="hideDisabled" type="checkbox" ${questionFilters.hideDisabled ? 'checked' : ''}>미사용 숨기기</label><div class="row"><button class="btn sm" type="submit">필터 적용</button><button class="btn sm ghost" type="button" data-action="clear-filters">초기화</button></div></form>
      ${unfinal ? `<p class="overflow-notice">사용 문제 중 ${unfinal}개가 최종 확정 전입니다. 편집·저장은 계속할 수 있습니다.</p>` : ''}
      <div class="q-list">${visible.map((question, position) => {
        const index = state.questions.indexOf(question);
        return `<article class="q-item usage-${question.usageStatus} ${index === state.currentIndex ? 'current' : ''}"><div class="q-no"><span>${String(index + 1).padStart(2, '0')}</span>${index === state.currentIndex ? '<small>현재</small>' : ''}</div><div class="q-copy"><strong>${richText(question.question || question.title || '미입력 문제')}</strong><span>${esc(question.id)} · ${esc(categoryMeta[question.category].label)} · ${esc(roundLabels[question.round] || '라운드 미지정')} · ${question.timeLimit}초</span><div class="row wrap"><span class="badge">${usageLabels[question.usageStatus]}</span><span class="badge">${difficultyLabels[question.difficulty]}</span><span class="badge ${question.reviewStatus === 'final' ? 'green' : ''}">${reviewLabels[question.reviewStatus]}</span><span>${esc(question.author || '출제자 미지정')}</span></div></div><div class="q-actions"><button class="btn sm" data-move-q="${esc(question.id)}" data-direction="-1" aria-label="${index + 1}번 문제 위로" ${position === 0 ? 'disabled' : ''}>↑</button><button class="btn sm" data-move-q="${esc(question.id)}" data-direction="1" aria-label="${index + 1}번 문제 아래로" ${position === visible.length - 1 ? 'disabled' : ''}>↓</button><button class="btn sm" data-edit-q="${esc(question.id)}">수정</button><button class="btn sm" data-go-q="${index}">송출</button><button class="btn sm danger-ghost" data-delete-q="${esc(question.id)}">삭제</button></div></article>`;
      }).join('') || '<div class="empty-state"><h3>조건에 맞는 문제가 없습니다</h3><p>필터를 초기화하거나 새 문제를 추가해주세요.</p></div>'}</div></section>
      <aside class="stack side-notes"><article class="card"><p class="eyebrow">전체 문제 기준</p><h2>검수 현황</h2><div class="review-stats"><div class="stat"><span>전체</span><strong>${state.questions.length}</strong></div>${Object.entries(reviewLabels).map(([key, label]) => `<div class="stat"><span>${label}</span><strong>${state.questions.filter(question => question.reviewStatus === key).length}</strong></div>`).join('')}</div></article><article class="card note-card"><strong>문제 유형과 라운드는 별개입니다</strong><p>예비 문제는 본 진행과 분리해 보관하세요. 위·아래 버튼은 현재 필터에 보이는 인접 문제와 위치를 바꾸며, ID는 유지됩니다.</p><p>인정답안·판정 메모·진행 메모·출제자·검수 상태는 프로젝터로 보내지 않습니다.</p></article></aside>
    </div>`;
}

function selectOptions(labels, selected) {
  return Object.entries(labels).map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

function filteredQuestions() {
  const search = (questionFilters.search || '').trim().toLocaleLowerCase();
  return state.questions.filter(question => {
    if (questionFilters.hideDisabled && question.usageStatus === 'disabled') return false;
    if (search && ![question.id, question.question, question.answer].some(value => value.toLocaleLowerCase().includes(search))) return false;
    return ['category', 'round', 'usageStatus', 'difficulty', 'author', 'reviewStatus'].every(field => !questionFilters[field] || (field === 'round' ? question.round || 'none' : question[field]) === questionFilters[field]);
  });
}

function moveQuestion(id, direction) {
  const visible = filteredQuestions();
  const position = visible.findIndex(question => question.id === id);
  const target = visible[position + direction];
  if (position < 0 || !target) return;
  const currentId = currentQuestion()?.id;
  update(next => {
    const from = next.questions.findIndex(question => question.id === id);
    const to = next.questions.findIndex(question => question.id === target.id);
    [next.questions[from], next.questions[to]] = [next.questions[to], next.questions[from]];
    next.questions.forEach((question, index) => { question.order = index + 1; });
    next.currentIndex = Math.max(0, next.questions.findIndex(question => question.id === currentId));
  });
}

function importOptions() {
  return { enums: questionEnums, migrate: migrateQuestion, validTime: validTimeLimit, safeImage, maxImages: MAX_TOTAL_IMAGE_DATA_LENGTH };
}
function clearPreparationDrafts() {
  preparationEpoch++;
  importDraft = null;
  preflightResult = null;
  preflightBusy = false;
  startupChecks.clear();
  modal = null;
}
function preparationSignature() { return JSON.stringify([state.questions, state.sequence, state.customScreens, state.runSettings]); }
function prepareBatch() {
  importDraft.newIds ||= importDraft.rows.map(() => createId());
  return prepareQuestionImport(importDraft.rows, state.questions, importDraft.mode, { ...importOptions(), newIds: importDraft.newIds });
}
function parseBatch() {
  const text = document.getElementById('batch-text').value;
  const format = document.getElementById('batch-format').value;
  importDraft = { text, format, mode: importDraft?.mode || 'append' };
  try { importDraft.rows = parseQuestionImport(text, format); }
  catch (error) { importDraft.error = `파일 해석 오류: ${error.message}`; }
  render();
}
async function readBatchFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) return alert('10MB 이하 파일만 가져올 수 있습니다.');
  const draft = importDraft = { text: '', format: /\.csv$/i.test(file.name) ? 'csv' : 'json', mode: 'append', busy: true };
  render();
  try {
    draft.text = await file.text();
    draft.rows = parseQuestionImport(draft.text, draft.format);
  } catch (error) { draft.error = `파일 해석 오류: ${error.message}`; }
  finally { draft.busy = false; if (importDraft === draft && state) render(); }
}
async function brokenImages(questions) {
  const failed = [], checked = new Map();
  for (const q of questions) {
    if (!q.image) continue;
    if (!checked.has(q.image)) {
      try { const image = await loadImage(q.image); checked.set(q.image, image.naturalWidth > 0 && image.naturalHeight > 0); }
      catch { checked.set(q.image, false); }
    }
    if (!checked.get(q.image)) failed.push(q.id);
  }
  return failed;
}
function commitQuestionBatch(result, mode) {
  if (result.errors.length || persistenceBlocked) return false;
  backupReadToken++;
  const applied = update(next => {
    next.questions = result.questions;
    if (mode === 'replace') {
      next.runtime = defaultRuntime();
      // Preserve the operator's slide construction; preflight exposes dangling IDs.
      activateSequence(next, 0);
    }
    stopTimerIn(next);
    next.answerVisible = false;
    next.runtime.returns.forEach(position => { position.answerVisible = false; });
    next.currentIndex = Math.max(0, next.questions.findIndex(q => q.id === activeItem(next)?.questionId));
    const item = activeItem(next);
    if (item?.type === 'question' && next.questions.some(q => q.id === item.questionId)) {
      if (next.displayMode !== 'question') activateCurrentItem(next);
      else next.displayMode = 'question';
    } else next.displayMode = 'screen';
    runtimeLog(next, 'question-import', `문제 ${mode} · ${result.prepared.length}개`);
  });
  if (applied) { clearPreparationDrafts(); render(); toast('문제를 적용했습니다. 행사 구성과 점검 결과를 확인해주세요.'); }
  return applied;
}
async function applyBatch() {
  const draft = importDraft;
  if (!draft?.rows || draft.busy || !state || persistenceBlocked) return;
  let result = prepareBatch();
  if (result.errors.length) return;
  draft.busy = true;
  draft.error = '';
  render();
  try {
    const failed = await brokenImages(result.prepared);
    if (draft !== importDraft || !state || !isUnlocked()) return;
    if (failed.length) throw new Error(`이미지를 읽을 수 없는 문제: ${failed.join(', ')}`);
    result = prepareBatch(); // Merge against current data, not an old preview.
    if (result.errors.length) return;
    if (draft.mode === 'replace' && !confirm('전체 문제를 교체할까요? 타이머·정답 공개·임시 진행 기록은 초기화됩니다. 기존 행사 구성은 유지되어 누락 참조가 생길 수 있습니다. 적용 전 JSON 백업을 저장합니다.')) return;
    if (draft.mode !== 'replace' && !mayNavigate()) return;
    downloadBackup('before-question-import');
    commitQuestionBatch(result, draft.mode);
  } catch (error) { draft.error = error.message; }
  finally { draft.busy = false; if (state) render(); }
}
async function runPreflight() {
  if (preflightBusy || !state) return;
  preflightBusy = true;
  const epoch = preparationEpoch;
  const signature = preparationSignature();
  const snapshot = structuredClone(state);
  const result = checkPreparation(snapshot, { validTime: validTimeLimit, safeImage, math: renderMath });
  render();
  try {
    const broken = await brokenImages(snapshot.questions);
    if (epoch !== preparationEpoch || !state) return;
    for (const id of broken) if (!result.issues.some(issue => issue.code === 'image' && issue.id === id)) result.issues.push({ severity: 'error', code: 'image', id, label: `${id}: 이미지 파일을 디코딩할 수 없습니다.` });
    const badIds = new Set(result.issues.filter(issue => issue.severity === 'error' && issue.id).map(issue => issue.id));
    result.normal = snapshot.questions.filter(q => !badIds.has(q.id)).length;
    preflightResult = { ...result, signature };
  } finally { if (epoch === preparationEpoch) { preflightBusy = false; if (state) render(); } }
}
function renderQuestionMathPreview(question) {
  return `${question.image ? `<img class="operator-question-image" src="${safeImage(question.image)}" alt="${esc(question.imageAlt || '문제 이미지')}">` : ''}<div>${richText(question.question || '문제 미입력')}</div><p><small>정답</small> ${richText(question.answer || '정답 미입력')}</p>${question.explanation ? `<p>${richText(question.explanation)}</p>` : ''}`;
}
function renderPreparation() {
  const preview = importDraft?.rows ? prepareBatch() : null;
  const result = preflightResult;
  const stale = result && result.signature !== preparationSignature();
  return `<div class="preparation-grid"><section class="stack"><article class="card"><div class="section-head"><div><p class="eyebrow">행사 준비</p><h2>행사 준비 점검</h2></div><button class="btn primary" data-action="preflight" ${preflightBusy ? 'disabled' : ''}>${preflightBusy ? '사진 확인 중…' : '자동 점검 실행'}</button></div><p class="sub">문제·수식·사진 파일·구성 참조를 검사합니다. 경고가 있어도 진행을 강제로 막지 않습니다.</p>
    ${result ? `${stale ? '<p class="overflow-notice">점검 후 데이터가 변경되었습니다. 다시 점검해주세요.</p>' : ''}<div class="preflight-stats"><span>✓ 내용 정상 ${result.normal}개</span><span>✕ 오류 ${result.issues.filter(i => i.severity === 'error').length}건</span><span>⚠ 경고 ${result.issues.filter(i => i.severity === 'warning').length}건</span><span>예비문제 ${result.reserve}개</span></div><ul class="validation-list">${result.issues.map(issue => `<li class="${issue.severity}">${issue.severity === 'error' ? '✕' : '⚠'} ${esc(issue.label)}</li>`).join('') || '<li>자동 검사 항목을 모두 통과했습니다.</li>'}</ul>` : '<p class="empty-state">아직 점검하지 않았습니다.</p>'}</article>
    <article class="card"><h2>시작 전 직접 확인</h2><p class="sub">하드웨어 자동 감지가 아닙니다. 실제 프로젝터와 진행 노트북에서 확인하세요. 체크 상태는 이 탭을 닫으면 초기화됩니다.</p><div class="startup-checks">${[['projector', '프로젝터 연결·전체 화면·가독성'], ['data', '문제 데이터·사진·수식·JSON 백업'], ['sequence', '행사 순서·패자부활·최종 라운드'], ['timer', '타이머 시작·종료·복귀 동작'], ['settings', '행사 날짜·시간·부제·안전 잠금']].map(([id, label]) => `<label><input type="checkbox" data-startup-check="${id}" ${startupChecks.has(id) ? 'checked' : ''}>${label}</label>`).join('')}</div><p class="field-help">오프라인 현장 진행은 이 프로젝트의 로컬 서버 실행을 권장합니다. KaTeX와 폰트는 프로젝트 내부 파일이며 CDN을 사용하지 않습니다.</p></article></section>
    <section class="card"><p class="eyebrow">문제 제작</p><h2>문제 일괄 가져오기</h2><p class="sub">문제만 추가·업데이트·교체합니다. 전체 백업 복원은 행사·슬라이드 설정에서 사용하세요. JSON 배열 또는 { questions: [...] }, CSV를 지원합니다.</p>
    <form id="batch-form" class="form-grid one-column"><div class="field"><label for="batch-file">JSON / CSV 파일</label><input id="batch-file" type="file" accept=".json,.csv,application/json,text/csv" ${importDraft?.busy ? 'disabled' : ''}></div><div class="field"><label for="batch-format">붙여넣기 형식</label><select id="batch-format" ${importDraft?.busy ? 'disabled' : ''}>${selectOptions({ json: 'JSON', csv: 'CSV' }, importDraft?.format || 'json')}</select></div><div class="field"><label for="batch-text">문제 데이터 붙여넣기</label><textarea id="batch-text" rows="6" ${importDraft?.busy ? 'disabled' : ''}>${esc(importDraft?.text || '')}</textarea></div><button type="submit" class="btn" ${importDraft?.busy ? 'disabled' : ''}>파싱·미리보기</button></form>
    <p class="field-help">CSV 헤더: id,category,round,question,answer,explanation,acceptedAnswers,judgeNote,author,difficulty,timeLimit,usageStatus,reviewStatus<br>생략된 선택 필드는 새 문제의 기본값을 사용합니다. ID 업데이트는 생략된 기존 필드를 유지합니다. 빈 round는 미지정입니다.</p>
    ${importDraft?.error ? `<p class="overflow-notice" role="alert">${esc(importDraft.error)}</p>` : ''}
    ${preview ? `<div class="import-preview"><h3>적용 전 미리보기 · ${importDraft.rows.length}개</h3><div class="field"><label for="batch-mode">가져오기 방식</label><select id="batch-mode" ${importDraft.busy ? 'disabled' : ''}>${selectOptions({ append: '기존 문제에 추가', update: 'ID가 같으면 업데이트', replace: '전체 문제 교체' }, importDraft.mode)}</select></div><p class="sub">적용 후 전체 ${preview.questions.length}개. 전체 교체 시 원본 행사 구성은 유지하고 임시 진행은 초기화합니다. 구성의 누락 참조는 자동 점검에서 확인하세요.</p><ul class="validation-list">${preview.errors.map(error => `<li class="error">${error.row ? `문제 ${error.row}` : '전체'} · ${esc(error.message)}</li>`).join('')}</ul><div class="import-rows">${preview.prepared.map(q => `<article><small>${esc(q.id)} · ${esc(q.category)} · ${esc(q.round || '미지정')}</small><div>${richText(q.question || '문제 없음')}</div><p>정답: ${richText(q.answer || '정답 없음')}</p></article>`).join('')}</div><button class="btn primary" data-action="batch-apply" ${preview.errors.length || importDraft.busy || persistenceBlocked ? 'disabled' : ''}>${importDraft.busy ? '확인 중…' : '검증한 문제 적용'}</button></div>` : ''}</section></div>`;
}

function renderSettings() {
  return `
    <div class="settings-grid"><section class="stack"><article class="card content-card"><p class="eyebrow">행사 정보</p><h2>프레젠테이션 설정</h2><form id="settings-form" class="form-grid settings-form">
      <div class="field wide"><label for="event-title">행사명</label><input id="event-title" maxlength="100" value="${esc(state.event.title)}"></div><div class="field"><label for="event-date">일시</label><input id="event-date" maxlength="100" value="${esc(state.event.date)}"></div><div class="field"><label for="event-place">장소</label><input id="event-place" maxlength="100" value="${esc(state.event.place)}"></div>
      <div class="field wide"><label for="message-tagline">공통 부제</label><input id="message-tagline" maxlength="100" value="${esc(state.messages.tagline)}"></div><div class="field wide"><label for="message-lobby">대기 슬라이드</label><input id="message-lobby" maxlength="100" value="${esc(state.messages.lobby)}"></div><div class="field wide"><label for="message-opening">오프닝 슬라이드</label><input id="message-opening" maxlength="100" value="${esc(state.messages.opening)}"></div><div class="field wide"><label for="message-rules">진행 안내 (한 줄에 하나씩)</label><textarea id="message-rules" maxlength="2000">${esc(state.messages.rules)}</textarea><span class="field-help">프로젝터에는 최대 1,200자까지만 표시됩니다.</span></div><div class="field wide"><label for="message-break">휴식 슬라이드</label><input id="message-break" maxlength="100" value="${esc(state.messages.break)}"></div><div class="field wide"><label for="message-ending">마침 슬라이드</label><input id="message-ending" maxlength="100" value="${esc(state.messages.ending)}"></div><div class="wide"><button class="btn primary" type="submit">설정 저장</button></div>
    </form></article></section>
    <aside class="stack">${renderRunSettings()}<article class="card"><p class="eyebrow">접근 보호</p><h2>진행 PIN 변경</h2><div class="form-grid one-column"><div class="field"><label for="current-pin">현재 PIN</label><input id="current-pin" type="password" inputmode="numeric" maxlength="12" autocomplete="current-password"></div><div class="field"><label for="new-pin">새 PIN (4~12자리 숫자)</label><input id="new-pin" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div><div class="field"><label for="new-pin-confirm">새 PIN 확인</label><input id="new-pin-confirm" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div><button class="btn" data-action="change-pin">PIN 변경</button></div><p class="security-caption">이 PIN은 진행 노트북의 관리 화면을 잠그는 용도입니다. 공개 인터넷 서비스용 계정 인증은 아닙니다.</p></article>
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
  if (mode === 'screen') {
    const screen = publicScreen(publicState.screen || {});
    app.innerHTML = `<main class="screen-mode ${screen.template ? screenTheme(screen) : `custom-slide slide-${screen.style}`}"><header class="screen-head"><div class="screen-brand"><span>Σ</span>${esc(event.title || '')}</div>${screen.template ? `<div class="screen-status"><span></span>${esc(screenModeMeta[screen.template].label)}</div>` : ''}</header>${screen.template && screen.template !== 'rules' ? '<div class="screen-watermark" aria-hidden="true">Σ</div>' : ''}${renderScreenContent(screen, false, event, messages)}<footer class="screen-simple-footer"><span>${esc(messages.tagline || '')}</span><span>SIGMA</span></footer>${renderScreenTool()}</main>`;
    bindScreenEvents();
    return;
  }
  if (mode === 'rules') {
    const rules = safeText(messages.rules, 1200).split(/\r?\n/).filter(Boolean).slice(0, 6).map(rule => safeText(rule, 180));
    app.innerHTML = `<main class="screen-mode screen-rules"><header class="screen-head"><div class="screen-brand"><span>Σ</span>${esc(event.title ?? '시그마 수학 골든벨')}</div><div class="screen-status"><span></span>진행 안내</div></header><section class="screen-rules-wrap"><p>HOW TO PLAY</p><h1>진행 안내</h1><ol>${rules.map(rule => `<li>${esc(rule)}</li>`).join('')}</ol></section><footer class="screen-simple-footer"><span>${esc(messages.tagline || '')}</span><span>SIGMA</span></footer>${renderScreenTool()}</main>`;
    bindScreenEvents();
    return;
  }
  if (mode !== 'question') {
    const title = messages[mode] ?? messages.lobby ?? '잠시 후 시작합니다';
    const kicker = mode === 'lobby' ? 'SIGMA GOLDEN BELL' : mode === 'opening' ? 'LET\'S BEGIN' : mode === 'break' ? 'BREAK TIME' : 'THANK YOU';
    app.innerHTML = `<main class="screen-mode screen-${mode}"><header class="screen-head"><div class="screen-brand"><span>Σ</span>${esc(event.title ?? '시그마 수학 골든벨')}</div><div class="screen-status"><span></span>${esc(screenModeMeta[mode].label)}</div></header><div class="screen-watermark" aria-hidden="true">Σ</div><section class="screen-message"><p>${esc(kicker)}</p><h1>${esc(title)}</h1><span>${mode === 'lobby' ? `${esc(event.date || '')}${event.date && event.place ? ' · ' : ''}${esc(event.place || '')}` : esc(messages.tagline || '')}</span></section><footer class="screen-simple-footer"><span>${esc(messages.tagline || '')}</span><span>SIGMA</span></footer>${renderScreenTool()}</main>`;
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
  app.innerHTML = `<main class="screen-mode screen-question-mode ${publicState.answerVisible ? 'answer-open' : ''}"><header class="screen-head"><div class="screen-brand"><span>Σ</span>${esc(event.title ?? '시그마 수학 골든벨')}</div><div class="screen-round"><span class="screen-category ${category.className}">${esc(category.label)}</span><strong>${Number(publicState.currentIndex) + 1}</strong><span>/ ${Number(publicState.totalQuestions) || 0}</span></div></header><section class="screen-question-wrap"><p class="screen-q-title">${esc(question.title || `문제 ${Number(publicState.currentIndex) + 1}`)}</p><div class="screen-question-content ${image ? 'has-image' : ''}">${image ? `<img class="screen-question-image" src="${image}" alt="${esc(question.imageAlt || '문제 참고 이미지')}">` : ''}<h1 class="screen-question ${questionSizeClass(question.question)}">${richText(question.question || '문제를 준비 중입니다.')}</h1></div>${publicState.answerVisible ? `<div class="screen-answer"><span>정답</span><strong class="${answerSizeClass(question.answer)}">${richText(question.answer || '정답 미입력')}</strong>${question.explanation ? `<p>${richText(question.explanation)}</p>` : ''}</div>` : ''}</section><footer class="screen-footer"><div class="screen-timer-copy"><span data-timer-label>${remaining <= 0 ? '시간 종료' : '남은 시간'}</span><strong data-timer-value class="${timerClass(publicState.timer)}">${formatTime(remaining)}</strong></div><div class="screen-motto">${esc(messages.tagline ?? 'SIGMA GOLDEN BELL')}</div></footer><div class="screen-progress"><div data-timer-progress></div></div>${renderScreenTool()}</main>`;
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
  if (modal.type === 'reserve') return renderReservePicker();
  if (modal.type === 'screen') return renderScreenEditor();
  if (modal.type !== 'question') return '';
  const question = modal.question;
  const selects = [
    ['category', '구분', Object.fromEntries(Object.entries(categoryMeta).map(([key, meta]) => [key, meta.label]))],
    ['round', '라운드', { '': '미지정', ...roundLabels }],
    ['usageStatus', '사용 상태', usageLabels], ['difficulty', '난이도', difficultyLabels], ['reviewStatus', '검수 상태', reviewLabels],
  ];
  return `<div class="modal-backdrop" data-action="close-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="section-head"><div><p class="eyebrow">출제 콘솔</p><h2 id="modal-title">${question.id ? '문제 수정' : '문제 추가'}</h2></div><button class="btn sm ghost" data-action="close-modal" aria-label="닫기">닫기</button></div>
    <form id="question-form" class="form-grid">
    <div class="field wide"><label for="q-id">고유 ID (순서를 바꿔도 유지)</label><input id="q-id" readonly value="${esc(question.id || '저장 시 자동 생성')}"></div>
    ${selects.map(([field, label, values]) => `<div class="field"><label for="q-${field}">${label}</label><select id="q-${field}">${selectOptions(values, question[field] ?? '')}</select></div>`).join('')}
    <div class="field"><label for="q-seconds">제한시간(초)</label><input id="q-seconds" type="number" min="1" max="600" step="1" required value="${esc(question.timeLimit ?? 30)}"></div>
    <div class="field"><label for="q-author">출제자</label><input id="q-author" maxlength="100" value="${esc(question.author)}"></div>
    <div class="field"><label for="q-title">문제 이름</label><input id="q-title" maxlength="100" value="${esc(question.title)}"></div>
    <div class="field wide"><label for="q-question">문제</label><textarea id="q-question" maxlength="2000">${esc(question.question)}</textarea><span class="field-help">프로젝터 권장 600자 · 긴 기존 내용은 보존되며 송출에서는 축약됩니다.</span></div>
    <div class="field wide"><label for="q-image">문제 그림·사진 (선택)</label><label class="image-picker" for="q-image">${question.image ? `<img src="${safeImage(question.image)}" alt="${esc(question.imageAlt || '선택한 문제 이미지')}"><span>다른 사진으로 교체</span>` : '<strong>사진 선택</strong><span>JPG·PNG·WebP · 자동 압축</span>'}<input id="q-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
    ${question.image ? '<button class="btn sm danger-ghost image-remove" type="button" data-action="remove-question-image">사진 삭제</button>' : ''}
    <label for="q-image-alt">사진 설명</label><input id="q-image-alt" maxlength="160" value="${esc(question.imageAlt)}"><span class="field-help">사진은 JSON 백업에 포함됩니다. ${modal.imageLoading ? '사진 처리 중…' : ''}</span></div>
    <div class="field wide"><label for="q-answer">정답</label><input id="q-answer" maxlength="500" value="${esc(question.answer)}"><span class="field-help">프로젝터 권장 200자</span></div>
    <div class="field wide"><label for="q-explanation">해설 (정답 공개 시 프로젝터 표시)</label><textarea id="q-explanation" maxlength="1500">${esc(question.explanation)}</textarea><span class="field-help">프로젝터 권장 400자</span></div>
    <section class="wide math-editor-preview" aria-label="문제 렌더링 미리보기"><h3>문제·수식 미리보기</h3><p class="field-help">인라인 $x^2$, 별도 줄 $$x^2$$ · 달러 기호는 \\$ · 오류가 있으면 원문을 표시합니다.</p><div id="question-math-preview">${renderQuestionMathPreview(question)}</div></section>
    <div class="field wide private-field"><label for="q-acceptedAnswers">인정 답안 (진행자 전용)</label><textarea id="q-acceptedAnswers" maxlength="2000">${esc(question.acceptedAnswers)}</textarea></div>
    <div class="field wide private-field"><label for="q-judgeNote">판정 메모 (진행자 전용)</label><textarea id="q-judgeNote" maxlength="2000">${esc(question.judgeNote)}</textarea></div>
    <div class="field wide private-field"><label for="q-note">진행 메모 (진행자 전용)</label><textarea id="q-note" maxlength="2000">${esc(question.note)}</textarea></div>
    <p class="field-help wide">작성 ${esc(question.createdAt)} · 수정 ${esc(question.updatedAt)}<br>사용 문제는 최종 확정 상태를 권장합니다. 초안도 저장할 수 있습니다.</p>
    <div class="wide modal-actions"><button type="button" class="btn" data-action="close-modal">취소</button><button type="submit" class="btn primary" ${modal.imageLoading ? 'disabled' : ''}>저장</button></div>
    </form></section></div>`;
}

function captureQuestionDraft() {
  if (!modal?.question) return;
  for (const field of ['category', 'round', 'usageStatus', 'difficulty', 'reviewStatus', 'author', 'title', 'question', 'answer', 'explanation', 'acceptedAnswers', 'judgeNote', 'note']) {
    const input = document.getElementById(`q-${field}`);
    if (input) modal.question[field] = field === 'round' ? input.value || null : input.value;
  }
  const timeInput = document.getElementById('q-seconds');
  if (timeInput) modal.question.timeLimit = timeInput.value;
  const altInput = document.getElementById('q-image-alt');
  if (altInput) modal.question.imageAlt = altInput.value;
}
function bindEvents() {
  const invalidateBatch = () => {
    if (importDraft?.busy) return;
    importDraft = { text: document.getElementById('batch-text').value, format: document.getElementById('batch-format').value, mode: importDraft?.mode || 'append' };
    const preview = document.querySelector('.import-preview');
    if (preview) preview.innerHTML = '<p>입력이 변경되었습니다. 파싱·미리보기를 다시 실행해주세요.</p>';
  };
  document.getElementById('batch-text')?.addEventListener('input', invalidateBatch);
  document.getElementById('batch-format')?.addEventListener('change', invalidateBatch);
  document.getElementById('batch-file')?.addEventListener('change', readBatchFile);
  document.getElementById('batch-form')?.addEventListener('submit', event => { event.preventDefault(); parseBatch(); });
  document.getElementById('batch-mode')?.addEventListener('change', event => { importDraft.mode = event.target.value; render(); });
  document.querySelectorAll('[data-startup-check]').forEach(input => input.addEventListener('change', () => input.checked ? startupChecks.add(input.dataset.startupCheck) : startupChecks.delete(input.dataset.startupCheck)));
  for (const field of ['question', 'answer', 'explanation']) document.getElementById(`q-${field}`)?.addEventListener('input', () => {
    captureQuestionDraft();
    document.getElementById('question-math-preview').innerHTML = renderQuestionMathPreview(modal.question);
  });
  document.getElementById('run-settings-form')?.addEventListener('submit', event => { event.preventDefault(); saveRunSettings(); });
  document.getElementById('manual-timer-form')?.addEventListener('submit', event => { event.preventDefault(); setManualTimer(document.getElementById('manual-timer').value); });
  document.querySelectorAll('[data-reserve-id]').forEach(element => element.addEventListener('click', () => useReserve(element.dataset.reserveId, element.dataset.reserveMode)));
  document.querySelectorAll('[data-immediate-screen]').forEach(element => element.addEventListener('click', () => showImmediateScreen(element.dataset.immediateScreen)));
  document.getElementById('screen-form')?.addEventListener('submit', event => { event.preventDefault(); saveScreen(); });
  document.querySelectorAll('[data-edit-screen]').forEach(element => element.addEventListener('click', () => openScreenEditor(element.dataset.editScreen)));
  document.querySelectorAll('[data-sequence-go]').forEach(element => element.addEventListener('click', () => goSequence(Number(element.dataset.sequenceGo), true)));
  document.querySelectorAll('[data-sequence-edit]').forEach(element => element.addEventListener('click', () => editSequence(Number(element.dataset.index), element.dataset.sequenceEdit)));
  document.getElementById('question-form')?.addEventListener('submit', event => { event.preventDefault(); saveQuestion(); });
  document.getElementById('question-filters')?.addEventListener('submit', event => {
    event.preventDefault();
    questionFilters = Object.fromEntries(new FormData(event.currentTarget));
    render();
  });
  document.querySelectorAll('[data-move-q]').forEach(element => element.addEventListener('click', () => moveQuestion(element.dataset.moveQ, Number(element.dataset.direction))));
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
  if (action === 'batch-apply') return applyBatch();
  if (action === 'preflight') return runPreflight();
  if (action === 'reserve-picker') { modal = { type: 'reserve' }; return render(); }
  if (action === 'runtime-return') return returnToPrevious();
  if (action === 'runtime-clear') return clearInterventions();
  if (action === 'runtime-jump') return goRuntimePosition(Number(document.getElementById('runtime-jump').value), true);
  if (action === 'invalid-question' && question && confirm(`${question.id} 문제를 이번 진행에서 무효로 표시할까요? 원본 문제는 유지됩니다.`)) return showImmediateScreen('invalid-question', true);
  if (action === 'clear-logs' && confirm('진행 로그를 초기화할까요? 예비문제 사용 기록과 무효 표시는 유지됩니다.')) return update(next => { next.runtime.logs = []; });
  if (action === 'event-start' && (!state.runtime.startedAt || confirm('행사 경과시간을 지금부터 다시 측정할까요?'))) return update(next => { next.runtime.startedAt = new Date().toISOString(); runtimeLog(next, 'event-start', '행사 시간 측정 시작'); });
  if (action === 'add-screen') return openScreenEditor();
  if (action === 'sequence-add-question') return appendSequence('question', document.getElementById('sequence-question').value);
  if (action === 'sequence-add-screen') return appendSequence('screen', document.getElementById('sequence-screen').value);
  if (action === 'sequence-auto') {
    if (!canEditSequence()) return;
    if (!confirm('현재 행사 구성을 사용 문제 기준으로 다시 만들까요? 진행 위치도 처음으로 돌아갑니다.')) return;
    return update(next => { next.sequence = buildAutoSequence(next.questions); activateSequence(next, 0); });
  }
  if (action === 'clear-filters') { questionFilters = {}; return render(); }
  if (action === 'open-screen') return openScreen();
  if (action === 'lock') return lockConsole();
  if (action === 'export') return exportData();
  if (action === 'prev') return goRuntimePosition(runtimePosition(state) - 1);
  if (action === 'next') return goRuntimePosition(runtimePosition(state) + 1);
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
    captureQuestionDraft();
    modal.imageRequest = (modal.imageRequest || 0) + 1;
    modal.imageLoading = false;
    modal.question.image = '';
    modal.question.imageAlt = '';
    return render();
  }
  if (action === 'change-pin') return changePin();
  if (action === 'reset-all' && confirm('문제와 행사 설정을 모두 초기화할까요? 진행 PIN은 유지됩니다.')) {
    backupReadToken++;
    downloadBackup('before-reset');
    const previous = state;
    const wasBlocked = persistenceBlocked;
    persistenceBlocked = false;
    state = defaultState();
    if (!saveState()) { state = previous; persistenceBlocked = wasBlocked; return; }
    clearPreparationDrafts();
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
  backupReadToken++;
  clearPreparationDrafts();
  if (state.timer.running) state.timer.remaining = getTimerRemaining(state.timer);
  state.timer.running = false;
  state.timer.endAt = null;
  state.answerVisible = false;
  clearInterval(timerHandle);
  timerHandle = null;
  if (!saveState({ locked: true })) publishPublicState({ locked: true });
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  state = null;
  authMessage = '';
  render();
}

function setScreenMode(mode) {
  const screenId = legacyScreenIds[mode];
  const index = state.sequence.findIndex(item => item.type === 'screen' && item.screenId === screenId);
  if (index < 0) return toast('행사 구성에 해당 화면을 먼저 추가해주세요.');
  goSequence(index);
}

function advancePresentation() {
  goRuntimePosition(runtimePosition(state) + 1);
}

function goQuestion(index) {
  const question = state.questions[index];
  if (!question) return;
  const sequenceIndex = state.sequence.findIndex(item => item.type === 'question' && item.questionId === question.id);
  if (sequenceIndex < 0) return toast('이 문제를 행사 구성에 먼저 추가해주세요.');
  goSequence(sequenceIndex, true);
}
function stopTimerIn(next) {
  next.timer = { remaining: getTimerRemaining(next.timer), running: false, endAt: null };
}

function toggleAnswer() {
  const question = currentQuestion();
  if (!question) return;
  if (!question.answer) return toast('정답을 먼저 입력해주세요.');
  if (!state.answerVisible && state.runSettings.safetyLock && state.timer.running && getTimerRemaining() > 0 && !confirm('아직 풀이 시간이 남아 있습니다. 타이머를 멈추고 정답을 공개할까요?')) return;
  update(next => {
    const opening = !next.answerVisible;
    if (opening) stopTimerIn(next);
    next.answerVisible = opening;
    runtimeLog(next, opening ? 'answer-reveal' : 'answer-hide', `${question.id} 정답 ${opening ? '공개' : '숨김'}`);
  });
}

function startTimer() {
  const question = currentQuestion();
  if (!question || state.timer.running) return;
  if (state.answerVisible) return toast('정답을 숨긴 뒤 타이머를 시작해주세요.');
  update(next => {
    const remaining = getTimerRemaining(next.timer) > 0 ? getTimerRemaining(next.timer) : question.timeLimit;
    next.timer = { remaining, running: true, endAt: Date.now() + remaining * 1000 };
    runtimeLog(next, 'timer-start', `${question.id} 타이머 시작 · ${Math.ceil(remaining)}초`);
  });
}

function pauseTimer() {
  if (!state.timer.running) return;
  update(next => {
    stopTimerIn(next);
    runtimeLog(next, 'timer-pause', `${activeItem(next)?.questionId || ''} 타이머 일시정지`);
  });
}

function resetTimer() {
  const question = currentQuestion();
  if (!question) return;
  if (state.runSettings.safetyLock && state.timer.running && getTimerRemaining() > 0 && !confirm('진행 중인 타이머를 멈추고 문제의 제한시간으로 초기화할까요?')) return;
  update(next => {
    next.timer = { remaining: question.timeLimit, running: false, endAt: null };
    runtimeLog(next, 'timer-reset', `${question.id} 타이머 초기화`);
  });
}

function adjustTimer(delta) {
  if (!currentQuestion()) return;
  const value = Math.max(0, Math.min(600, getTimerRemaining(state.timer) + delta));
  setTimerValue(value);
}

function setTimerValue(value) {
  if (!currentQuestion() || !Number.isFinite(value) || value < 0 || value > 600) return;
  update(next => {
    const running = next.timer.running && value > 0;
    if (next.timer.running && value <= 0) runtimeLog(next, 'timer-end', `${activeItem(next)?.questionId} 시간 종료`);
    next.timer = { remaining: value, running, endAt: running ? Date.now() + value * 1000 : null };
  });
}

function setManualTimer(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 600) return toast('시간은 0~600초의 정수로 입력해주세요.');
  setTimerValue(Number(value));
}

function refreshEventClock() {
  if (IS_SCREEN || !state) return;
  const clock = eventClock(state);
  document.querySelectorAll('[data-event-elapsed]').forEach(element => { element.textContent = formatClock(clock.elapsed); });
  document.querySelectorAll('[data-event-remaining]').forEach(element => { element.textContent = `${clock.remaining < 0 ? '종료 예정 초과 ' : ''}${formatClock(Math.abs(clock.remaining))}`; });
}

function formatClock(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(part => String(part).padStart(2, '0')).join(':');
}

function saveRunSettings() {
  const eventDate = document.getElementById('run-date').value;
  const startTime = document.getElementById('run-start').value;
  const endTime = document.getElementById('run-end').value;
  if (!validEventDate(eventDate) || !validClockTime(startTime) || !validClockTime(endTime)) return toast('유효한 행사 날짜와 시작·종료 시각을 입력해주세요.');
  update(next => { next.runSettings = { eventDate, startTime, endTime, safetyLock: document.getElementById('run-safety').checked }; });
}

function openQuestion(id = null) {
  const existing = id ? state.questions.find(question => question.id === id) : null;
  if (id && !existing) return;
  modal = { type: 'question', question: existing ? { ...existing } : { ...migrateQuestion({ title: '' }), id: null } };
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
  captureQuestionDraft();
  const editor = modal;
  const request = editor.imageRequest = (editor.imageRequest || 0) + 1;
  editor.imageLoading = true;
  render();
  try {
    const image = await compressQuestionImage(file);
    if (modal !== editor || request !== editor.imageRequest) return;
    captureQuestionDraft();
    editor.question.image = image;
    editor.question.imageAlt ||= file.name.replace(/\.[^.]+$/, '');
    toast('사진을 추가했습니다. 문제 저장을 눌러 완료해주세요.');
  } catch {
    if (modal === editor && request === editor.imageRequest) {
      captureQuestionDraft();
      toast('사진을 처리하지 못했습니다. 12MB 이하의 JPG·PNG·WebP를 사용해주세요.');
    }
  } finally {
    if (modal === editor && request === editor.imageRequest) {
      editor.imageLoading = false;
      render();
    }
  }
}

function saveQuestion() {
  if (!modal?.question || modal.imageLoading) return;
  if (!modal.question.id && state.questions.length >= 500) return toast('문제는 최대 500개까지 저장할 수 있습니다.');
  captureQuestionDraft();
  const draft = modal.question;
  const errors = validateQuestion(draft);
  if (errors.length) return toast(errors[0].message);
  const now = new Date().toISOString();
  const data = migrateQuestion({ ...draft, id: draft.id || createId(), createdAt: draft.createdAt || now, updatedAt: now }, state.questions.length);
  const index = state.questions.findIndex(question => question.id === data.id);
  const previous = structuredClone(state);
  if (index >= 0) state.questions[index] = data;
  else state.questions.push(data);
  if (totalImageDataLength(state.questions) > MAX_TOTAL_IMAGE_DATA_LENGTH) {
    state = previous;
    return toast('전체 사진 용량이 너무 큽니다. 사진을 줄인 뒤 다시 저장해주세요.');
  }
  if (currentQuestion()?.id === data.id && !state.timer.running) state.timer.remaining = data.timeLimit;
  if (!saveState()) { state = previous; return; }
  modal = null;
  render();
  toast(hasProjectionOverflow(data) ? '저장했습니다. 긴 내용은 프로젝터에서 축약됩니다.' : data.usageStatus === 'active' && data.reviewStatus !== 'final' ? '저장했습니다. 사용 전 최종 검수를 완료해주세요.' : '문제를 저장했습니다.');
}

function deleteQuestion(id) {
  const index = state.questions.findIndex(question => question.id === id);
  if (index < 0 || !confirm(`'${state.questions[index].title}' 문제를 삭제할까요?`)) return;
  const currentId = currentQuestion()?.id;
  update(next => {
    next.questions.splice(index, 1);
    next.questions.forEach((question, position) => { question.order = position + 1; });
    next.currentIndex = currentId === id ? Math.min(index, Math.max(0, next.questions.length - 1)) : Math.max(0, next.questions.findIndex(question => question.id === currentId));
    if (currentId === id) activateCurrentItem(next);
  });
}

function saveSettings() {
  const rulesText = document.getElementById('message-rules').value.trim();
  const previousEvent = { ...state.event };
  const previousMessages = { ...state.messages };
  const previousScreens = structuredClone(state.customScreens);
  state.event.title = safeText(document.getElementById('event-title').value.trim(), 100);
  state.event.date = safeText(document.getElementById('event-date').value.trim(), 100);
  state.event.place = safeText(document.getElementById('event-place').value.trim(), 100);
  state.messages.tagline = safeText(document.getElementById('message-tagline').value.trim(), 100);
  state.messages.lobby = safeText(document.getElementById('message-lobby').value.trim(), 100);
  state.messages.opening = safeText(document.getElementById('message-opening').value.trim(), 100);
  state.messages.rules = safeText(rulesText, 2000);
  state.messages.break = safeText(document.getElementById('message-break').value.trim(), 100);
  state.messages.ending = safeText(document.getElementById('message-ending').value.trim(), 100);
  for (const [key, id] of Object.entries(legacyScreenIds)) {
    const screen = state.customScreens.find(item => item.id === id);
    if (screen) screen[id === 'rules' ? 'description' : 'title'] = state.messages[key];
  }
  if (!saveState()) {
    state.event = previousEvent;
    state.messages = previousMessages;
    state.customScreens = previousScreens;
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
  const backup = persistenceBlocked ? localStorage.getItem(PRIVATE_STORAGE_KEY) : JSON.stringify(state, null, 2);
  const blob = new Blob([backup], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  const suffix = label ? `-${label}` : '';
  anchor.download = `sigma-goldenbell${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
}

function exportData() {
  downloadBackup();
  toast('백업 다운로드를 요청했습니다. 다운로드 폴더에서 파일을 확인해주세요.');
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
  const token = ++backupReadToken;
  reader.onload = () => {
    if (token !== backupReadToken || !state || !isUnlocked()) return;
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.questions)) throw new Error('invalid-backup');
      if (!confirm('현재 문제·슬라이드 설정을 백업 파일로 교체할까요? 기존 상태는 자동 백업됩니다.')) return;
      downloadBackup('before-import');
      const imported = normalizeState(parsed);
      if (totalImageDataLength(imported.questions) > MAX_TOTAL_IMAGE_DATA_LENGTH) {
        throw new Error('image-storage-limit');
      }
      try { localStorage.setItem(PRE_IMPORT_BACKUP_KEY, persistenceBlocked ? localStorage.getItem(PRIVATE_STORAGE_KEY) : JSON.stringify(state)); } catch {}
      const previous = state;
      const wasBlocked = persistenceBlocked;
      persistenceBlocked = false;
      state = imported;
      state.timer.running = false;
      state.timer.endAt = null;
      state.answerVisible = false;
      state.runtime.returns.forEach(position => { position.answerVisible = false; });
      if (!saveState()) {
        state = previous;
        persistenceBlocked = wasBlocked;
        throw new Error('storage-limit');
      }
      clearPreparationDrafts();
      render();
      syncTicker();
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
  if (event.isComposing || event.keyCode === 229) return;
  if (IS_SCREEN) {
    if (event.key.toLowerCase() === 'f') document.documentElement.requestFullscreen?.();
    return;
  }
  if (!state || state.tab !== 'live' || modal || event.repeat) return;
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === 'Space') {
    event.preventDefault();
    state.timer.running ? pauseTimer() : startTimer();
  }
  if (event.key.toLowerCase() === 'a') toggleAnswer();
  if (event.key.toLowerCase() === 'r') resetTimer();
  if (event.key === 'ArrowLeft') { event.preventDefault(); goRuntimePosition(runtimePosition(state) - 1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); advancePresentation(); }
});

window.addEventListener('keydown', event => {
  if (!event.isComposing && event.keyCode !== 229 && event.key === 'Escape' && modal) {
    modal = null;
    render();
  }
});

window.addEventListener('beforeunload', event => {
  if (IS_SCREEN || !state || (!state.timer.running && !modal?.question && !modal?.screen && !importDraft?.busy)) return;
  event.preventDefault();
  event.returnValue = '';
});

document.addEventListener('fullscreenchange', () => {
  document.documentElement.classList.toggle('is-fullscreen', Boolean(document.fullscreenElement));
});

if (IS_SCREEN) {
  publicState = loadPublicState();
  renderScreen();
  syncTicker();
  // A newly opened projector may have missed the last broadcast or read an older cache.
  if (SCREEN_SESSION_ID) {
    try { channel?.postMessage({ type: 'request-public-state', sessionId: SCREEN_SESSION_ID }); } catch {}
  }
} else if (isUnlocked()) {
  state = loadPrivateState();
  saveState({ broadcast: false });
  render();
  syncTicker();
} else {
  renderAuth();
}

// Warm all local math fonts while connected, including glyphs not used yet.
document.fonts?.forEach(font => {
  if (font.family.startsWith('KaTeX_')) font.load().catch(() => {});
});

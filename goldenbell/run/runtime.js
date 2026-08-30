// Pure runtime helpers. The base sequence is never modified by live interventions.
function defaultRuntime() {
  return { insertions: [], currentInsertionId: null, overlay: null, returns: [], invalidQuestions: [], reserveUses: [], logs: [], startedAt: null };
}

function validClockTime(value) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || ''); }
function validEventDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeRuntime(candidate, sequenceLength) {
  const raw = candidate && typeof candidate === 'object' ? candidate : {};
  const base = defaultRuntime();
  for (const field of ['insertions', 'returns', 'invalidQuestions', 'reserveUses', 'logs']) {
    if (raw[field] !== undefined && !Array.isArray(raw[field])) throw new Error('invalid-runtime');
  }
  if (raw.insertions?.length > 500 || raw.returns?.length > 20 || raw.logs?.length > 2000 || raw.reserveUses?.length > 2000 || raw.invalidQuestions?.length > 500) throw new Error('runtime-limit');
  const text = (value, limit = 200) => typeof value === 'string' ? value.slice(0, limit) : '';
  const item = value => value?.type === 'screen' && typeof value.screenId === 'string' ? { type: 'screen', screenId: value.screenId } : value?.type === 'question' && typeof value.questionId === 'string' ? { type: 'question', questionId: value.questionId } : null;
  base.insertions = (raw.insertions || []).map(row => {
    if (!row || typeof row.id !== 'string' || typeof row.questionId !== 'string' || !Number.isInteger(row.afterIndex) || row.afterIndex < -1 || row.afterIndex >= sequenceLength) throw new Error('invalid-runtime-insertion');
    return { id: row.id, questionId: row.questionId, afterIndex: row.afterIndex };
  });
  if (new Set(base.insertions.map(row => row.id)).size !== base.insertions.length) throw new Error('duplicate-runtime-id');
  base.currentInsertionId = base.insertions.some(row => row.id === raw.currentInsertionId) ? raw.currentInsertionId : null;
  base.overlay = item(raw.overlay);
  base.returns = (raw.returns || []).map(row => ({ kind: row.kind === 'jump' ? 'jump' : 'override', sequenceIndex: Number.isInteger(row.sequenceIndex) ? row.sequenceIndex : 0, currentInsertionId: typeof row.currentInsertionId === 'string' ? row.currentInsertionId : null, overlay: item(row.overlay), remaining: Math.min(600, Math.max(0, Number(row.remaining) || 0)), answerVisible: Boolean(row.answerVisible) }));
  base.invalidQuestions = (raw.invalidQuestions || []).filter(row => typeof row?.questionId === 'string').map(row => ({ questionId: row.questionId, at: text(row.at) }));
  base.reserveUses = (raw.reserveUses || []).filter(row => typeof row?.questionId === 'string').map(row => ({ questionId: row.questionId, mode: row.mode === 'insert' ? 'insert' : 'immediate', at: text(row.at) }));
  base.logs = (raw.logs || []).filter(row => row && typeof row.type === 'string').map(row => ({ at: text(row.at), type: text(row.type), label: text(row.label, 500) }));
  base.startedAt = typeof raw.startedAt === 'string' && Number.isFinite(Date.parse(raw.startedAt)) ? raw.startedAt : null;
  return base;
}

function effectiveSequence(source) {
  const items = [];
  const addInsertions = afterIndex => (source.runtime?.insertions || []).filter(row => row.afterIndex === afterIndex).forEach(row => items.push({ type: 'question', questionId: row.questionId, insertionId: row.id, baseIndex: afterIndex }));
  addInsertions(-1);
  source.sequence.forEach((item, baseIndex) => { items.push({ ...item, baseIndex }); addInsertions(baseIndex); });
  return items;
}

function runtimePosition(source) {
  return effectiveSequence(source).findIndex(item => source.runtime?.currentInsertionId ? item.insertionId === source.runtime.currentInsertionId : !item.insertionId && item.baseIndex === source.sequenceIndex);
}

function activeItem(source) {
  if (!source) return null;
  if (source.runtime?.overlay) return source.runtime.overlay;
  if (source.runtime?.currentInsertionId) {
    const row = source.runtime.insertions.find(item => item.id === source.runtime.currentInsertionId);
    return row ? { type: 'question', questionId: row.questionId } : null;
  }
  return source.sequence[source.sequenceIndex] || null;
}

function runtimeLog(source, type, label) {
  source.runtime.logs.push({ at: new Date().toISOString(), type, label: String(label).slice(0, 500) });
  if (source.runtime.logs.length > 2000) source.runtime.logs.shift();
}

function roundProgress(source) {
  const rows = {};
  const position = runtimePosition(source);
  effectiveSequence(source).forEach((item, index) => {
    if (item.type !== 'question') return;
    const question = source.questions.find(q => q.id === item.questionId);
    if (!question?.round) return;
    const row = rows[question.round] ||= { passed: 0, total: 0 };
    row.total++;
    if (index < position) row.passed++;
  });
  return rows;
}

function eventClock(source, now = Date.now()) {
  const settings = source.runSettings;
  const scheduledStart = new Date(`${settings.eventDate}T${settings.startTime}:00`).getTime();
  let finish = new Date(`${settings.eventDate}T${settings.endTime}:00`).getTime();
  if (finish <= scheduledStart) finish += 86400000;
  const start = source.runtime.startedAt ? Date.parse(source.runtime.startedAt) : scheduledStart;
  return { elapsed: Math.max(0, Math.floor((now - start) / 1000)), remaining: Math.floor((finish - now) / 1000) };
}

export { defaultRuntime, validClockTime, validEventDate, normalizeRuntime, effectiveSequence, runtimePosition, activeItem, runtimeLog, roundProgress, eventClock };

function parseCSV(text) {
  const rows = [];
  let row = [], value = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else value += ch;
    } else if (ch === '"') {
      if (value || closed) throw new Error(`CSV ${rows.length + 1}행: 따옴표 위치가 잘못되었습니다.`);
      quoted = true;
    } else if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(value); value = ''; closed = false;
      if (ch !== ',') { rows.push(row); row = []; if (ch === '\r' && text[i + 1] === '\n') i++; }
    } else {
      if (closed) throw new Error(`CSV ${rows.length + 1}행: 닫는 따옴표 뒤에 문자가 있습니다.`);
      value += ch;
    }
  }
  if (quoted) throw new Error('CSV: 닫히지 않은 따옴표가 있습니다.');
  if (value || row.length || closed) { row.push(value); rows.push(row); }
  const headers = rows.shift()?.map(value => value.trim());
  if (!headers?.length || headers.some(value => !value) || new Set(headers).size !== headers.length) throw new Error('CSV 헤더가 비어 있거나 중복되었습니다.');
  return rows.filter(row => row.some(value => value !== '')).map((row, index) => {
    if (row.length !== headers.length) throw new Error(`CSV ${index + 2}행: 컬럼 수가 헤더와 다릅니다.`);
    return Object.fromEntries(headers.map((header, col) => [header, header === 'round' && row[col] === '' ? null : row[col]]));
  });
}
function parseQuestionImport(text, format = 'json') {
  if (typeof text !== 'string' || text.length > 10 * 1024 * 1024) throw new Error('10MB 이하 파일만 가져올 수 있습니다.');
  let rows;
  if (format === 'csv') rows = parseCSV(text);
  else { const parsed = JSON.parse(text.replace(/^\uFEFF/, '')); rows = Array.isArray(parsed) ? parsed : parsed?.questions; }
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new Error('문제 배열은 1~500개여야 합니다.');
  return rows;
}
function prepareQuestionImport(rows, existing, mode, options) {
  const errors = [], prepared = [], ids = new Set();
  const { enums, migrate, validTime, safeImage } = options;
  const add = (row, message) => errors.push({ row, message });
  if (!['append', 'update', 'replace'].includes(mode)) return { errors: [{ row: 0, message: '가져오기 방식 오류' }], questions: [] };
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) return { errors: [{ row: 0, message: '문제는 1~500개여야 합니다.' }], questions: [] };
  const limits = { id: 200, title: 100, question: 2000, answer: 500, explanation: 1500, acceptedAnswers: 2000, judgeNote: 2000, author: 100, note: 2000, imageAlt: 160 };
  if (mode === 'update') {
    const existingIds = new Set();
    for (const q of existing) { if (existingIds.has(q.id)) add(0, `기존 문제의 중복 ID를 먼저 해결해주세요: ${q.id}`); existingIds.add(q.id); }
  }
  rows.forEach((raw, index) => {
    const row = index + 1;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { add(row, '문제 객체가 아닙니다.'); return; }
    const item = { ...raw };
    if (item.id !== undefined) {
      if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > limits.id) add(row, 'ID는 1~200자의 문자열이어야 합니다.');
      else { if (ids.has(item.id)) add(row, `파일 내 중복 ID: ${item.id}`); ids.add(item.id); }
    } else if (mode === 'update') add(row, 'ID 업데이트에는 ID가 필요합니다.');
    const prior = existing.find(question => question.id === item.id);
    if (mode === 'append' && prior) add(row, `이미 존재하는 ID: ${item.id}`);
    for (const [field, values] of Object.entries(enums)) if (Object.hasOwn(item, field) && !values.includes(item[field])) add(row, `${field}: 허용되지 않은 값`);
    if (Object.hasOwn(item, 'timeLimit') && !validTime(item.timeLimit)) add(row, 'timeLimit: 1~600초 정수 필요');
    if (!Object.hasOwn(item, 'timeLimit') && Object.hasOwn(item, 'seconds')) {
      if (!validTime(item.seconds)) add(row, 'seconds: 1~600초 정수 필요');
      else item.timeLimit = Number(item.seconds);
    }
    for (const [field, limit] of Object.entries(limits)) if (Object.hasOwn(item, field) && (typeof item[field] !== 'string' || item[field].length > limit)) add(row, `${field}: 문자열 ${limit}자 이하 필요`);
    if (Object.hasOwn(item, 'image') && (typeof item.image !== 'string' || (item.image && !safeImage(item.image)))) add(row, 'image: 지원되는 로컬 base64 사진이 아니거나 용량 초과');
    const merged = { ...(mode === 'update' && prior ? prior : {}), ...item };
    for (const field of ['question', 'answer']) if (typeof merged[field] !== 'string' || !merged[field].trim()) add(row, `${field}: 내용이 없습니다.`);
    if (merged.id === undefined && options.newIds?.[index]) merged.id = options.newIds[index];
    const normalized = migrate(merged, (mode === 'replace' ? 0 : existing.length) + index);
    if (mode === 'update' && prior) { normalized.order = prior.order; normalized.createdAt = prior.createdAt; }
    normalized.updatedAt = new Date().toISOString();
    prepared.push(normalized);
  });
  let questions;
  if (mode === 'replace') questions = prepared.map((q, index) => ({ ...q, order: index + 1 }));
  else if (mode === 'append') questions = [...existing, ...prepared.map((q, index) => ({ ...q, order: existing.length + index + 1 }))];
  else {
    const replacements = new Map(prepared.map(q => [q.id, q]));
    questions = existing.map(q => replacements.get(q.id) || q);
    const oldIds = new Set(existing.map(q => q.id));
    for (const q of prepared) if (!oldIds.has(q.id)) questions.push({ ...q, order: questions.length + 1 });
  }
  if (questions.length > 500) add(0, '적용 후 전체 문제가 500개를 초과합니다.');
  return { errors, questions, prepared };
}
function checkPreparation(source, options) {
  const issues = [], badIds = new Set(), sequenceCounts = new Map();
  const add = (severity, code, label, id) => { issues.push({ severity, code, label, id }); if (severity === 'error' && id) badIds.add(id); };
  const masterIds = new Set();
  for (const q of source.questions) { if (masterIds.has(q.id)) add('error', 'duplicate-id', `문제 목록의 중복 ID: ${q.id}`, q.id); masterIds.add(q.id); }
  for (const item of source.sequence) {
    if (item.type === 'question') {
      sequenceCounts.set(item.questionId, (sequenceCounts.get(item.questionId) || 0) + 1);
      if (!source.questions.some(q => q.id === item.questionId)) add('error', 'missing-question', `구성에 존재하지 않는 문제: ${item.questionId}`);
    } else if (!source.customScreens.some(s => s.id === item.screenId)) add('error', 'missing-screen', `구성에 존재하지 않는 화면: ${item.screenId}`);
  }
  for (const q of source.questions) {
    const label = `${q.id} · ${q.title || '문제'}`;
    if (!q.question.trim()) add('error', 'empty-question', `${label}: 문제 내용 없음`, q.id);
    if (!q.answer.trim()) add('error', 'empty-answer', `${label}: 정답 없음`, q.id);
    if (!options.validTime(q.timeLimit)) add('error', 'invalid-time', `${label}: 제한시간 오류`, q.id);
    if (q.usageStatus === 'active' && q.reviewStatus !== 'final') add('warning', 'unfinal', `${label}: 최종 검수 미완료`, q.id);
    if (q.usageStatus === 'active' && !sequenceCounts.has(q.id)) add('warning', 'unsequenced', `${label}: 행사 구성에 없는 사용 문제`, q.id);
    if (sequenceCounts.get(q.id) > 1) add('warning', 'duplicate', `${label}: 행사 구성에 ${sequenceCounts.get(q.id)}번 등장`, q.id);
    if ((q.image && !options.safeImage(q.image)) || (q.imageId && !q.image)) add('error', 'image', `${label}: 이미지 참조 오류`, q.id);
    for (const field of ['question', 'answer', 'explanation']) if (options.math(q[field]).errors.length) add('error', 'math', `${label}: ${field} 수식 오류`, q.id);
  }
  for (const round of ['revival1', 'revival2', 'final']) if (!source.questions.some(q => q.round === round && q.usageStatus === 'active' && sequenceCounts.has(q.id))) add('warning', 'empty-round', `${round}: 구성에 사용 문제가 없습니다.`);
  return { issues, normal: source.questions.filter(q => !badIds.has(q.id)).length, reserve: source.questions.filter(q => q.usageStatus === 'reserve').length };
}
export { parseCSV, parseQuestionImport, prepareQuestionImport, checkPreparation };

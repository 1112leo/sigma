// Only our escaped text and KaTeX's untrusted-mode output become HTML.
const mathEscape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const mathPlain = value => mathEscape(value).replace(/\n/g, '<br>');
function mathParts(value) {
  const text = String(value ?? '');
  const parts = [];
  const escaped = index => { let count = 0; while (index > 0 && text[--index] === '\\') count++; return count % 2 === 1; };
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '$' || escaped(index)) continue;
    if (index > start) parts.push({ raw: text.slice(start, index) });
    const delimiter = text[index + 1] === '$' ? '$$' : '$';
    let end = index + delimiter.length;
    for (; end < text.length; end++) {
      if (!escaped(end) && text.slice(end, end + delimiter.length) === delimiter) break;
    }
    if (end >= text.length) { parts.push({ raw: text.slice(index), error: '수식의 닫는 $ 구분자가 없습니다.' }); return parts; }
    parts.push({ raw: text.slice(index, end + delimiter.length), tex: text.slice(index + delimiter.length, end), display: delimiter === '$$' });
    index = end + delimiter.length - 1;
    start = index + 1;
  }
  if (start < text.length) parts.push({ raw: text.slice(start) });
  return parts;
}
function renderMath(value) {
  const errors = [];
  const html = mathParts(value).map(part => {
    let error = part.error;
    if (part.tex !== undefined && !error) {
      try {
        if (!part.tex.trim()) throw new Error('empty math');
        return globalThis.katex.renderToString(part.tex, {
          displayMode: part.display, throwOnError: true, trust: () => { throw new Error('unsupported trusted command'); },
          strict: 'error', maxSize: 10, maxExpand: 1000, macros: {},
        });
      } catch { error = '수식을 확인해주세요.'; }
    }
    if (error) { errors.push(error); return `<span class="math-fallback">${mathPlain(part.raw)}<small class="math-warning" title="${mathEscape(error)}">수식 오류</small></span>`; }
    return mathPlain(part.raw.replace(/\\\$/g, '$'));
  }).join('');
  return { html, errors };
}
function richText(value) { return renderMath(value).html; }

// Keep complete expressions when shortening a projector caption.
function mathProjection(value, limit) {
  const text = String(value ?? '');
  if (text.length <= limit) return text;
  let result = '';
  for (const part of mathParts(text)) {
    if (result.length + part.raw.length <= limit) { result += part.raw; continue; }
    if (part.tex !== undefined || part.error) result += part.raw;
    else result += part.raw.slice(0, Math.max(0, limit - result.length - 1));
    return result + (result.length < text.length ? '…' : '');
  }
  return result;
}
export { mathParts, renderMath, richText, mathProjection };

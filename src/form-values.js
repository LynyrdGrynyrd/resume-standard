const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dateAtom(value) {
  const text = value.trim();
  if (!text) return { format: '', value: '' };
  if (/^\d{4}$/.test(text) && Number(text) > 0) return { format: 'year', value: text };
  let match = text.match(/^(\d{4})-(\d{2})$/);
  let year = match?.[1], month = match?.[2];
  if (!match) {
    match = text.match(/^(\d{1,2})\/(\d{4})$/);
    if (match) { month = match[1]; year = match[2]; }
  }
  if (!match) {
    match = text.match(/^([a-z]+)\s+(\d{4})$/i);
    if (match) {
      const index = MONTHS.findIndex(name => [name.toLowerCase(), name.slice(0, 3).toLowerCase()].includes(match[1].toLowerCase()));
      if (index < 0) return null;
      month = String(index + 1); year = match[2];
    }
  }
  if (!match || Number(year) < 1 || Number(month) < 1 || Number(month) > 12) return null;
  return { format: 'month', value: `${year}-${month.padStart(2, '0')}` };
}

export function parseDates(value, { range = true } = {}) {
  const result = { format: 'month', start: '', end: '', current: false, expected: false, raw: value };
  const raw = value.trim();
  if (!raw) return result;
  let text = raw;
  if (!range && /^Expected\s+/i.test(text)) { result.expected = true; text = text.replace(/^Expected\s+/i, ''); }
  let first = text, last = '';
  if (range) {
    const until = text.match(/^Until\s+(.+)$/i);
    const pair = text.match(/^(.*?)\s*[–—]\s*(.*?)$/) || text.match(/^(.*?)\s+-\s+(.*?)$/) || text.match(/^(\d{4})-(\d{4}|Present)$/i);
    if (until) { first = ''; last = until[1]; }
    else if (pair) { first = pair[1]; last = pair[2]; }
    else if (/^Present$/i.test(text)) { first = ''; result.current = true; }
    if (/^Present$/i.test(last)) { last = ''; result.current = true; }
  }
  const start = dateAtom(first), end = dateAtom(last);
  if (!start || !end || (start.format && end.format && start.format !== end.format)) return { ...result, format: 'custom' };
  return { ...result, format: start.format || end.format || 'month', start: start.value, end: end.value };
}

function displayDate(value, format) {
  if (!value) return '';
  const parsed = dateAtom(value);
  if (!parsed || parsed.format !== format) throw new RangeError('Enter a valid year or month and year.');
  if (format === 'year') return parsed.value;
  return `${MONTHS[Number(parsed.value.slice(5)) - 1].slice(0, 3)} ${parsed.value.slice(0, 4)}`;
}

export function formatDates(parts, { range = true } = {}) {
  if (parts.format === 'custom') return parts.raw;
  const start = displayDate(parts.start, parts.format);
  if (!range) return start ? `${parts.expected ? 'Expected ' : ''}${start}` : '';
  const end = parts.current ? 'Present' : displayDate(parts.end, parts.format);
  if (!start) return parts.current ? 'Present' : end ? `Until ${end}` : '';
  return end ? `${start} – ${end}` : start;
}

export function dateError(value, { range = true } = {}) {
  const parsed = parseDates(value, { range });
  if (!range || parsed.format === 'custom' || parsed.current || !parsed.start || !parsed.end) return '';
  const numeric = date => Number(date.replace('-', ''));
  return numeric(parsed.start) > numeric(parsed.end) ? 'End date must be on or after the start date.' : '';
}

export const DEGREE_TYPES = ['B.A.', 'B.S.', 'B.Eng.', 'B.F.A.', 'M.A.', 'M.S.', 'MBA', 'Ph.D.', 'J.D.', 'M.D.', 'A.A.', 'A.S.', 'Certificate', 'High school diploma'];

export function parseDegree(value) {
  const text = value.trim();
  if (!text) return { type: '', subject: '' };
  for (const type of DEGREE_TYPES) {
    if (text === type) return { type, subject: '' };
    if (text.startsWith(`${type} in `) && text.slice(type.length + 4).trim()) return { type, subject: text.slice(type.length + 4) };
  }
  return { type: 'custom', subject: value };
}

export function formatDegree(type, subject) {
  if (type === 'custom') return subject;
  if (!type) return subject.trim();
  if (!DEGREE_TYPES.includes(type)) throw new RangeError('Choose a qualification or use custom text.');
  return subject.trim() ? `${type} in ${subject.trim()}` : type;
}

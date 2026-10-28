import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDates, formatDates, dateError, parseDegree, formatDegree, DEGREE_TYPES } from '../src/form-values.js';

test('existing date strings retain their exact original value until a user changes controls', () => {
  for (const value of ['5/2024 – Present', '2021–2024', ' May 2024 — present ', 'Spring 2020 to Summer 2022', '2020 – Jun 2022', 'Early career', 'Expected Fall 2027']) {
    const parsed = parseDates(value);
    assert.equal(parsed.raw, value);
    if (parsed.format === 'custom') assert.equal(formatDates(parsed), value);
  }
  assert.equal(parseDates('2020 – Jun 2022').format, 'custom');
  assert.equal(parseDates('13/2024').format, 'custom');
  assert.equal(parseDates('0000').format, 'custom');
});

test('guided dates format recognized months and years without inventing month precision', () => {
  for (const value of ['5/2024 – Present', '2024-05 — present', 'May 2024 - Present']) {
    const parsed = parseDates(value);
    assert.equal(parsed.format, 'month'); assert.equal(parsed.start, '2024-05'); assert.equal(parsed.current, true);
    assert.equal(formatDates(parsed), 'May 2024 – Present');
  }
  assert.equal(formatDates(parseDates('September 2020 – June 2024')), 'Sep 2020 – Jun 2024');
  assert.equal(formatDates(parseDates('2020-2024')), '2020 – 2024');
  assert.equal(parseDates('2020 – Present').start, '2020');
  assert.equal(parseDates('2020 – Present').format, 'year');
});

test('empty, partial, current and expected dates have stable representations', () => {
  assert.equal(parseDates('').format, 'month');
  assert.equal(formatDates(parseDates('')), '');
  assert.equal(formatDates(parseDates('May 2024')), 'May 2024');
  assert.equal(formatDates(parseDates('Until May 2024')), 'Until May 2024');
  assert.equal(formatDates(parseDates('Present')), 'Present');
  assert.equal(formatDates(parseDates('2020 –')), '2020');
  const expected = parseDates('Expected June 2027', { range: false });
  assert.equal(expected.expected, true); assert.equal(expected.start, '2027-06');
  assert.equal(formatDates(expected, { range: false }), 'Expected Jun 2027');
  assert.equal(formatDates(parseDates('Expected 2027', { range: false }), { range: false }), 'Expected 2027');
  assert.equal(formatDates({ format: 'month', start: '', expected: true }, { range: false }), '');
});

test('only known reversed complete ranges produce errors; invalid picker values cannot create a date', () => {
  assert.ok(dateError('Jun 2024 – May 2024'));
  assert.ok(dateError('2024 – 2020'));
  for (const value of ['2020 – 2024', 'May 2024 – May 2024', 'Until May 2024', '2020', '2024 – Present', '2024 – early 2020', '2024 – May 2020']) assert.equal(dateError(value), '');
  assert.equal(dateError('2024 – 2020', { range: false }), '');
  for (const start of ['2024-00', '2024-13', '20', '0000-05']) assert.throws(() => formatDates({ format: 'month', start, end: '' }), RangeError);
  assert.throws(() => formatDates({ format: 'year', start: '2024-05', end: '' }), RangeError);
});

test('degree controls preserve custom qualifications and safely separate known degrees from subjects', () => {
  assert.deepEqual(parseDegree('B.S. in Business Administration'), { type: 'B.S.', subject: 'Business Administration' });
  assert.deepEqual(parseDegree(' B.S. in Business Administration '), { type: 'B.S.', subject: 'Business Administration' });
  assert.equal(formatDegree('Ph.D.', ' Polymer Science '), 'Ph.D. in Polymer Science');
  for (const type of DEGREE_TYPES) assert.deepEqual(parseDegree(type), { type, subject: '' });
  for (const value of ['B.Sc. (Hons), Chemistry', 'Ph.D. Chemistry', ' MSc – Applied Statistics ', 'B.S. in ']) {
    const parsed = parseDegree(value);
    assert.equal(parsed.type, 'custom'); assert.equal(formatDegree(parsed.type, parsed.subject), value);
  }
  assert.deepEqual(parseDegree(''), { type: '', subject: '' });
  assert.equal(formatDegree('MBA', ''), 'MBA');
  assert.equal(formatDegree('', ''), '');
  assert.throws(() => formatDegree('Made up option', ''), RangeError);
});

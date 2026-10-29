import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyResume, exampleResume, readDraft, hasContent, filename, MAX_RESUME_FILE_BYTES, serializeResumeFile, parseResumeFile } from '../src/state.js';
import { unsupportedCharacters } from '../src/font-check.js';
import * as state from '../src/state.js';

const legacyDraft = () => ({
  name: ' Renée García ', phone: '', email: 'renee@example.com', location: 'Example City', website: '',
  summary: 'First paragraph.\r\nSecond with e\u0301.',
  experience: [{ company: ' Example Institute ', dates: ' Fall 2021 – today ', roles: [{ title: 'Researcher', dates: '', description: '', bullets: '  First.\r\n\r\n• Second.  ' }] }],
  education: [{ school: 'Example University', date: 'Expected Spring 2028', degree: 'Custom MSc', details: 'Thesis: exact wording\n' }],
  publications: 'García, R. A study. 2025.\n', skills: 'Python',
});

test('legacy drafts and version 1 backups migrate without changing any original strings', () => {
  const legacy = legacyDraft();
  const raw = JSON.stringify(legacy);
  const migrated = readDraft(raw);
  assert.equal(migrated.mode, 'resume');
  assert.deepEqual(migrated.cv, state.emptyCv());
  const { mode, cv, ...original } = migrated;
  assert.deepEqual(original, legacy);
  assert.equal(JSON.stringify(legacy), raw);
  assert.deepEqual(parseResumeFile(JSON.stringify({ format: 'classic-resume', version: 1, data: legacy })), migrated);
  assert.throws(() => serializeResumeFile(legacy), /invalid or unsupported/);
  assert.throws(() => parseResumeFile(JSON.stringify({ format: 'classic-resume', version: 2, data: legacy })));
});

test('academic CV fields, mode and fictional example survive saving and mode changes', () => {
  const blank = emptyResume();
  assert.equal(blank.mode, 'resume');
  blank.mode = 'cv';
  assert.equal(hasContent(blank), false);
  assert.deepEqual(Object.keys(blank.cv), ['researchInterests', 'research', 'teaching', 'grants', 'patents', 'presentations', 'honors', 'service', 'affiliations', 'references']);
  const data = state.exampleCv();
  assert.equal(data.mode, 'cv');
  for (const { key } of state.CV_SECTIONS) assert.ok(data.cv[key].trim(), `Fictional CV needs ${key}`);
  data.cv.research = '  First study.\r\n\nSecond study: e\u0301 and 李.  ';
  data.cv.references = 'Example Person\nexample@example.com';
  for (const mode of ['cv', 'resume', 'cv']) {
    data.mode = mode;
    assert.deepEqual(readDraft(JSON.stringify(data)), data);
    assert.deepEqual(parseResumeFile(serializeResumeFile(data)), data);
  }
  assert.equal(hasContent({ ...emptyResume(), cv: { ...state.emptyCv(), references: 'Example Person' } }), true);
  assert.equal(filename('Renée <García>/..', 'pdf', 'cv'), 'Renée García - CV.pdf');
  assert.equal(filename('', 'docx', 'cv'), 'CV - CV.docx');
  const another = emptyResume(); blank.cv.research = 'One draft only';
  assert.equal(another.cv.research, '');
});

test('current files reject incomplete or mixed schemas, unknown academic fields and mode/version mismatches', () => {
  for (const mutate of [
    data => { delete data.mode; }, data => { delete data.cv; }, data => { data.mode = 'academic'; },
    data => { data.mode = 2; }, data => { data.cv = null; }, data => { data.cv = []; },
    data => { delete data.cv.research; }, data => { data.cv.research = ['A study']; },
    data => { data.cv.grants = 'x'.repeat(30001); }, data => { data.cv.extra = 'unknown'; },
  ]) {
    const data = emptyResume(); mutate(data);
    assert.throws(() => readDraft(JSON.stringify(data)));
    assert.throws(() => serializeResumeFile(data));
    assert.throws(() => parseResumeFile(JSON.stringify({ format: 'classic-resume', version: 2, data })));
  }
  assert.throws(() => parseResumeFile(JSON.stringify({ format: 'classic-resume', version: 1, data: emptyResume() })));
  const data = emptyResume(); data.cv = Object.assign(Object.create({ inherited: true }), data.cv);
  assert.throws(() => serializeResumeFile(data));
  const raw = serializeResumeFile(emptyResume()).replace('"cv":{', '"cv":{"__proto__":{"polluted":true},');
  assert.throws(() => parseResumeFile(raw));
  assert.equal({}.polluted, undefined);
});

test('drafts round-trip Unicode and manual text; bad or oversized structures fail visibly', () => {
  const data = exampleResume();
  data.name = 'Renée García';
  assert.deepEqual(readDraft(JSON.stringify(data)), data);
  assert.throws(() => readDraft('{broken'));
  for (const broken of [null, {}, { ...data, summary: 123 }, { ...data, experience: [{ roles: [] }] }, { ...data, skills: 'a'.repeat(30001) }]) {
    assert.throws(() => readDraft(JSON.stringify(broken)));
  }
});

test('blank forms do not count as content; nested roles and safe filenames do', () => {
  assert.equal(hasContent(emptyResume()), false);
  const data = emptyResume(); data.experience[0].roles[0].bullets = 'First result';
  assert.equal(hasContent(data), true);
  assert.equal(filename('Renée <García>/..', 'pdf'), 'Renée García - Resume.pdf');
});

test('PDF font coverage accepts accents and flags unsupported glyphs without discarding text', () => {
  assert.deepEqual(unsupportedCharacters('Renée García — Ph.D.\n• Research'), []);
  assert.deepEqual(unsupportedCharacters('李李 🧪'), ['李', '🧪']);
});

test('portable résumé files round-trip exact Unicode, whitespace, multiline bullets and custom dates', () => {
  const data = exampleResume();
  data.name = ' Renée 李 🧪 ';
  data.summary = 'First paragraph.\r\nSecond paragraph with e\u0301.';
  data.experience[0].dates = ' Spring 2021 – today ';
  data.experience[0].roles[0].bullets = '• First result\n\n- Second result\n';
  data.education[0].date = 'Expected Fall 2028';
  data.education[0].degree = ' MSc – Applied Physics ';
  const raw = serializeResumeFile(data);
  const envelope = JSON.parse(raw);
  assert.deepEqual(Object.keys(envelope), ['format', 'version', 'data']);
  assert.equal(envelope.format, 'classic-resume');
  assert.equal(envelope.version, 2);
  assert.deepEqual(parseResumeFile(raw), data);
  assert.deepEqual(readDraft(JSON.stringify(data)), data);
  assert.deepEqual(parseResumeFile(serializeResumeFile(emptyResume())), emptyResume());
  const partial = emptyResume(); partial.experience = []; partial.education = []; partial.skills = 'Python';
  assert.deepEqual(parseResumeFile(serializeResumeFile(partial)), partial);
});

test('portable files reject invalid JSON, unsupported envelopes and versions', () => {
  for (const raw of [null, 3, '{broken', 'null', '[]', JSON.stringify(exampleResume())]) {
    assert.throws(() => parseResumeFile(raw));
  }
  const file = JSON.parse(serializeResumeFile(emptyResume()));
  for (const changed of [
    { ...file, format: 'other-app' }, { ...file, version: 99 }, { ...file, version: '2' },
    { ...file, extra: [] }, { format: file.format, data: file.data },
    { ...file, data: null },
  ]) assert.throws(() => parseResumeFile(JSON.stringify(changed)));
});

test('unknown fields, malformed nested structures and invalid field sizes fail without mutating the draft', () => {
  const mutations = [
    data => { data.extra = { nested: [null] }; },
    data => { data.experience[0].extra = []; },
    data => { data.experience[0].roles[0].extra = []; },
    data => { data.education[0].extra = []; },
    data => { data.experience[0].roles = [null]; },
    data => { data.experience = new Array(1); },
    data => { data.experience[0].roles = new Array(1); },
    data => { data.education = new Array(1); },
    data => { data.experience[0].roles[0].bullets = ['not a string']; },
    data => { data.education[0].date = 2025; },
    data => { delete data.phone; },
    data => { data.name = 'x'.repeat(30001); },
    data => { data.experience = Array.from({ length: 51 }, () => emptyResume().experience[0]); },
    data => { data.experience[0].roles = Array.from({ length: 21 }, () => emptyResume().experience[0].roles[0]); },
    data => { data.education = Array.from({ length: 31 }, () => emptyResume().education[0]); },
  ];
  for (const mutate of mutations) {
    const data = emptyResume(); mutate(data);
    const before = JSON.stringify(data);
    assert.throws(() => readDraft(before));
    assert.throws(() => serializeResumeFile(data));
    assert.throws(() => parseResumeFile(JSON.stringify({ format: 'classic-resume', version: 2, data })));
    assert.equal(JSON.stringify(data), before);
  }
  const raw = serializeResumeFile(emptyResume()).replace('"data":{', '"data":{"__proto__":{"polluted":true},');
  assert.throws(() => parseResumeFile(raw));
  assert.equal({}.polluted, undefined);
});

test('portable file size limit is symmetric and counts UTF-8 bytes instead of characters', () => {
  assert.equal(MAX_RESUME_FILE_BYTES, 5 * 1024 * 1024);
  assert.throws(() => parseResumeFile(' '.repeat(MAX_RESUME_FILE_BYTES + 1)), /5 MiB/);
  const data = emptyResume();
  data.experience = Array.from({ length: 5 }, () => ({
    company: '', dates: '', roles: Array.from({ length: 20 }, () => ({ title: '', dates: '', description: '', bullets: 'é'.repeat(30000) })),
  }));
  const raw = JSON.stringify({ format: 'classic-resume', version: 2, data });
  assert.ok(raw.length < MAX_RESUME_FILE_BYTES);
  assert.ok(new TextEncoder().encode(raw).length > MAX_RESUME_FILE_BYTES);
  assert.throws(() => serializeResumeFile(data), /5 MiB/);
  assert.throws(() => parseResumeFile(raw), /5 MiB/);
  assert.deepEqual(readDraft(JSON.stringify(data)), data);
});

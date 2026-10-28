import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyResume, exampleResume, readDraft, hasContent, filename, MAX_RESUME_FILE_BYTES, serializeResumeFile, parseResumeFile } from '../src/state.js';
import { unsupportedCharacters } from '../src/font-check.js';

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
  assert.equal(envelope.version, 1);
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
    { ...file, format: 'other-app' }, { ...file, version: 2 }, { ...file, version: '1' },
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
    assert.throws(() => parseResumeFile(JSON.stringify({ format: 'classic-resume', version: 1, data })));
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
  const raw = JSON.stringify({ format: 'classic-resume', version: 1, data });
  assert.ok(raw.length < MAX_RESUME_FILE_BYTES);
  assert.ok(new TextEncoder().encode(raw).length > MAX_RESUME_FILE_BYTES);
  assert.throws(() => serializeResumeFile(data), /5 MiB/);
  assert.throws(() => parseResumeFile(raw), /5 MiB/);
  assert.deepEqual(readDraft(JSON.stringify(data)), data);
});

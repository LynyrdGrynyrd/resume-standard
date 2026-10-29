import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { emptyResume, exampleResume, serializeResumeFile, parseResumeFile, MAX_RESUME_FILE_BYTES } from '../../src/state.js';

const file = raw => ({ name: 'my-resume.resume.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
const savedDraft = page => page.evaluate(() => JSON.parse(localStorage.getItem('classic-resume-v1')));

test('portable file downloads and confirmed imports retain exact text while all requests stay local', async ({ page }, testInfo) => {
  const external = [], errors = [];
  page.on('request', request => {
    if (!/^(http:\/\/127\.0\.0\.1:4178(?:\/|$)|blob:|data:)/.test(request.url())) external.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  const data = exampleResume();
  data.name = 'Renée García';
  data.summary = 'Measured improvements.\nMentored colleagues.';
  data.experience[0].dates = 'Spring 2021 – today';
  data.experience[0].roles[0].bullets = 'First result — café.\n\nSecond result with e\u0301.\n';
  data.education[0].date = 'Expected Fall 2028';
  await page.goto('/');
  await page.locator('#resume-file').setInputFiles(file(serializeResumeFile(data)));
  await expect(page.locator('#file-status')).toContainText('Résumé file opened');
  await expect(page.getByLabel('Full name & credentials')).toHaveValue(data.name);
  await expect(page.getByLabel('Summary of qualifications')).toHaveValue(data.summary);
  expect(await savedDraft(page)).toEqual(data);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save résumé file', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.resume\.json$/);
  const path = testInfo.outputPath('saved.resume.json'); await download.saveAs(path);
  const raw = await readFile(path, 'utf8');
  expect(parseResumeFile(raw)).toEqual(data);
  await page.getByLabel('Full name & credentials').fill('Temporary edit');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#resume-file').setInputFiles(file(raw));
  await expect(page.getByLabel('Full name & credentials')).toHaveValue(data.name);
  expect(await savedDraft(page)).toEqual(data);
  await page.reload();
  await expect(page.getByLabel('Full name & credentials')).toHaveValue(data.name);
  expect(await savedDraft(page)).toEqual(data);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('invalid, unsupported and oversized files cannot replace the current résumé or its saved draft', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Keep My Work');
  await page.getByLabel('Summary of qualifications').fill('This draft must survive every rejected file.');
  const before = await savedDraft(page);
  const envelope = JSON.parse(serializeResumeFile(exampleResume()));
  let dialogs = 0;
  page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
  for (const [raw, message] of [
    ['{broken', 'not valid JSON'],
    [JSON.stringify({ ...envelope, version: 999 }), 'version is not supported'],
    [JSON.stringify({ ...envelope, data: { ...envelope.data, surprise: { nested: ['unknown'] } } }), 'invalid or unsupported fields'],
    [JSON.stringify({ ...envelope, data: { ...envelope.data, mode: 'academic' } }), 'invalid or unsupported fields'],
    [JSON.stringify({ ...envelope, data: { ...envelope.data, cv: { ...envelope.data.cv, teaching: ['wrong type'] } } }), 'invalid or unsupported fields'],
    [JSON.stringify({ ...envelope, data: { ...envelope.data, cv: { ...envelope.data.cv, unknown: 'Not a supported section' } } }), 'invalid or unsupported fields'],
    [' '.repeat(MAX_RESUME_FILE_BYTES + 1), 'too large'],
  ]) {
    await page.locator('#resume-file').setInputFiles(file(raw));
    await expect(page.locator('#file-status')).toContainText(message);
    await expect(page.getByLabel('Full name & credentials')).toHaveValue('Keep My Work');
    expect(await savedDraft(page)).toEqual(before);
  }
  expect(dialogs).toBe(0);
});

test('cancelled replacement keeps work and opening with browser saving off stays private to the tab', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Keep This Draft');
  const before = await savedDraft(page);
  const imported = exampleResume(); imported.name = 'Opened Without Saving';
  const raw = serializeResumeFile(imported);
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#resume-file').setInputFiles(file(raw));
  await expect(page.locator('#file-status')).toContainText('File not opened');
  await expect(page.getByLabel('Full name & credentials')).toHaveValue('Keep This Draft');
  expect(await savedDraft(page)).toEqual(before);
  await page.getByLabel('Save my draft in this browser').uncheck();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#resume-file').setInputFiles(file(raw));
  await expect(page.locator('#file-status')).toContainText('Résumé file opened');
  await expect(page.getByLabel('Full name & credentials')).toHaveValue(imported.name);
  await expect(page.getByLabel('Save my draft in this browser')).not.toBeChecked();
  expect(await savedDraft(page)).toBeNull();
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(true);
});

test('Markdown and plain text download the visible content and Copy as text uses the same plain text', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedResumeText = text; } } });
  });
  const data = emptyResume();
  data.name = 'Renée García'; data.email = 'renee@example.com';
  data.summary = 'Research with clear results.';
  data.experience[0] = { company: 'Example Materials', dates: '2020 – Present', roles: [{ title: 'Research Director', dates: '', description: '', bullets: 'Improved throughput by 20%.\nMentored five scientists.' }] };
  await page.goto('/');
  await page.locator('#resume-file').setInputFiles(file(serializeResumeFile(data)));
  await expect(page.getByLabel('Full name & credentials')).toHaveValue(data.name);
  const outputs = {};
  for (const [id, extension] of [['download-markdown', 'md'], ['download-text', 'txt']]) {
    const downloading = page.waitForEvent('download'); await page.locator(`#${id}`).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    const path = testInfo.outputPath(`resume.${extension}`); await download.saveAs(path);
    outputs[extension] = await readFile(path, 'utf8');
    for (const text of [data.name, data.email, data.summary, 'Example Materials', '2020 – Present', 'Research Director', 'Improved throughput by 20%.', 'Mentored five scientists.']) {
      expect(outputs[extension]).toContain(text);
    }
    expect(outputs[extension]).not.toContain('Academic Credentials');
  }
  expect(outputs.md).toMatch(/^# Renée García$/m);
  expect(outputs.md).toMatch(/^## Professional Experience$/m);
  expect(outputs.md).toMatch(/^- Mentored five scientists\.$/m);
  await page.getByRole('button', { name: 'Copy as text', exact: true }).click();
  await expect(page.locator('#text-export-status')).toContainText('Résumé text copied');
  expect(await page.evaluate(() => window.copiedResumeText)).toBe(outputs.txt);
  await expect(page.locator('#copy-fallback')).toBeHidden();
});

test('denied clipboard access offers the full selected plain text instead of losing the copy action', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } });
  });
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Manual Copy');
  await page.getByLabel('Summary of qualifications').fill('Every word should remain available.');
  await page.getByRole('button', { name: 'Copy as text', exact: true }).click();
  await expect(page.locator('#text-export-status')).toContainText('Clipboard access is unavailable');
  const fallback = page.getByLabel('Document text to copy');
  await expect(fallback).toBeVisible(); await expect(fallback).toBeFocused();
  const text = await fallback.inputValue();
  expect(text).toContain('Manual Copy'); expect(text).toContain('Every word should remain available.');
  expect(await fallback.evaluate(input => [input.selectionStart, input.selectionEnd])).toEqual([0, text.length]);
});

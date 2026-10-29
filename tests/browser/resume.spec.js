import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { emptyResume } from '../../src/state.js';

async function pdfText(path) {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: false }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items.filter(item => item.str.trim())) {
      expect(item.transform[4]).toBeGreaterThanOrEqual(50);
      expect(item.transform[4] + item.width).toBeLessThanOrEqual(563);
      expect(item.transform[5]).toBeGreaterThanOrEqual(30);
      expect(item.transform[5]).toBeLessThanOrEqual(756);
    }
    pages.push(content.items.map(item => item.str).join(' '));
  }
  await pdf.loadingTask.destroy();
  return pages;
}

test('manual form preserves content in preview, PDF, DOCX, and reload; all requests stay local', async ({ page }, testInfo) => {
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!/^(http:\/\/127\.0\.0\.1:4178|blob:|data:)/.test(request.url())) external.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('#preview canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  await page.getByLabel('Full name & credentials').fill('Renée García, Ph.D.');
  await page.getByLabel('Email', { exact: true }).fill('renee@example.com');
  await page.getByLabel('Summary of qualifications').fill('Research & development <polymer> — clear results.');
  await page.getByRole('button', { name: '02 Experience' }).click();
  await page.getByLabel('Employer', { exact: true }).fill('Acme Materials');
  const employmentDates = page.getByRole('group', { name: 'Employment dates', exact: true });
  await employmentDates.getByLabel('Date format').selectOption('year');
  await employmentDates.getByLabel('Start date').selectOption('2020');
  await employmentDates.getByLabel('I currently work here').check();
  await page.getByLabel('Job title', { exact: true }).fill('Research Director');
  await page.getByLabel('Accomplishment 1', { exact: true }).fill('Improved throughput by 20%.\nMentored five scientists.');
  await page.getByRole('button', { name: 'Add another role here' }).click();
  await expect(page.getByLabel('Job title', { exact: true }).nth(1)).toBeFocused();
  await page.getByLabel('Job title', { exact: true }).nth(1).fill('Scientist');
  await page.getByLabel('Accomplishment 1', { exact: true }).nth(1).fill('Developed a new polymer.');
  await page.getByRole('button', { name: '03 Education' }).click();
  await page.getByLabel('School or institution').fill('Example University');
  await page.getByLabel('Degree type').selectOption('Ph.D.');
  await page.getByLabel('Field of study (optional)').fill('Chemistry');
  await page.getByRole('button', { name: '04 More' }).click();
  await page.getByLabel('Publications and patents').fill('García, R. Polymer Research. 2025.');
  await page.getByLabel('Technical expertise').fill('Synthesis\nStatistical analysis');
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  await expect(page.locator('#preview-text')).toContainText('Mentored five scientists.');
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const pdf = await pdfDownload;
  const pdfPath = testInfo.outputPath('resume.pdf'); await pdf.saveAs(pdfPath);
  const content = (await pdfText(pdfPath)).join(' ');
  for (const text of ['Research & development <polymer>', 'Improved throughput by 20%.', 'Mentored five scientists.', 'Developed a new polymer.', 'Ph.D. in Chemistry', 'Statistical analysis']) expect(content).toContain(text);
  const wordDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Word', exact: false }).click();
  const word = await wordDownload;
  const wordPath = testInfo.outputPath('resume.docx'); await word.saveAs(wordPath);
  const xml = strFromU8(unzipSync(new Uint8Array(await readFile(wordPath)))['word/document.xml']);
  expect(xml).toContain('Renée García, Ph.D.');
  expect(xml).toContain('Research &amp; development &lt;polymer&gt;');
  await page.reload();
  await expect(page.getByLabel('Full name & credentials')).toHaveValue('Renée García, Ph.D.');
  await expect(page.locator('#preview canvas')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('long content paginates without dropping entries; narrow viewport stays usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Jamie Taylor');
  await page.getByRole('button', { name: '02 Experience' }).click();
  await page.getByLabel('Employer', { exact: true }).fill('Long Career Company');
  await page.getByLabel('Job title', { exact: true }).fill('Director');
  const bullets = Array.from({ length: 70 }, (_, i) => `Achievement ${String(i + 1).padStart(3, '0')}: improved project delivery by partnering with customers and developing practical operating procedures.`);
  await page.getByLabel('Accomplishment 1', { exact: true }).fill(bullets.join('\n'));
  await expect(page.locator('.accomplishment-row')).toHaveCount(70);
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const path = testInfo.outputPath('long.pdf'); await (await event).saveAs(path);
  const pages = await pdfText(path); expect(pages.length).toBeGreaterThan(1);
  const text = pages.join(' ');
  for (let i = 1; i <= 70; i++) expect(text).toContain(`Achievement ${String(i).padStart(3, '0')}:`);
  expect(text.match(/Achievement \d{3}:/g)).toHaveLength(70);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Next preview page' }).click();
  await expect(page.locator('#page-count')).toContainText('Page 2');
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('example replacement and deletion require confirmation; opting out removes the stored draft', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.getByLabel('Full name & credentials')).toHaveValue('Alex Morgan');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Clear draft', exact: true }).click();
  await expect(page.getByLabel('Full name & credentials')).toHaveValue('Alex Morgan');
  await page.getByLabel('Save my draft in this browser').uncheck();
  expect(await page.evaluate(() => localStorage.getItem('classic-resume-v1'))).toBeNull();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Clear draft', exact: true }).click();
  await expect(page.getByLabel('Full name & credentials')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('classic-resume-v1'))).toBeNull();
});

test('malformed local draft is preserved, and user text cannot execute HTML', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('classic-resume-v1', '{broken draft'));
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('has not been overwritten');
  await page.getByLabel('Full name & credentials').fill('Test User');
  await page.getByLabel('Summary of qualifications').fill('<img src=x onerror=alert(1)>');
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('classic-resume-v1'))).toBe('{broken draft');
  expect(await page.locator('#preview-text img').count()).toBe(0);
});

test('rapid edits export the latest revision and a single long paragraph is not clipped', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Latest Revision');
  await page.getByLabel('Summary of qualifications').fill('Obsolete draft');
  const long = Array.from({ length: 180 }, (_, i) => `Sentence ${String(i + 1).padStart(3, '0')} describes a contribution to a complex project and its successful delivery.`).join(' ');
  await page.getByLabel('Summary of qualifications').fill(long);
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const path = testInfo.outputPath('long-paragraph.pdf'); await (await event).saveAs(path);
  const pages = await pdfText(path);
  expect(pages.length).toBeGreaterThan(1);
  const text = pages.join(' ');
  expect(text).not.toContain('Obsolete draft');
  expect(text.match(/Sentence \d{3}/g)).toHaveLength(180);
  expect(text).toContain('Sentence 180');
});

test('a storage write failure warns before the user leaves', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Unsaved Work');
  await expect(page.locator('#save-status')).toContainText('Could not save');
  // Dispatch the cancellable event directly so the check does not discard test data.
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
});

test('deployed content security policy permits preview and downloads', async ({ page }) => {
  const config = await readFile('public/_headers', 'utf8');
  const policy = config.match(/Content-Security-Policy: ([^\r\n]+)/)[1];
  await page.route('http://127.0.0.1:4178/', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.locator('#preview canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Word', exact: false }).click();
  expect((await event).suggestedFilename()).toMatch(/\.docx$/);
});

test('unsupported PDF glyphs are reported instead of silently disappearing', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('李 Taylor');
  await expect(page.locator('#export-status')).toContainText('cannot display: 李');
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Word', exact: false })).toBeEnabled();
  await page.getByLabel('Full name & credentials').fill('Jamie Taylor');
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
});

test('multiline summary and role overview spanning pages do not trap their headings', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Long Overview');
  await page.getByLabel('Summary of qualifications').fill(Array.from({ length: 80 }, (_, i) => `Summary line ${String(i + 1).padStart(3, '0')}.`).join('\n'));
  await page.getByRole('button', { name: '02 Experience' }).click();
  await page.getByLabel('Employer', { exact: true }).fill('Example Company');
  await page.getByLabel('Job title', { exact: true }).fill('Director');
  await page.getByLabel('Role overview (optional)').fill(Array.from({ length: 80 }, (_, i) => `Overview line ${String(i + 1).padStart(3, '0')}.`).join('\n'));
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const path = testInfo.outputPath('multiline.pdf'); await (await event).saveAs(path);
  const text = (await pdfText(path)).join(' ');
  expect(text.match(/Summary line \d{3}/g)).toHaveLength(80);
  expect(text.match(/Overview line \d{3}/g)).toHaveLength(80);
});

test('two tabs preserve divergent drafts and require confirmation before replacing stored work', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('First Tab');
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByLabel('Full name & credentials')).toHaveValue('First Tab');
  await second.getByLabel('Full name & credentials').fill('Second Tab');
  await expect(page.locator('#save-status')).toContainText('another tab');
  await expect(page.getByLabel('Save my draft in this browser')).not.toBeChecked();
  await page.getByLabel('Summary of qualifications').fill('Unsaved first-tab work');
  expect(await second.evaluate(() => JSON.parse(localStorage.getItem('classic-resume-v1')).name)).toBe('Second Tab');
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByLabel('Save my draft in this browser').click();
  await expect(page.getByLabel('Save my draft in this browser')).not.toBeChecked();
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Save my draft in this browser').check();
  expect(await second.evaluate(() => JSON.parse(localStorage.getItem('classic-resume-v1')).summary)).toBe('Unsaved first-tab work');
  await expect(second.locator('#save-status')).toContainText('another tab');
});

test('oversized pastes are refused explicitly without inserting a truncated tail', async ({ page }) => {
  await page.goto('/');
  const name = page.getByLabel('Full name & credentials');
  await name.fill('Existing Name');
  const cancelled = await name.evaluate(input => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'x'.repeat(501));
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    input.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(cancelled).toBe(true);
  await expect(name).toHaveValue('Existing Name');
  await expect(page.getByRole('alert')).toContainText('Nothing was pasted');
});

test('re-enabling saving after opting out cannot silently replace another tab', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Unsaved First Tab');
  await page.getByLabel('Save my draft in this browser').uncheck();
  const second = await context.newPage(); await second.goto('/');
  await second.getByLabel('Full name & credentials').fill('Stored Second Tab');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByLabel('Save my draft in this browser').click();
  await expect(page.getByLabel('Save my draft in this browser')).not.toBeChecked();
  expect(await second.evaluate(() => JSON.parse(localStorage.getItem('classic-resume-v1')).name)).toBe('Stored Second Tab');
});

test('date pickers, current-role checkboxes and degree dropdowns reach both downloads and survive reload', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Taylor Nguyen');
  await page.getByRole('button', { name: '02 Experience' }).click();
  await page.getByLabel('Employer', { exact: true }).fill('Example Company');
  const employment = page.getByRole('group', { name: 'Employment dates', exact: true });
  await employment.getByLabel('Start date').fill('2021-05');
  await employment.getByLabel('Start date').press('Tab');
  await employment.getByLabel('End date').fill('2024-04');
  await employment.getByLabel('End date').press('Tab');
  await employment.getByLabel('I currently work here').check();
  await expect(employment.getByLabel('End date')).toBeDisabled();
  await expect(employment.getByLabel('I currently work here')).toBeFocused();
  await employment.getByLabel('I currently work here').uncheck();
  await expect(employment.getByLabel('End date')).toHaveValue('2024-04');
  await employment.getByLabel('I currently work here').check();
  await page.getByLabel('Job title', { exact: true }).fill('Director');
  await page.locator('summary').filter({ hasText: 'Role dates (optional)' }).click();
  const role = page.getByRole('group', { name: 'Role dates', exact: true });
  await role.getByLabel('Date format').selectOption('year');
  await role.getByLabel('Start date').selectOption('2023');
  await role.getByLabel('I currently hold this role').check();
  await page.getByRole('button', { name: '03 Education' }).click();
  await page.getByLabel('School or institution').fill('Example University');
  await page.getByLabel('Degree type').selectOption('Ph.D.');
  await page.getByLabel('Field of study (optional)').fill('Polymer Science');
  const graduation = page.getByRole('group', { name: 'Graduation', exact: true });
  await graduation.getByLabel('Expected graduation').check();
  await graduation.getByLabel('Graduation date').fill('2027-06');
  await graduation.getByLabel('Graduation date').press('Tab');
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  const pdfEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const pdfPath = testInfo.outputPath('guided.pdf'); await (await pdfEvent).saveAs(pdfPath);
  const text = (await pdfText(pdfPath)).join(' ');
  const expected = ['May 2021 – Present', '2023 – Present', 'Expected Jun 2027', 'Ph.D. in Polymer Science'];
  for (const value of expected) expect(text).toContain(value);
  const wordEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Word', exact: false }).click();
  const wordPath = testInfo.outputPath('guided.docx'); await (await wordEvent).saveAs(wordPath);
  const xml = strFromU8(unzipSync(new Uint8Array(await readFile(wordPath)))['word/document.xml']);
  for (const value of expected) expect(xml).toContain(value);
  await page.reload();
  await page.getByRole('button', { name: '02 Experience' }).click();
  await page.locator('.employer-summary').click();
  await page.locator('.role-summary').click();
  await expect(employment.getByLabel('Start date')).toHaveValue('2021-05');
  await expect(employment.getByLabel('I currently work here')).toBeChecked();
  await expect(role.getByLabel('Date format')).toHaveValue('year');
  await page.screenshot({ path: testInfo.outputPath('experience-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '03 Education' }).click();
  await page.locator('.education-summary').click();
  await expect(page.getByLabel('Degree type')).toHaveValue('Ph.D.');
  await expect(graduation.getByLabel('Expected graduation')).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('education-mobile.png'), fullPage: true });
});

test('reversed picked dates block both exports across tabs until corrected', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Date Validation');
  await page.getByRole('button', { name: '02 Experience' }).click();
  const employment = page.getByRole('group', { name: 'Employment dates', exact: true });
  await employment.getByLabel('Start date').fill('2024-05');
  await employment.getByLabel('Start date').press('Tab');
  await employment.getByLabel('End date').fill('2023-01');
  await employment.getByLabel('End date').press('Tab');
  await expect(employment.getByRole('alert')).toContainText('End date must be on or after');
  await expect(page.getByRole('button', { name: 'Word', exact: false })).toBeDisabled();
  await page.getByRole('button', { name: '03 Education' }).click();
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  await expect(page.locator('#export-status')).toContainText('End date must be on or after');
  await page.getByRole('button', { name: '02 Experience' }).click();
  await employment.getByLabel('End date').fill('2025-01');
  await employment.getByLabel('End date').press('Tab');
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
});

test('legacy drafts and custom wording are not rewritten by visiting the guided controls', async ({ page }) => {
  const draft = emptyResume(); draft.name = 'Legacy Draft';
  draft.experience[0].dates = ' 5/2024 – Present ';
  draft.experience[0].roles[0].dates = 'Spring 2020 to Summer 2022';
  draft.education[0].date = 'Expected Fall 2027';
  draft.education[0].degree = ' MSc – Applied Physics ';
  await page.addInitScript(value => localStorage.setItem('classic-resume-v1', value), JSON.stringify(draft));
  await page.goto('/');
  await page.getByRole('button', { name: '02 Experience' }).click();
  await page.locator('.employer-summary').click();
  await page.locator('.role-summary').click();
  const employment = page.getByRole('group', { name: 'Employment dates', exact: true });
  await expect(employment.getByLabel('Start date')).toHaveValue('2024-05');
  const role = page.getByRole('group', { name: 'Role dates', exact: true });
  await expect(role.getByLabel('Dates as written')).toHaveValue('Spring 2020 to Summer 2022');
  page.once('dialog', dialog => dialog.dismiss());
  await role.getByLabel('Date format').selectOption('month');
  await expect(role.getByLabel('Date format')).toHaveValue('custom');
  await page.getByRole('button', { name: '03 Education' }).click();
  await page.locator('.education-summary').click();
  await expect(page.getByLabel('Degree type')).toHaveValue('custom');
  await expect(page.getByLabel('Degree or qualification')).toHaveValue(draft.education[0].degree);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByLabel('Degree type').selectOption('MBA');
  await expect(page.getByLabel('Degree type')).toHaveValue('custom');
  await page.getByRole('button', { name: '01 Basics' }).click();
  await page.getByLabel('Email', { exact: true }).fill('new@example.com');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('classic-resume-v1')));
  expect(saved.experience).toEqual(draft.experience);
  expect(saved.education).toEqual(draft.education);
});

test('keyboard date-format changes ask before removing months and cancellation preserves dates', async ({ page }) => {
  const draft = emptyResume(); draft.name = 'Date Precision';
  draft.experience[0].dates = 'May 2019 – Jun 2021';
  await page.addInitScript(value => localStorage.setItem('classic-resume-v1', value), JSON.stringify(draft));
  await page.goto('/');
  await page.getByRole('button', { name: '02 Experience' }).click();
  await page.locator('.employer-summary').click();
  const employment = page.getByRole('group', { name: 'Employment dates', exact: true });
  const format = employment.getByLabel('Date format');
  page.once('dialog', dialog => dialog.dismiss());
  await format.focus(); await format.press('ArrowDown');
  await expect(format).toHaveValue('month');
  await expect(format).toBeFocused();
  await expect(employment.getByLabel('Start date')).toHaveValue('2019-05');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('classic-resume-v1')).experience[0].dates)).toBe(draft.experience[0].dates);
  await format.selectOption('custom');
  page.once('dialog', dialog => dialog.dismiss());
  await format.selectOption('year');
  await expect(format).toHaveValue('custom');
  await expect(employment.getByLabel('Dates as written')).toHaveValue(draft.experience[0].dates);
  page.once('dialog', dialog => dialog.accept());
  await format.selectOption('year');
  await expect(employment.getByLabel('Start date')).toHaveValue('2019');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('classic-resume-v1')).experience[0].dates)).toBe('2019 – 2021');
});

test('invalid native month edits restore the displayed saved date with an explicit message', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Month Validation');
  await page.getByRole('button', { name: '02 Experience' }).click();
  const employment = page.getByRole('group', { name: 'Employment dates', exact: true });
  const start = employment.getByLabel('Start date');
  await start.fill('2024-05'); await start.press('Tab');
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  await start.fill('10000-01'); await start.press('Tab');
  await expect(start).toHaveValue('2024-05');
  await expect(employment.getByRole('alert')).toContainText('previous date has been kept');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('classic-resume-v1')).experience[0].dates)).toBe('May 2024');
});

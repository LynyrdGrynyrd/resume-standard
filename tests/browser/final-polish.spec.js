import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import { emptyResume } from '../../src/state.js';

async function download(page, testInfo, selector, name) {
  const event = page.waitForEvent('download');
  await page.locator(selector).click();
  const item = await event;
  expect(await item.failure()).toBeNull();
  const path = testInfo.outputPath(name);
  await item.saveAs(path);
  return readFile(path);
}

async function pdfText(bytes) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  const pages = [];
  for (let index = 1; index <= pdf.numPages; index++) pages.push((await (await pdf.getPage(index)).getTextContent()).items.map(item => item.str).join(' '));
  await pdf.loadingTask.destroy();
  return pages.join(' ');
}

const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('classic-resume-v1')));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

for (const [resource, pattern, failureMode = 'abort'] of [
  ['PDF module', /\/assets\/pdf-[^/]+\.js$/],
  ['bold font', /\/fonts\/EBGaramond-Bold\.ttf$/],
  ['PDF module HTTP 503', /\/assets\/pdf-[^/]+\.js$/, 'http503'],
  ['tagged PDF module HTTP 503', /\/assets\/tagged-pdf-[^/]+\.js$/, 'http503'],
]) {
  test(`failed ${resource} fetch preserves the draft and Word, then Retry recovers the PDF`, async ({ page }, testInfo) => {
    const failures = []; const consoleErrors = [];
    page.on('requestfailed', request => failures.push({ url: request.url(), failure: request.failure()?.errorText }));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    let requests = 0;
    await page.route(pattern, async route => {
      requests++;
      if (requests === 1 && failureMode === 'http503') await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable' });
      else if (requests === 1) await route.abort('failed');
      else await route.continue();
    });
    try {
      await page.goto('/');
      await page.getByLabel('Full name & credentials').fill('Network Retry');
      await page.getByLabel('Summary of qualifications').fill(`Retain this draft after a ${resource} failure.`);
      await expect(page.getByRole('button', { name: 'Retry preview', exact: true })).toBeVisible();
      expect(requests).toBe(1);
      const before = await saved(page);
      expect(before.name).toBe('Network Retry');
      await expect(page.locator('#download-pdf')).toBeDisabled();
      await expect(page.locator('#open-pdf')).toBeDisabled();
      await expect(page.locator('#download-docx')).toBeEnabled();
      const bytes = await download(page, testInfo, '#download-docx', `${resource.replaceAll(' ', '-')}-fallback.docx`);
      const xml = strFromU8(unzipSync(new Uint8Array(bytes))['word/document.xml']);
      expect(xml).toContain(before.name); expect(xml).toContain(before.summary);
      expect(await saved(page)).toEqual(before);
      await page.getByRole('button', { name: 'Retry preview', exact: true }).click();
      await expect(page.locator('#download-pdf'), `Retry must recover after restoring the ${resource} route`).toBeEnabled({ timeout: 10000 });
      await expect(page.locator('#open-pdf')).toBeEnabled();
      if (failureMode === 'http503') expect(requests).toBe(2);
      else expect(requests).toBeGreaterThan(1);
      const text = await pdfText(await download(page, testInfo, '#download-pdf', `${resource.replaceAll(' ', '-')}-recovered.pdf`));
      expect(text).toContain(before.name); expect(text).toContain(before.summary);
      expect(await saved(page)).toEqual(before);
    } finally {
      const receipt = { resource, failureMode, requests, failures, consoleErrors, status: await page.locator('#preview-status').textContent(), pdfDisabled: await page.locator('#download-pdf').isDisabled() };
      console.log('NETWORK_RETRY_RECEIPT', JSON.stringify(receipt));
      await testInfo.attach('network-retry-receipt', {
        body: JSON.stringify(receipt, null, 2),
        contentType: 'application/json',
      });
      await page.screenshot({ path: testInfo.outputPath('network-retry.png'), fullPage: true });
    }
  });
}

test('fresh empty state stays lightweight; content loads the PDF renderer and clear returns to guidance', async ({ page }) => {
  const requests = []; page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.preview-empty')).toBeVisible();
  await expect(page.locator('#preview canvas')).toHaveCount(0);
  await expect(page.locator('#preview')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#download-pdf')).toBeDisabled();
  await expect(page.locator('#open-pdf')).toBeDisabled();
  expect(requests.filter(url => /pdf\.worker|\/(tagged-pdf|pdf)-|pdfjs|EBGaramond-(Bold|Italic)/i.test(url))).toEqual([]);
  await page.getByLabel('Full name & credentials').fill('Lazy Preview');
  await expect(page.locator('#preview canvas')).toBeVisible();
  await expect(page.locator('#download-pdf')).toBeEnabled();
  await expect(page.locator('#open-pdf')).toBeEnabled();
  expect(requests.some(url => /pdf\.worker/.test(url))).toBe(true);
  expect(requests.some(url => /EBGaramond-Bold\.ttf/.test(url))).toBe(true);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#clear').click();
  await expect(page.locator('.preview-empty')).toBeVisible();
  await expect(page.locator('#preview canvas')).toHaveCount(0);
  await expect(page.locator('#open-pdf')).toBeDisabled();
  await expect(page.locator('#preview')).toHaveAttribute('aria-busy', 'false');
});

test('clearing while PDF fonts are pending cannot restore an obsolete preview or full-size action', async ({ page }, testInfo) => {
  let release;
  let started;
  const fontStarted = new Promise(resolve => { started = resolve; });
  const fontGate = new Promise(resolve => { release = resolve; });
  await page.route('**/fonts/EBGaramond-Bold.ttf', async route => { started(); await fontGate; await route.continue(); });
  try {
    await page.goto('/');
    await page.getByLabel('Full name & credentials').fill('Obsolete Revision');
    await fontStarted;
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#clear').click();
    release();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.preview-empty')).toBeVisible();
    await expect(page.locator('#preview canvas')).toHaveCount(0);
    await expect(page.locator('#open-pdf')).toBeDisabled();
    await expect(page.locator('#download-pdf')).toBeDisabled();
    await page.getByLabel('Full name & credentials').fill('Current Revision');
    await expect(page.locator('#open-pdf')).toBeEnabled();
    const text = await pdfText(await download(page, testInfo, '#download-pdf', 'current-revision.pdf'));
    expect(text).toContain('Current Revision');
    expect(text).not.toContain('Obsolete Revision');
  } finally { release(); }
});

test('full-size opens the exact current PDF bytes in a new tab and invalidates after edits', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL);
    window.testPdfBlobs = new Map();
    URL.createObjectURL = blob => { const url = original(blob); window.testPdfBlobs.set(url, blob); return url; };
  });
  await page.goto('/');
  await expect(page.locator('#open-pdf')).toHaveText('Open full-size PDF');
  await expect(page.locator('#open-pdf')).toBeDisabled();
  await page.getByLabel('Full name & credentials').fill('Full Size Reader');
  await page.getByLabel('Summary of qualifications').fill('Original preview wording.');
  await expect(page.locator('#open-pdf')).toBeEnabled();
  let previousUrl;
  for (const [revision, wording] of [['first', 'Original preview wording.'], ['second', 'Updated preview wording.']]) {
    if (revision === 'second') {
      await page.getByLabel('Summary of qualifications').fill(wording);
      await expect(page.locator('#open-pdf')).toBeDisabled();
      await expect(page.locator('#open-pdf')).toBeEnabled();
    }
    const popupEvent = page.waitForEvent('popup');
    await page.locator('#open-pdf').click();
    const popup = await popupEvent;
    await popup.waitForURL(/^blob:/);
    const url = popup.url();
    expect(url).not.toBe(previousUrl);
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    const bytes = Buffer.from(await page.evaluate(async blobUrl => Array.from(new Uint8Array(await window.testPdfBlobs.get(blobUrl).arrayBuffer())), url));
    const downloaded = await download(page, testInfo, '#download-pdf', `${revision}.pdf`);
    expect(digest(bytes)).toBe(digest(downloaded));
    const text = await pdfText(bytes);
    expect(text).toContain(wording);
    if (revision === 'second') expect(text).not.toContain('Original preview wording.');
    previousUrl = url;
    await popup.close();
  }
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await page.locator('#open-pdf').boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`full-size-control-${width}.png`), fullPage: true });
  }
  await page.getByLabel('Full name & credentials').fill('');
  await expect(page.locator('#open-pdf')).toBeDisabled();
  await expect(page.locator('#download-pdf')).toBeDisabled();
});

test('blocked full-size popup explains the download fallback and leaves the exact PDF available', async ({ page }, testInfo) => {
  await page.addInitScript(() => { window.open = () => null; });
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Popup Fallback');
  await expect(page.locator('#open-pdf')).toBeEnabled();
  await page.locator('#open-pdf').click();
  await expect(page.locator('#export-status')).toContainText(/blocked|allow/i);
  await expect(page.locator('#export-status')).toContainText('Download PDF');
  await expect(page.locator('#download-pdf')).toBeEnabled();
  expect(await pdfText(await download(page, testInfo, '#download-pdf', 'popup-fallback.pdf'))).toContain('Popup Fallback');
});

test('publications and patents stay separate in editing and CV output while legacy mixed text is unchanged', async ({ page }, testInfo) => {
  const { mode, cv, ...legacy } = emptyResume();
  legacy.name = 'Publication Audit'; legacy.email = 'publication@example.com';
  legacy.publications = '  Legacy paper citation.\nLegacy US patent listing kept with original wording.  ';
  await page.goto('/');
  await page.locator('#resume-file').setInputFiles({ name: 'legacy.resume.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'classic-resume', version: 1, data: legacy })) });
  await expect(page.getByLabel('Full name & credentials')).toHaveValue(legacy.name);
  await page.locator('[data-step="3"]').click();
  await expect(page.getByLabel('Publications')).toHaveValue(legacy.publications);
  await expect(page.getByLabel('Patents')).toHaveValue('');
  const patent = 'Taylor A. New patent EX-2026-123. Granted 2026.';
  await page.getByLabel('Patents').fill(patent);
  const draft = await saved(page);
  expect(draft.publications).toBe(legacy.publications); expect(draft.cv.patents).toBe(patent);
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel('Publications')).toBeVisible();
    await expect(page.getByLabel('Patents')).toBeVisible();
  }
  await expect(page.locator('#download-pdf')).toBeEnabled();
  for (const text of [await pdfText(await download(page, testInfo, '#download-pdf', 'resume-publications.pdf')), (await download(page, testInfo, '#download-text', 'resume-publications.txt')).toString()]) {
    expect(text).toContain('Legacy paper citation.'); expect(text).toContain('Legacy US patent listing kept with original wording.'); expect(text).toContain(patent);
  }
  await page.locator('input[name="document-mode"][value="cv"]').check();
  const publications = page.locator('.academic-section').filter({ has: page.locator('textarea[name="publications"]') });
  const patents = page.locator('.academic-section').filter({ has: page.locator('textarea[name="patents"]') });
  await publications.locator(':scope > summary').click(); await patents.locator(':scope > summary').click();
  await expect(publications.getByLabel('Publications')).toHaveValue(legacy.publications);
  await expect(patents.getByLabel('Patents')).toHaveValue(patent);
  const text = (await download(page, testInfo, '#download-text', 'cv-publications.txt')).toString();
  expect(text).toMatch(/^Publications$/m); expect(text).toMatch(/^Patents$/m);
  expect(text.indexOf('Legacy paper citation.')).toBeLessThan(text.indexOf('\nPatents\n'));
  expect(text.indexOf(patent)).toBeGreaterThan(text.indexOf('\nPatents\n'));
  await page.locator('input[name="document-mode"][value="resume"]').check();
  expect(await saved(page)).toEqual(draft);
  const backup = JSON.parse((await download(page, testInfo, '#save-file', 'publications.resume.json')).toString());
  expect(backup.data.publications).toBe(legacy.publications); expect(backup.data.cv.patents).toBe(patent);
});

test('name and hints expose semantics; date errors identify affected controls and clear after correction', async ({ page }) => {
  await page.goto('/');
  const name = page.getByLabel('Full name & credentials');
  await expect(name).toHaveAttribute('required', '');
  await expect(name).toHaveAccessibleDescription(/download/i);
  const summary = page.getByLabel('Summary of qualifications');
  await expect(summary).toHaveAccessibleDescription(/Optional/);
  await name.fill('Accessible Dates');
  await page.locator('[data-step="1"]').click();
  const group = page.getByRole('group', { name: 'Employment dates', exact: true });
  const start = group.getByLabel('Start date'); const end = group.getByLabel('End date');
  await start.fill('2025-05'); await start.press('Tab');
  await end.fill('2024-02'); await end.press('Tab');
  const alert = group.getByRole('alert');
  await expect(alert).toContainText('End date must be on or after');
  const errorId = await alert.getAttribute('id'); expect(errorId).toBeTruthy();
  for (const control of [start, end]) {
    await expect(control).toHaveAttribute('aria-invalid', 'true');
    expect((await control.getAttribute('aria-describedby')).split(/\s+/)).toContain(errorId);
    await expect(control).toHaveAccessibleDescription(/End date must be on or after/);
  }
  await expect(page.locator('#open-pdf')).toBeDisabled();
  await page.locator('[data-step="3"]').click();
  await page.locator('#download-check > summary').click();
  await page.getByRole('button', { name: /Employer 1: End date must be on or after/ }).click();
  await expect(start).toBeFocused();
  await end.fill('2026-02'); await end.press('Tab');
  for (const control of [start, end]) await expect(control).toHaveAttribute('aria-invalid', 'false');
  await end.fill('2024-02'); await end.press('Tab');
  await group.getByLabel('I currently work here').check();
  for (const control of [start, end]) await expect(control).toHaveAttribute('aria-invalid', 'false');
  await group.getByLabel('I currently work here').uncheck();
  await expect(end).toHaveAttribute('aria-invalid', 'true');
  await group.getByLabel('Date format').selectOption('custom');
  const custom = group.getByLabel('Dates as written');
  await expect(custom).toHaveAttribute('aria-invalid', 'true');
  await expect(custom).toHaveAccessibleDescription(/End date must be on or after/);
  await custom.fill('2024 – 2026');
  await expect(custom).toHaveAttribute('aria-invalid', 'false');
  await expect(custom).not.toHaveAccessibleDescription(/End date must be on or after/);
  page.once('dialog', dialog => dialog.accept());
  await group.getByLabel('Date format').selectOption('month');
  for (const control of [group.getByLabel('Start date'), group.getByLabel('End date')]) await expect(control).toHaveAttribute('aria-invalid', 'false');
  const roleDetails = page.locator('.role-details').first();
  if (!(await roleDetails.evaluate(node => node.open))) await roleDetails.locator(':scope > summary').click();
  await roleDetails.locator('.optional-dates > summary').click();
  const roleDates = roleDetails.getByRole('group', { name: 'Role dates', exact: true });
  await roleDates.getByLabel('Start date').fill('2025-05'); await roleDates.getByLabel('Start date').press('Tab');
  await roleDates.getByLabel('End date').fill('2024-02'); await roleDates.getByLabel('End date').press('Tab');
  await page.locator('[data-step="2"]').click();
  await page.getByRole('button', { name: /Employer 1, role 1: End date must be on or after/ }).click();
  await expect(roleDates.getByLabel('Start date')).toBeFocused();
  await expect(roleDates.getByLabel('Start date')).toHaveAttribute('aria-invalid', 'true');
});

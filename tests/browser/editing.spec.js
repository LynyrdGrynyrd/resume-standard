import { test, expect } from '@playwright/test';
import { emptyResume } from '../../src/state.js';

test('accomplishments paste into separate fields, reorder and remove without losing the draft', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Taylor');
  await page.getByRole('button', { name: '02 Experience' }).click();
  await page.getByLabel('Employer', { exact: true }).fill('Example Company');
  await page.getByLabel('Job title', { exact: true }).fill('Director');
  await page.getByLabel('Accomplishment 1', { exact: true }).evaluate(input => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'First result.\nSecond result.\nThird result.');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(page.getByLabel('Accomplishment 3', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Accomplishment 2', { exact: true })).toHaveValue('Second result.');
  await page.getByRole('button', { name: 'Move accomplishment 3 up', exact: true }).click();
  await expect(page.getByLabel('Accomplishment 2', { exact: true })).toHaveValue('Third result.');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Remove accomplishment 1', exact: true }).click();
  await expect(page.getByLabel('Accomplishment 1', { exact: true })).toHaveValue('First result.');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Remove accomplishment 1', exact: true }).click();
  await expect(page.getByLabel('Accomplishment 1', { exact: true })).toHaveValue('Third result.');
  await page.getByRole('button', { name: 'Add accomplishment' }).click();
  await expect(page.getByLabel('Accomplishment 3', { exact: true })).toBeFocused();
  await page.getByLabel('Accomplishment 3', { exact: true }).fill('New final result.');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('classic-resume-v1')));
  expect(saved.experience[0].roles[0].bullets).toBe('Third result.\nSecond result.\nNew final result.');
  await page.reload(); await page.getByRole('button', { name: '02 Experience' }).click();
  await expect(page.getByLabel('Accomplishment 3', { exact: true })).toHaveValue('New final result.');
});

test('oversized multi-line paste is refused without partial insertion', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '02 Experience' }).click();
  await page.getByLabel('Accomplishment 1', { exact: true }).fill('Kept result.');
  await page.getByLabel('Accomplishment 1', { exact: true }).evaluate(input => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', Array(201).fill('Line').join('\n'));
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(page.getByLabel('Accomplishment 1', { exact: true })).toHaveValue('Kept result.');
  await expect(page.getByRole('alert').filter({ hasText: 'Nothing was added' })).toBeVisible();
  expect(await page.locator('.accomplishment-row').count()).toBe(1);
});

test('employer collapse and checklist links preserve work and focus the missing field', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Taylor');
  await page.getByRole('button', { name: '02 Experience' }).click();
  await page.getByLabel('Accomplishment 1', { exact: true }).fill('Improved delivery.');
  await page.getByRole('button', { name: 'Done editing this employer' }).click();
  await expect(page.locator('.employer-summary')).toBeFocused();
  await expect(page.getByLabel('Employer', { exact: true })).toBeHidden();
  await page.locator('#download-check summary').click();
  await page.getByRole('button', { name: 'Employer 1: add the employer name.', exact: true }).click();
  await expect(page.getByLabel('Employer', { exact: true })).toBeFocused();
  await page.getByLabel('Employer', { exact: true }).fill('Example Company');
  await page.getByRole('button', { name: 'Employer 1, role 1: add the job title.', exact: true }).click();
  await expect(page.getByLabel('Job title', { exact: true })).toBeFocused();
  await page.getByLabel('Job title', { exact: true }).fill('Director');
  await page.getByRole('button', { name: 'Add an email address or phone number', exact: false }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await page.getByLabel('Email', { exact: true }).fill('taylor@example.com');
  await expect(page.locator('#check-count')).toContainText('no missing essentials');
  await page.getByRole('button', { name: '02 Experience' }).click();
  await page.getByRole('button', { name: 'Done editing this employer' }).click();
  await expect(page.locator('.employer-summary')).toContainText('Example Company · Director');
  await page.getByRole('button', { name: '03 Education' }).click();
  await page.getByRole('button', { name: '02 Experience' }).click();
  await expect(page.getByLabel('Employer', { exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('collapsed-mobile.png'), fullPage: true });
});

test('opening legacy bullets does not rewrite their whitespace or line endings', async ({ page }) => {
  const data = emptyResume(); data.name = 'Legacy'; data.experience[0].roles[0].bullets = '  First.\r\n\r\n• Second.  ';
  await page.addInitScript(value => localStorage.setItem('classic-resume-v1', value), JSON.stringify(data));
  await page.goto('/'); await page.getByRole('button', { name: '02 Experience' }).click();
  await expect(page.getByLabel('Accomplishment 1', { exact: true })).toHaveValue('  First.');
  await page.getByLabel('Employer', { exact: true }).fill('Example');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('classic-resume-v1')).experience[0].roles[0].bullets)).toBe(data.experience[0].roles[0].bullets);
});

test('removing the last employer removes its card and allows adding a fresh one', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.getByRole('button', { name: '02 Experience' }).click();
  await page.locator('.employer-body > .entry-actions').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.entry-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add employer', exact: false }).click();
  await expect(page.getByLabel('Employer', { exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test('editing clears old clipboard fallback content', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Denied'); } } }));
  await page.goto('/');
  await page.getByLabel('Full name & credentials').fill('Previous Name');
  await page.getByRole('button', { name: 'Copy as text', exact: true }).click();
  await expect(page.locator('#copy-fallback')).toHaveValue('Previous Name\n');
  await page.getByLabel('Full name & credentials').fill('New Name');
  await expect(page.locator('#copy-fallback-label')).toBeHidden();
  await expect(page.locator('#copy-fallback')).toHaveValue('');
});

test('non-text paste preserves selection and single-line paste keeps native editing and undo', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '02 Experience' }).click();
  const field = page.getByLabel('Accomplishment 1', { exact: true });
  await field.fill('Reduced time');
  const nonText = await field.evaluate(input => {
    input.setSelectionRange(8, 12);
    const clipboardData = new DataTransfer(); clipboardData.setData('text/uri-list', 'file:///example.png');
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return { prevented: event.defaultPrevented, connected: input.isConnected, selection: [input.selectionStart, input.selectionEnd] };
  });
  expect(nonText).toEqual({ prevented: false, connected: true, selection: [8, 12] });
  await expect(field).toHaveValue('Reduced time');
  const singleLine = await field.evaluate(input => {
    input.setSelectionRange(8, 8);
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'lead ');
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return { prevented: event.defaultPrevented, connected: input.isConnected, caret: input.selectionStart };
  });
  expect(singleLine).toEqual({ prevented: false, connected: true, caret: 8 });
  // Synthetic paste has no native default action; exercise that insertion through the browser.
  await page.keyboard.insertText('lead ');
  await expect(field).toHaveValue('Reduced lead time');
  await field.press('Control+z');
  await expect(field).toHaveValue('Reduced time');
});

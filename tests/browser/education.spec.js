import { test, expect } from '@playwright/test';
import { exampleResume, exampleCv, serializeResumeFile } from '../../src/state.js';

const savedDraft = page => page.evaluate(() => JSON.parse(localStorage.getItem('classic-resume-v1')));
const schools = page => page.locator('#editor .education-details');
const summaries = page => page.locator('#editor .education-summary');

async function checkLayout(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const issues = await page.locator('#editor').evaluate(editor => {
    const found = [];
    for (const control of editor.querySelectorAll('input, select, textarea, button:not(:disabled), summary')) {
      const box = control.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const label = control.name || control.getAttribute('aria-label') || control.textContent.trim().slice(0, 45);
      if (control.matches('button, summary') && (box.width < 44 || box.height < 44)) found.push(`${label}: target below 44px`);
      if (control.matches('input:not([type="checkbox"]), select, textarea') && parseFloat(getComputedStyle(control).fontSize) < 16) found.push(`${label}: text below 16px`);
    }
    return found;
  });
  expect(issues).toEqual([]);
}

async function checkLargeText(page, testInfo, screenshot) {
  await page.setViewportSize({ width: 320, height: 900 });
  const stylesheet = await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await checkLayout(page);
  await page.screenshot({ path: testInfo.outputPath(screenshot), fullPage: true });
  await stylesheet.evaluate(node => node.remove());
  await page.setViewportSize({ width: 375, height: 900 });
}

for (const documentMode of ['resume', 'cv']) {
  test(`${documentMode} education is compact and preserves entries through keyboard editing, reorder, remove and reload`, async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.locator(`input[name="document-mode"][value="${documentMode}"]`).check();
    await page.locator('#example').click();
    await page.locator('[data-step="2"]').click();
    const initial = documentMode === 'cv' ? exampleCv() : exampleResume();
    await expect(schools(page)).toHaveCount(initial.education.length);
    await expect(page.locator('.education-details[open]')).toHaveCount(0);
    for (const [index, school] of initial.education.entries()) {
      await expect(summaries(page).nth(index)).toContainText(school.school);
      await expect(summaries(page).nth(index)).toContainText(school.degree);
      await expect(summaries(page).nth(index)).toContainText(school.date);
    }
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await checkLayout(page);
      expect((await page.locator('#editor').boundingBox()).height).toBeLessThan(initial.education.length * 180 + 300);
      await page.screenshot({ path: testInfo.outputPath(`${documentMode}-education-collapsed-${width}.png`), fullPage: true });
    }
    await checkLargeText(page, testInfo, `${documentMode}-education-collapsed-320-large-text.png`);
    await summaries(page).first().focus();
    await page.keyboard.press('Enter');
    await expect(schools(page).first().getByLabel('School or institution')).toBeVisible();
    if (initial.education.length > 1) {
      await summaries(page).nth(1).focus();
      await page.keyboard.press('Enter');
      await expect(schools(page).first().getByLabel('School or institution')).toBeHidden();
    }
    await expect(page.locator('.education-details[open]')).toHaveCount(1);
    expect(await savedDraft(page)).toEqual(initial);

    await page.getByRole('button', { name: 'Add education', exact: false }).click();
    await expect(schools(page).last().getByLabel('School or institution')).toBeFocused();
    await expect(page.locator('.education-details[open]')).toHaveCount(1);
    await schools(page).last().getByLabel('School or institution').fill('Added Research University');
    await schools(page).last().getByLabel('Degree type').selectOption('Ph.D.');
    await schools(page).last().getByLabel('Field of study (optional)').fill('Materials Science');
    const graduation = schools(page).last().getByRole('group', { name: 'Graduation', exact: true });
    await graduation.getByLabel('Date format').selectOption('year');
    await graduation.getByLabel('Graduation date').selectOption('2028');
    await graduation.getByLabel('Expected graduation').check();
    await schools(page).last().getByLabel('Additional details (optional)').fill('  Thesis and advisor wording retained.  ');
    const added = { school: 'Added Research University', degree: 'Ph.D. in Materials Science', date: 'Expected 2028', details: '  Thesis and advisor wording retained.  ' };
    expect((await savedDraft(page)).education).toEqual([...initial.education, added]);
    for (const text of [added.school, added.degree, added.date]) await expect(summaries(page).last()).toContainText(text);
    await checkLayout(page);
    await page.screenshot({ path: testInfo.outputPath(`${documentMode}-education-editing-375.png`), fullPage: true });
    await checkLargeText(page, testInfo, `${documentMode}-education-editing-320-large-text.png`);
    await schools(page).last().getByRole('button', { name: 'Done editing this entry', exact: true }).click();
    await expect(summaries(page).last()).toBeFocused();
    await expect(page.locator('.education-details[open]')).toHaveCount(0);
    await summaries(page).last().press('Enter');
    await schools(page).last().getByRole('button', { name: `Move education ${initial.education.length + 1} up`, exact: true }).click();
    await expect(page.locator('#editor')).toBeFocused();
    await expect(page.locator('.education-details[open]')).toHaveCount(1);
    await expect(page.locator('.education-details[open]').getByLabel('School or institution')).toHaveValue(added.school);
    const reordered = [...initial.education]; reordered.splice(reordered.length - 1, 0, added);
    expect((await savedDraft(page)).education).toEqual(reordered);
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('.education-details[open]').getByRole('button', { name: 'Remove', exact: true }).click();
    expect((await savedDraft(page)).education).toEqual(reordered);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.education-details[open]').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('#editor')).toBeFocused();
    expect(await savedDraft(page)).toEqual(initial);
    await page.reload();
    await page.locator('[data-step="2"]').click();
    await expect(page.locator('.education-details[open]')).toHaveCount(0);
    expect(await savedDraft(page)).toEqual(initial);

    const imported = structuredClone(initial); imported.education[0].school = 'Imported Institute';
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#resume-file').setInputFiles({ name: 'education.resume.json', mimeType: 'application/json', buffer: Buffer.from(serializeResumeFile(imported)) });
    await page.locator('[data-step="2"]').click();
    await expect(page.locator('.education-details[open]')).toHaveCount(0);
    await expect(summaries(page).first()).toContainText('Imported Institute');
    expect(await savedDraft(page)).toEqual(imported);
    expect(errors).toEqual([]);
  });

  test(`${documentMode} blank education opens initially and a checklist link reopens the missing school`, async ({ page }) => {
    await page.goto('/');
    await page.locator(`input[name="document-mode"][value="${documentMode}"]`).check();
    await page.getByLabel('Full name & credentials').fill('Education Checklist');
    await page.getByLabel('Email', { exact: true }).fill('education@example.com');
    await page.locator('[data-step="2"]').click();
    await expect(page.locator('.education-details[open]')).toHaveCount(1);
    await expect(page.getByLabel('School or institution')).toBeVisible();
    await page.getByLabel('Degree type').selectOption('Ph.D.');
    await page.getByRole('button', { name: 'Done editing this entry', exact: true }).click();
    await expect(summaries(page)).toBeFocused();
    await expect(page.getByLabel('School or institution')).toBeHidden();
    await page.locator('#download-check > summary').click();
    await page.getByRole('button', { name: 'Education 1: add the school or institution.', exact: true }).click();
    await expect(page.getByLabel('School or institution')).toBeFocused();
    await expect(page.locator('.education-details[open]')).toHaveCount(1);
    await page.getByLabel('School or institution').fill('Checklist University');
    await expect(page.locator('#check-count')).toContainText('no missing essentials');
    await page.getByRole('button', { name: 'Done editing this entry', exact: true }).click();
    await page.locator('[data-step="0"]').click(); await page.locator('[data-step="2"]').click();
    await expect(page.locator('.education-details[open]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add education', exact: false }).click();
    await expect(schools(page).last().getByLabel('School or institution')).toBeFocused();
    await schools(page).last().getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(schools(page)).toHaveCount(1);
    await expect(page.locator('.education-details[open]')).toHaveCount(0);
    expect((await savedDraft(page)).education).toEqual([{ school: 'Checklist University', degree: 'Ph.D.', date: '', details: '' }]);
  });
}

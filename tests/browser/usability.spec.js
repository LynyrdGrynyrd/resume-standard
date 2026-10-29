import { test, expect } from '@playwright/test';

test('empty guidance clears on editing and short screens keep downloads reachable by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await expect(page.locator('.preview-empty')).toBeVisible();
  await page.getByLabel('Full name & credentials').fill('Taylor Review');
  await expect(page.locator('#download-pdf')).toBeEnabled();
  await expect(page.locator('.preview-empty')).toHaveCount(0);
  await page.getByLabel('Email', { exact: true }).fill('taylor@example.com');
  await page.getByLabel('Full name & credentials').fill('');
  await expect(page.locator('#preview-status')).toContainText('Enter your name');
  await expect(page.locator('#download-pdf')).toBeDisabled();
  await page.getByLabel('Full name & credentials').fill('Taylor Review');
  await expect(page.locator('#download-pdf')).toBeEnabled();
  await page.locator('[data-step="3"]').click();
  await page.locator('#next').focus();
  await page.keyboard.press('Enter');
  for (let tab = 0; tab < 12 && !(await page.locator('#download-pdf').evaluate(node => node === document.activeElement)); tab++) await page.keyboard.press('Tab');
  await expect(page.locator('#download-pdf')).toBeFocused();
  const box = await page.locator('#download-pdf').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(390);
  const downloading = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  expect(await (await downloading).failure()).toBeNull();
});

test('editing and preview have a complete keyboard-accessible return path', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try an example' }).click();
  await page.locator('[data-step="3"]').click();
  await expect(page.locator('#next')).toBeVisible();
  await expect(page.locator('#next')).toHaveText('Review & download →');
  await page.locator('#next').click();
  await expect(page.locator('#preview-panel')).toBeFocused();
  expect(await page.locator('#preview-panel').evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  expect(await page.locator('#preview-panel').evaluate(node => node.getBoundingClientRect().top)).toBeLessThan(200);
  await page.locator('#back-to-editor').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor')).toBeFocused();
  await page.locator('#jump-preview').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#preview-panel')).toBeFocused();
  await page.locator('[data-step="1"]').click();
  await expect(page.locator('#editor')).toBeFocused();
  const top = await page.locator('#editor').evaluate(node => node.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(200);
  await expect(page.getByLabel('Employer', { exact: true }).first()).not.toHaveValue('');
});

test('phone forms remain readable, tappable, and within the viewport in every section', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try an example' }).click();
  const failures = [];
  const inspect = async context => {
    const issues = await page.evaluate(() => {
      const found = [];
      if (document.documentElement.scrollWidth > innerWidth) found.push('horizontal overflow');
      for (const control of document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), select, textarea, button:not(:disabled), summary')) {
        const rect = control.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const label = control.getAttribute('aria-label') || control.name || control.textContent.trim().slice(0, 45) || control.tagName;
        if (control.matches('input, select, textarea') && parseFloat(getComputedStyle(control).fontSize) < 16) found.push(`${label}: text below 16px`);
        if (control.matches('button, summary') && rect.height < 44) found.push(`${label}: target below 44px`);
        if (control.matches('button, summary') && rect.width < 44) found.push(`${label}: target narrower than 44px`);
      }
      return found;
    });
    failures.push(...issues.map(issue => `${context}: ${issue}`));
  };
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 812 });
    for (let step = 0; step < 4; step++) {
      await page.locator(`[data-step="${step}"]`).click();
      await inspect(`${width}px section ${step}`);
      for (const [schoolIndex, school] of (await page.locator('.education-details').all()).entries()) {
        if (!(await school.evaluate(node => node.open))) await school.locator(':scope > summary').click();
        await inspect(`${width}px education ${schoolIndex + 1}`);
      }
      for (const [employerIndex, employer] of (await page.locator('.employer-details').all()).entries()) {
        if (!(await employer.evaluate(node => node.open))) await employer.locator(':scope > summary').click();
        await inspect(`${width}px employer ${employerIndex + 1}`);
        for (const [roleIndex, role] of (await employer.locator('.role-details').all()).entries()) {
          if (!(await role.evaluate(node => node.open))) await role.locator(':scope > summary').click();
          for (const details of await role.locator('.optional-dates').all()) {
            if (!(await details.evaluate(node => node.open))) await details.locator(':scope > summary').click();
          }
          await inspect(`${width}px employer ${employerIndex + 1} role ${roleIndex + 1}`);
        }
      }
    }
  }
  expect(failures).toEqual([]);
});

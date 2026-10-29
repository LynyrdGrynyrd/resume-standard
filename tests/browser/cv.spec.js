import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { emptyResume, exampleResume, exampleCv, serializeResumeFile } from '../../src/state.js';

const academicFields = [
  ['researchInterests', 'Research Interests'],
  ['research', 'Research Experience'],
  ['teaching', 'Teaching and Mentoring'],
  ['grants', 'Grants and Funding'],
  ['patents', 'Patents'],
  ['presentations', 'Presentations'],
  ['honors', 'Honors and Awards'],
  ['service', 'Academic Service'],
  ['affiliations', 'Professional Affiliations'],
  ['references', 'References'],
];
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('classic-resume-v1')));
const mode = (page, value) => page.locator(`input[name="document-mode"][value="${value}"]`);
const portableFile = raw => ({ name: 'academic.resume.json', mimeType: 'application/json', buffer: Buffer.from(raw) });

async function importData(page, data) {
  await page.locator('#resume-file').setInputFiles(portableFile(serializeResumeFile(data)));
  await expect(page.getByLabel('Full name & credentials')).toHaveValue(data.name);
}

async function openDetails(details) {
  if (!(await details.evaluate(node => node.open))) await details.locator(':scope > summary').click();
}

async function downloadFile(page, testInfo, selector, extension) {
  const downloading = page.waitForEvent('download');
  await page.locator(selector).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  const path = testInfo.outputPath(`academic.${extension}`);
  await download.saveAs(path);
  return { path, filename: download.suggestedFilename() };
}

test('example experience stays compact and nested editing supports keyboard, add and reorder', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.locator('#example').click();
  await page.locator('[data-step="1"]').click();
  const initial = await draft(page);
  const employers = page.locator('#editor .employer-details');
  await expect(employers).toHaveCount(initial.experience.length);
  await expect(page.locator('.employer-details[open], .role-details[open]')).toHaveCount(0);
  expect((await page.locator('#editor').boundingBox()).height).toBeLessThan(700);
  for (const [index, job] of initial.experience.entries()) {
    await expect(employers.nth(index).locator('.employer-summary')).toContainText(job.company);
    await expect(employers.nth(index).locator('.employer-summary')).toContainText(`${job.roles.length} role`);
  }
  await page.screenshot({ path: testInfo.outputPath('demo-collapsed-375.png'), fullPage: true });

  await employers.first().locator('.employer-summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.employer-details[open]')).toHaveCount(1);
  const roles = employers.first().locator('.role-details');
  await roles.first().locator('.role-summary').focus();
  await page.keyboard.press('Enter');
  await expect(roles.first().getByLabel('Job title', { exact: true })).toBeVisible();
  await roles.nth(1).locator('.role-summary').focus();
  await page.keyboard.press('Enter');
  await expect(roles.first().getByLabel('Job title', { exact: true })).toBeHidden();
  await expect(page.locator('.role-details[open]')).toHaveCount(1);
  expect(await draft(page)).toEqual(initial);

  await employers.first().getByRole('button', { name: 'Add another role here' }).click();
  await expect(roles.last().getByLabel('Job title', { exact: true })).toBeFocused();
  await roles.last().getByLabel('Job title', { exact: true }).fill('New research appointment');
  await roles.last().getByLabel('Accomplishment 1', { exact: true }).fill('Preserved new result.');
  await roles.last().getByRole('button', { name: `Move role ${initial.experience[0].roles.length + 1} up`, exact: true }).click();
  await expect(page.locator('#editor')).toBeFocused();
  const reordered = await draft(page);
  expect(reordered.experience[0].roles.at(-2).title).toBe('New research appointment');
  expect(reordered.experience[0].roles.at(-2).bullets).toBe('Preserved new result.');
  expect(reordered.experience[0].roles.filter(role => role.title !== 'New research appointment')).toEqual(initial.experience[0].roles);

  await page.getByRole('button', { name: 'Add employer', exact: false }).click();
  await expect(employers.last().getByLabel('Employer', { exact: true })).toBeFocused();
  await expect(page.locator('.employer-details[open]')).toHaveCount(1);
  await expect(page.locator('.role-details[open]')).toHaveCount(1);
  await employers.last().getByLabel('Employer', { exact: true }).fill('Added University');
  await employers.last().getByLabel('Job title', { exact: true }).fill('Visiting Fellow');
  const complete = await draft(page);
  expect(complete.experience.slice(0, -1)).toEqual(reordered.experience);
  expect(complete.experience.at(-1).roles[0].title).toBe('Visiting Fellow');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a long career exposes summaries without expanding all employers or roles', async ({ page }, testInfo) => {
  const data = emptyResume(); data.name = 'Many Appointments'; data.email = 'many@example.com';
  data.experience = Array.from({ length: 12 }, (_, index) => ({
    company: `Research institution ${index + 1}`, dates: `${2000 + index} – ${2001 + index}`,
    roles: Array.from({ length: 4 }, (_, role) => ({ title: `Research role ${role + 1}`, dates: '', description: 'Scope retained.', bullets: 'First result.\nSecond result.' })),
  }));
  await page.setViewportSize({ width: 320, height: 812 });
  await page.goto('/'); await importData(page, data);
  await page.locator('[data-step="1"]').click();
  await expect(page.locator('.employer-details')).toHaveCount(12);
  await expect(page.locator('.role-details')).toHaveCount(48);
  await expect(page.locator('.employer-details[open], .role-details[open]')).toHaveCount(0);
  for (const summary of await page.locator('.employer-summary').all()) expect((await summary.boundingBox()).height).toBeLessThan(160);
  expect((await page.locator('#editor').boundingBox()).height).toBeLessThan(2500);
  await page.locator('.employer-summary').last().click();
  await page.locator('.employer-details').last().locator('.role-summary').last().click();
  await expect(page.getByLabel('Job title', { exact: true }).last()).toHaveValue('Research role 4');
  await page.locator('.employer-summary').first().click();
  await expect(page.locator('.employer-details[open]')).toHaveCount(1);
  await expect(page.getByLabel('Job title', { exact: true }).last()).toBeHidden();
  expect(await draft(page)).toEqual(data);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('many-employers-320.png'), fullPage: true });
});

test('resume and academic modes retain every field through editing, switching, reload and backup', async ({ page }, testInfo) => {
  const data = exampleResume();
  await page.goto('/'); await importData(page, data);
  await mode(page, 'cv').check();
  await expect(mode(page, 'cv')).toBeChecked();
  await expect(page.getByLabel('Profile (optional)')).toHaveValue(data.summary);
  await page.locator('[data-step="3"]').click();
  await expect(page.locator('.academic-section')).toHaveCount(12);
  for (const [key, label] of academicFields) {
    const section = page.locator('.academic-section').filter({ has: page.locator(`textarea[name="${key}"]`) });
    await openDetails(section);
    const value = `  ${label} retained entry.\nSecond entry for ${key}.  `;
    await section.getByLabel(label).fill(value);
    data.cv[key] = value;
  }
  data.mode = 'cv';
  expect(await draft(page)).toEqual(data);
  await mode(page, 'resume').check();
  await expect(page.locator('.academic-section')).toHaveCount(0);
  await expect(page.getByLabel('Publications and patents')).toHaveValue(data.publications);
  await expect(page.getByLabel('Technical expertise')).toHaveValue(data.skills);
  expect(await draft(page)).toEqual({ ...data, mode: 'resume' });
  const resumeText = await downloadFile(page, testInfo, '#download-text', 'resume.txt');
  const resumeOutput = await readFile(resumeText.path, 'utf8');
  for (const [key] of academicFields) expect(resumeOutput).not.toContain(`Second entry for ${key}.`);
  expect(resumeOutput).toContain(data.experience[0].company);
  await mode(page, 'cv').check();
  await page.reload();
  await expect(mode(page, 'cv')).toBeChecked();
  expect(await draft(page)).toEqual(data);
  await page.locator('[data-step="3"]').click();
  for (const [key, label] of academicFields) {
    const section = page.locator('.academic-section').filter({ has: page.locator(`textarea[name="${key}"]`) });
    await openDetails(section);
    await expect(section.getByLabel(label)).toHaveValue(data.cv[key]);
  }
  const saved = await downloadFile(page, testInfo, '#save-file', 'resume.json');
  expect(saved.filename).toContain('CV');
  expect(JSON.parse(await readFile(saved.path, 'utf8'))).toEqual({ format: 'classic-resume', version: 2, data });
});

test('legacy drafts are untouched on load and version-one imports migrate without changing strings', async ({ page }, testInfo) => {
  const legacy = {
    name: 'Legacy García', phone: '', email: 'legacy@example.com', location: '', website: '',
    summary: '  Original profile.\r\nSecond line.  ',
    experience: [{ company: ' Original University ', dates: 'Spring 2020 – today', roles: [{ title: ' Researcher ', dates: ' 2021 ', description: ' Original scope ', bullets: '  First.\r\n\r\n• Second.  ' }] }],
    education: [{ school: 'Example University', date: 'Expected Fall 2028', degree: ' MSc – Applied Physics ', details: 'Thesis wording retained.' }],
    publications: '  Original citation.  ', skills: 'Spectroscopy\nData analysis',
  };
  const raw = JSON.stringify(legacy, null, 2);
  await page.addInitScript(value => { if (!localStorage.getItem('classic-resume-v1')) localStorage.setItem('classic-resume-v1', value); }, raw);
  await page.goto('/');
  await expect(mode(page, 'resume')).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('classic-resume-v1'))).toBe(raw);
  await page.getByLabel('Full name & credentials').fill('Temporary replacement');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#resume-file').setInputFiles(portableFile(JSON.stringify({ format: 'classic-resume', version: 1, data: legacy })));
  await expect(page.getByLabel('Full name & credentials')).toHaveValue(legacy.name);
  const migrated = await draft(page);
  const { mode: selectedMode, cv, ...shared } = migrated;
  expect(shared).toEqual(legacy);
  expect(selectedMode).toBe('resume');
  expect(Object.values(cv)).toEqual(Array(10).fill(''));
  await mode(page, 'cv').check();
  await mode(page, 'resume').check();
  const downloaded = await downloadFile(page, testInfo, '#save-file', 'legacy.resume.json');
  const envelope = JSON.parse(await readFile(downloaded.path, 'utf8'));
  expect(envelope.version).toBe(2);
  expect(envelope.data).toEqual(migrated);
});

test('academic example downloads complete multi-page PDF, Word, Markdown, text and backup locally', async ({ page, baseURL }, testInfo) => {
  const errors = [], external = [];
  const appOrigin = new URL(baseURL).origin;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!/^(blob:|data:)/.test(request.url()) && new URL(request.url()).origin !== appOrigin) external.push(request.url()); });
  await page.goto('/');
  await mode(page, 'cv').check();
  await page.locator('#example').click();
  await expect(mode(page, 'cv')).toBeChecked();
  const example = await draft(page);
  expect(example).toEqual(exampleCv());
  for (const [key] of academicFields) expect(example.cv[key].trim().length).toBeGreaterThan(0);
  const data = exampleCv(); data.name = 'Jordan Academic, Ph.D.';
  for (const [index, [key]] of academicFields.entries()) data.cv[key] = `Section marker ${String(index + 1).padStart(2, '0')}: ${key} complete.`;
  const publications = Array.from({ length: 75 }, (_, index) => `Publication ${String(index + 1).padStart(3, '0')}. Academic J. Reproducible research methods and materials. Example Journal. 2025.`);
  data.publications = publications.join('\n');
  page.once('dialog', dialog => dialog.accept());
  await importData(page, data);
  const files = {};
  for (const [selector, extension] of [['#download-pdf', 'pdf'], ['#download-docx', 'docx'], ['#download-markdown', 'md'], ['#download-text', 'txt'], ['#save-file', 'resume.json']]) {
    files[extension] = await downloadFile(page, testInfo, selector, extension);
    expect(files[extension].filename).toMatch(/CV\./);
  }
  const pdf = await getDocument({ data: new Uint8Array(await readFile(files.pdf.path)), useSystemFonts: false }).promise;
  expect(pdf.numPages).toBeGreaterThan(2);
  const metadata = await pdf.getMetadata();
  expect(metadata.info.Title).toBe(`${data.name} — Curriculum Vitae`);
  const pdfPages = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const pdfPage = await pdf.getPage(number);
    const content = await pdfPage.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    expect(text).toContain(`Page ${number} of ${pdf.numPages}`);
    expect(content.items.filter(item => item.str === `Page ${number} of ${pdf.numPages}`)).toHaveLength(1);
    for (const item of content.items.filter(item => item.str.trim())) {
      expect(item.transform[4]).toBeGreaterThanOrEqual(50);
      expect(item.transform[4] + item.width).toBeLessThanOrEqual(563);
      if (item.str === `Page ${number} of ${pdf.numPages}`) {
        expect(item.transform[5]).toBeGreaterThanOrEqual(20);
        expect(item.transform[5]).toBeLessThanOrEqual(24);
      } else expect(item.transform[5]).toBeGreaterThanOrEqual(30);
      expect(item.transform[5]).toBeLessThanOrEqual(756);
    }
    pdfPages.push(text);
  }
  await pdf.loadingTask.destroy();
  const archive = unzipSync(new Uint8Array(await readFile(files.docx.path)));
  const wordXml = strFromU8(archive['word/document.xml']);
  const footer = Object.entries(archive).filter(([name]) => /^word\/footer\d+\.xml$/.test(name)).map(([, bytes]) => strFromU8(bytes)).join(' ');
  expect(footer).toContain('PAGE'); expect(footer).toContain('NUMPAGES');
  expect(strFromU8(archive['docProps/core.xml'])).toContain(`${data.name} — Curriculum Vitae`);
  const markdown = await readFile(files.md.path, 'utf8');
  const plain = await readFile(files.txt.path, 'utf8');
  for (const output of [pdfPages.join(' '), wordXml, markdown, plain]) {
    for (const marker of Object.values(data.cv)) expect(output).toContain(marker);
    for (const publication of publications) expect(output).toContain(publication);
    expect(output).toContain(data.education[0].school);
    expect(output).toContain(data.experience[0].company);
    expect(output).toContain(data.experience[0].roles[0].title);
    expect(output.indexOf('Education')).toBeLessThan(output.indexOf('Academic and Professional Appointments'));
    expect(output.indexOf('Grants and Funding')).toBeLessThan(output.indexOf('Publications'));
    expect(output.indexOf('Publications')).toBeLessThan(output.indexOf('Patents'));
    expect(output.indexOf('Research Skills')).toBeLessThan(output.indexOf('References'));
  }
  expect(JSON.parse(await readFile(files['resume.json'].path, 'utf8'))).toEqual({ format: 'classic-resume', version: 2, data });
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('CV sections are labelled, keyboard reachable and readable at narrow and wide sizes', async ({ page }, testInfo) => {
  await page.goto('/');
  await mode(page, 'cv').check();
  await page.locator('#example').click();
  const failures = [];
  const inspect = () => page.evaluate(() => {
    const found = [];
    if (document.documentElement.scrollWidth > innerWidth) found.push('horizontal overflow');
    for (const node of document.querySelectorAll('#editor input:not([type="checkbox"]):not([type="radio"]), #editor select, #editor textarea, button:not(:disabled), summary, .document-mode label')) {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const label = node.name || node.getAttribute('aria-label') || node.textContent.trim().slice(0, 40);
      if (node.matches('input, select, textarea') && parseFloat(getComputedStyle(node).fontSize) < 16) found.push(`${label}: text below 16px`);
      if (node.matches('button, summary, label') && rect.height < 44) found.push(`${label}: target below 44px`);
      if (node.matches('button, summary, label') && rect.width < 44) found.push(`${label}: target narrower than 44px`);
    }
    return found;
  });
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (let step = 0; step < 4; step++) {
      await page.locator(`[data-step="${step}"]`).click();
      if (step === 3) {
        for (const [key, label] of academicFields) {
          const section = page.locator('.academic-section').filter({ has: page.locator(`textarea[name="${key}"]`) });
          const summary = section.locator(':scope > summary');
          await summary.focus();
          await page.keyboard.press('Enter');
          await expect(section.getByLabel(label)).toBeVisible();
          await page.keyboard.press('Tab');
          await expect(section.getByLabel(label)).toBeFocused();
        }
        for (const key of ['publications', 'skills']) await openDetails(page.locator('.academic-section').filter({ has: page.locator(`textarea[name="${key}"]`) }));
      }
      const issues = await inspect();
      failures.push(...issues.map(issue => `${width}px section ${step}: ${issue}`));
      for (const [index, school] of (await page.locator('.education-details').all()).entries()) {
        await openDetails(school);
        failures.push(...(await inspect()).map(issue => `${width}px education ${index + 1}: ${issue}`));
      }
      if (step === 3 && [375, 1440].includes(width)) await page.screenshot({ path: testInfo.outputPath(`academic-${width}.png`), fullPage: true });
    }
  }
  expect(failures).toEqual([]);
});

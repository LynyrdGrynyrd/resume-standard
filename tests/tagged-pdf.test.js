import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdfkit';
import { toBlob } from 'pdfkit/output';
import { buildTaggedPdf } from '../src/tagged-pdf.js';
import { resumeBlocks } from '../src/documents.js';
import { exampleResume } from '../src/state.js';

const fonts = Object.fromEntries(await Promise.all(Object.entries({ normal: 'Regular', bold: 'Bold', italics: 'Italic', bolditalics: 'BoldItalic' }).map(async ([key, name]) => [key, new Uint8Array(await readFile(`public/fonts/EBGaramond-${name}.ttf`))])));
async function inspect(data, render = buildTaggedPdf) {
  const blob = await render(data, fonts);
  const pdf = await getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false }).promise;
  const pages = [], trees = [], runs = [];
  try {
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent({ includeMarkedContent: true });
    const textItems = content.items.filter(item => 'str' in item);
    pages.push(textItems.map(item => item.str + (item.hasEOL ? '\n' : '')).join(''));
    runs.push(textItems.filter(item => item.str.trim()));
    const tree = await page.getStructTree(); trees.push(tree);
    const contentIds = new Set();
    const collectIds = node => { if (node?.type === 'content') contentIds.add(node.id); node?.children?.forEach(collectIds); };
    collectIds(tree);
    const stack = [];
    for (const item of content.items) {
      if (item.type === 'beginMarkedContentProps' || item.type === 'beginMarkedContent') stack.push(item.id);
      else if (item.type === 'endMarkedContent') stack.pop();
      else if (item.str?.trim()) assert.ok(stack.some(id => contentIds.has(id)), `Untagged visible text on page ${i}: ${item.str}`);
    }
    assert.deepEqual(page.view, [0, 0, 612, 792]);
  }
  return { pages, trees, runs, metadata: await pdf.getMetadata(), markInfo: await pdf.getMarkInfo(), outlines: await pdf.getOutline() };
  } finally { await pdf.loadingTask.destroy(); }
}
const roles = node => [node?.role, ...(node?.children ?? []).flatMap(roles)].filter(Boolean);
const normalized = value => value.replace(/\s+/g, ' ').trim();

test('PDF has real headings, paragraphs, list structure, metadata and original small-cap name text', async () => {
  const data = exampleResume(); data.name = 'Renée García, Ph.D.'; data.publications = 'García, R. Polymer research. 2025.';
  const result = await inspect(data);
  assert.equal(result.markInfo.get('Marked'), true);
  const tags = result.trees.flatMap(roles);
  for (const role of ['Document', 'H1', 'H2', 'P', 'L', 'LI', 'Lbl', 'LBody']) assert.ok(tags.includes(role), `Missing real structure: ${role}`);
  assert.equal(result.trees[0].children[0].children.find(node => node.role === 'H1').alt, data.name);
  assert.equal(result.metadata.info.Title, `${data.name} — Résumé`);
  assert.equal(result.metadata.info.Language, 'en-US');
  assert.equal(result.outlines.length, 5);
  const text = normalized(result.pages.join(' '));
  let offset = 0;
  for (const block of resumeBlocks(data)) {
    const at = text.indexOf(normalized(block.text), offset);
    assert.ok(at >= offset, `Missing or out-of-order ${block.kind}: ${block.text}`);
    offset = at + normalized(block.text).length;
  }
  for (const item of result.runs.flat()) {
    assert.ok(item.transform[4] >= 50 && item.transform[4] + item.width <= 563, `Outside horizontal bounds: ${item.str}`);
    assert.ok(item.transform[5] >= 30 && item.transform[5] <= 756, `Outside vertical bounds: ${item.str}`);
  }
});

test('long tagged paragraphs and list items paginate without dropping text or separating trailing headings', async () => {
  const data = exampleResume();
  data.summary = Array.from({ length: 80 }, (_, i) => `Summary line ${String(i + 1).padStart(3, '0')}.`).join('\n');
  data.experience[0].roles[0].description = Array.from({ length: 80 }, (_, i) => `Overview line ${String(i + 1).padStart(3, '0')}.`).join('\n');
  data.experience[0].roles[0].bullets = Array.from({ length: 180 }, (_, i) => `Sentence ${String(i + 1).padStart(3, '0')} describes a contribution to a complex project and its successful delivery.`).join(' ');
  const result = await inspect(data), text = normalized(result.pages.join(' '));
  assert.ok(result.pages.length > 2);
  assert.equal(text.match(/Summary line \d{3}/g).length, 80);
  assert.equal(text.match(/Overview line \d{3}/g).length, 80);
  assert.equal(text.match(/Sentence \d{3}/g).length, 180);
  for (const [index, page] of result.pages.entries()) {
    assert.ok(page.trim(), `Page ${index + 1} is empty`);
    assert.ok(result.trees[index], `Page ${index + 1} has no structure`);
    assert.doesNotMatch(page.trim(), /(?:Summary of Qualifications|Professional Experience|Academic Credentials|Technical Expertise)$/);
    for (const item of result.runs[index]) assert.ok(item.transform[5] >= 30 && item.transform[5] <= 756, `Outside page: ${item.str}`);
  }
});

test('body text keeps its 11pt size with the original template line spacing', async () => {
  const result = await inspect({ summary: 'First baseline sample.\nSecond baseline sample.' });
  const first = result.runs.flat().find(item => item.str.includes('First baseline sample.'));
  const second = result.runs.flat().find(item => item.str.includes('Second baseline sample.'));
  assert.ok(first && second, 'Both body lines must be extractable');
  assert.equal(first.transform[0], 11, 'Compact spacing must not shrink the body text');
  assert.equal(second.transform[0], 11);
  const baselineGap = first.transform[5] - second.transform[5];
  assert.ok(Math.abs(baselineGap - 12.32) < 0.05, `Expected 12.32pt body leading; got ${baselineGap}`);
});

test('justified text stays inside the template right margin across word boundaries', async () => {
  const summary = 'A V '.repeat(200).trim();
  const result = await inspect({ summary });
  const body = result.runs.flat().filter(item => item.str.includes('A V'));
  assert.ok(body.length > 1, 'Fixture must wrap into justified lines');
  assert.equal(normalized(body.map(item => item.str).join(' ')), summary);
  for (const item of body) assert.ok(item.transform[4] + item.width <= 561.63, `Right margin exceeded: ${item.transform[4] + item.width}`);
});

test('ordinary multi-line accomplishments stay on one page without orphaning their headings', async () => {
  const bullets = Array.from({ length: 38 }, (_, i) => {
    const id = String(i + 1).padStart(3, '0');
    return `Item ${id} begins. ${'Delivered a measured improvement through careful testing and practical collaboration. '.repeat(2 + i % 3)}Item ${id} ends.`;
  });
  const result = await inspect({ experience: [{ company: 'Example Materials', roles: [{ title: 'Research Director', bullets: bullets.join('\n') }] }] });
  const pages = result.pages.map(normalized);
  assert.ok(pages.length > 1, 'Fixture must exercise a page boundary');
  for (let i = 1; i <= bullets.length; i++) {
    const id = String(i).padStart(3, '0');
    const startPages = pages.flatMap((page, index) => page.includes(`Item ${id} begins.`) ? [index] : []);
    const endPages = pages.flatMap((page, index) => page.includes(`Item ${id} ends.`) ? [index] : []);
    assert.equal(startPages.length, 1, `Missing or duplicated beginning of item ${id}`);
    assert.deepEqual(endPages, startPages, `Item ${id} split across pages`);
  }
  for (const page of result.pages) {
    assert.ok(page.trim(), 'No empty pages');
    assert.doesNotMatch(page.trim(), /(?:Professional Experience|Example Materials|Research Director)$/);
  }
});

test('empty and partial resumes still produce a valid PDF; missing fonts fail explicitly', async () => {
  const blank = await inspect({});
  assert.equal(blank.pages.length, 1);
  assert.equal(blank.pages[0], '');
  await assert.rejects(buildTaggedPdf({ name: 'Example' }, {}), /Missing résumé font/);
});

test('a paragraph that nearly fills a page does not leave its section heading behind', async () => {
  const result = await inspect({ summary: Array.from({ length: 57 }, (_, i) => `Line ${String(i + 1).padStart(2, '0')} x`).join('\n') });
  const headingPage = result.pages.find(page => page.includes('Summary of Qualifications'));
  assert.ok(headingPage?.includes('Line 01 x'), 'Section heading must share a page with the first body line');
  assert.ok(result.pages.every(page => page.trim()), 'No empty pages');
  const text = normalized(result.pages.join(' '));
  for (let i = 1; i <= 57; i++) assert.equal(text.split(`Line ${String(i).padStart(2, '0')} x`).length - 1, 1, `Missing or duplicated line ${i}`);
});

test('a tall first contact block does not create a blank leading page', async () => {
  const result = await inspect({ phone: Array.from({ length: 62 }, (_, i) => `Contact ${String(i + 1).padStart(2, '0')}`).join('\n') });
  assert.ok(result.pages.every(page => page.trim()), 'No empty pages');
  const text = normalized(result.pages.join(' '));
  for (let i = 1; i <= 62; i++) assert.equal(text.split(`Contact ${String(i).padStart(2, '0')}`).length - 1, 1, `Missing or duplicated contact line ${i}`);
});

test('three-digit publication labels leave enough body width and preserve every numbered entry', async () => {
  const publications = Array.from({ length: 105 }, (_, i) => `Publication ${String(i + 1).padStart(3, '0')}: ${'A V '.repeat(45)}End ${String(i + 1).padStart(3, '0')}.`);
  const result = await inspect({ publications: publications.join('\n') });
  const text = normalized(result.pages.join(' '));
  assert.deepEqual([...text.matchAll(/(?:^|\s)(\d+)\)\s/g)].map(match => Number(match[1])), Array.from({ length: 105 }, (_, i) => i + 1));
  let offset = 0;
  for (const publication of publications) {
    const at = text.indexOf(publication, offset);
    assert.ok(at >= offset, `Missing or reordered ${publication.slice(0, 16)}`);
    offset = at + publication.length;
  }
  const runs = result.runs.flat();
  assert.ok(runs.find(item => item.str.includes('Publication 100:'))?.transform[4] > 84.6, 'Fixture must exercise a label wider than the standard hanging indent');
  for (const item of runs) assert.ok(item.transform[4] + item.width <= 561.63, `Publication right margin exceeded: ${item.str}`);
  assert.ok(result.pages.every(page => page.trim()), 'No empty pages');
});

test('a near-page-height first accomplishment keeps its section, employer, and role with its beginning', async () => {
  const bullet = `Bullet begins. ${'MMMMMMMMMM '.repeat(220)}Bullet ends.`;
  const result = await inspect({ experience: [{ company: 'Example Materials', roles: [{ title: 'Research Director', bullets: bullet }] }] });
  assert.equal(result.pages.length, 2, 'Fixture must cross one page boundary');
  const bodyLines = new Set(result.runs.flatMap((runs, page) => runs.filter(item => item.str.includes('MMMMMMMMMM')).map(item => `${page}:${item.transform[5].toFixed(2)}`)));
  assert.ok(bodyLines.size >= 54 && bodyLines.size <= 57, `Fixture needs about 55 wrapped lines; got ${bodyLines.size}`);
  for (const value of ['Professional Experience', 'Example Materials', 'Research Director', 'Bullet begins.']) assert.ok(result.pages[0].includes(value), `${value} must remain on the first page`);
  const text = normalized(result.pages.join(' '));
  assert.ok(text.includes(bullet), 'The complete accomplishment must remain extractable in order');
  assert.equal(text.match(/MMMMMMMMMM/g).length, 220);
  assert.ok(result.pages.every(page => page.trim()), 'No empty pages');
});

test('tag coverage check rejects a merely marked PDF with untagged visible text', async () => {
  await assert.rejects(inspect({}, async () => {
    const doc = new PDFDocument({ font: null, tagged: true });
    const result = toBlob(doc);
    doc.registerFont('body', fonts.normal).font('body').text('Unlinked content');
    doc.end();
    return result;
  }), /Untagged visible text/);
});

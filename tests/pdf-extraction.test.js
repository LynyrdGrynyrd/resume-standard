import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { resumeBlocks } from '../src/documents.js';
import { buildTaggedPdf } from '../src/tagged-pdf.js';
import { exampleResume } from '../src/state.js';

const fonts = Object.fromEntries(await Promise.all(Object.entries({ normal: 'Regular', bold: 'Bold', italics: 'Italic', bolditalics: 'BoldItalic' })
  .map(async ([key, name]) => [key, new Uint8Array(await readFile(`public/fonts/EBGaramond-${name}.ttf`))])));

test('actual PDF text retains accented small-cap name, headings, employer/role dates and every bullet in order', async () => {
  const data = exampleResume();
  data.name = 'Renée García, Ph.D.';
  data.summary = 'Summary line one.\nSecond line with an office affiliation.';
  data.experience[0].roles[0].bullets = Array.from({ length: 70 }, (_, index) => `Achievement ${String(index + 1).padStart(3, '0')}: Tested résumé extraction across pages.`).join('\n');
  const blob = await buildTaggedPdf(data, fonts);
  const pdf = await getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false }).promise;
  try {
    assert.ok(pdf.numPages > 1, 'Fixture must exercise pagination');
    const items = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      items.push(...(await page.getTextContent()).items.filter(item => 'str' in item).map(item => item.str));
    }
    const extracted = items.join('').replace(/\s/g, '');
    let position = -1;
    for (const block of resumeBlocks(data)) {
      const expected = block.text.replace(/\s/g, '');
      const next = extracted.indexOf(expected, position + 1);
      assert.ok(next > position, `Missing or reordered exported ${block.kind}: ${block.text.slice(0, 80)}`);
      position = next;
    }
    assert.equal((extracted.match(/Achievement\d{3}:/g) ?? []).length, 70);
    assert.deepEqual((await pdf.getOutline()).map(item => item.title), resumeBlocks(data).filter(block => block.kind === 'heading').map(block => block.text));
    assert.equal((await pdf.getMetadata()).info.Language, 'en-US');
  } finally { await pdf.loadingTask.destroy(); }
});

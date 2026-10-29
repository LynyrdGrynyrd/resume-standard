import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { unzipSync, strFromU8 } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDocx, buildMarkdown, buildText, resumeBlocks } from '../src/documents.js';
import { buildTaggedPdf } from '../src/tagged-pdf.js';
import { exampleCv } from '../src/state.js';

const headings = ['Profile', 'Education', 'Academic and Professional Appointments', 'Research Interests',
  'Research Experience', 'Teaching and Mentoring', 'Grants and Funding', 'Publications', 'Patents',
  'Presentations', 'Honors and Awards', 'Academic Service', 'Professional Affiliations', 'Research Skills', 'References'];
const fonts = Object.fromEntries(await Promise.all(Object.entries({ normal: 'Regular', bold: 'Bold', italics: 'Italic', bolditalics: 'BoldItalic' })
  .map(async ([key, name]) => [key, new Uint8Array(await readFile(`public/fonts/EBGaramond-${name}.ttf`))])));
const compact = value => value.replace(/\s/g, '');
const xmlText = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const wordFiles = async data => unzipSync(new Uint8Array(await (await buildDocx(data)).arrayBuffer()));
const openPdf = async data => getDocument({ data: new Uint8Array(await (await buildTaggedPdf(data, fonts)).arrayBuffer()), useSystemFonts: false }).promise;

// PDF.js suppresses unmatched EMC operators; inspect PDFKit's page streams as well.
function assertBalancedPageMarkings(bytes) {
  const objects = new Map([...Buffer.from(bytes).toString('latin1').matchAll(/(\d+) 0 obj\s+([\s\S]*?)\s+endobj/g)]
    .map(match => [match[1], match[2]]));
  const pages = [...objects.values()].filter(object => /\/Type\s*\/Page\b/.test(object));
  assert.ok(pages.length > 0, 'Must inspect actual page content streams');
  for (const [index, page] of pages.entries()) {
    const reference = page.match(/\/Contents\s+(\d+) 0 R/);
    assert.ok(reference, `Unsupported page contents on page ${index + 1}`);
    const stream = objects.get(reference[1]);
    const start = stream?.indexOf('stream\n');
    const length = stream?.match(/\/Length\s+(\d+)/);
    assert.ok(start >= 0 && length && /\/Filter\s*\/FlateDecode/.test(stream), 'Expected PDFKit compressed page stream');
    const content = inflateSync(Buffer.from(stream.slice(start + 7, start + 7 + Number(length[1])), 'latin1')).toString();
    let depth = 0;
    for (const [, operator] of content.matchAll(/\b(BMC|BDC|EMC)\b/g)) {
      depth += operator === 'EMC' ? -1 : 1;
      assert.ok(depth >= 0, `Unmatched EMC operator on page ${index + 1}`);
    }
    assert.equal(depth, 0, `Unclosed marked content on page ${index + 1}`);
  }
}

function longCv() {
  const data = exampleCv();
  for (const key of Object.keys(data.cv)) data.cv[key] = Array.from({ length: 12 }, (_, i) =>
    `${key} entry ${String(i + 1).padStart(3, '0')}: Manually supplied academic detail with an institution, date and contribution.`).join('\n');
  data.publications = Array.from({ length: 24 }, (_, i) => `Morgan, A. Publication ${String(i + 1).padStart(3, '0')}. Example Journal, 2025.`).join('\n');
  return data;
}

test('academic sections have their own order and labels in shared text and Markdown output', () => {
  const data = exampleCv(), snapshot = structuredClone(data);
  const blocks = resumeBlocks(data);
  assert.deepEqual(blocks.filter(block => block.kind === 'heading').map(block => block.text), headings);
  for (const value of Object.values(data.cv)) {
    for (const line of value.split('\n').filter(Boolean)) assert.ok(blocks.some(block => block.text.includes(line)), `Missing CV entry: ${line}`);
  }
  const plain = buildText(data), markdown = buildMarkdown(data);
  let position = -1;
  for (const heading of headings) {
    const next = plain.indexOf(`\n${heading}\n`, position + 1);
    assert.ok(next > position, `Missing or reordered ${heading}`);
    assert.ok(markdown.includes(`## ${heading}\n`));
    position = next;
  }
  const referenceBlocks = blocks.slice(blocks.findIndex(block => block.text === 'References') + 1);
  assert.ok(referenceBlocks.length > 0);
  assert.ok(referenceBlocks.every(block => block.kind === 'description'), 'References are plain entries, not numbered publications');
  assert.deepEqual(data, snapshot, 'Export must not change entered data');
});

test('resume and CV PDF page streams contain balanced marked-content operators', async () => {
  for (const mode of ['resume', 'cv']) {
    const data = { ...exampleCv(), mode };
    const blob = await buildTaggedPdf(data, fonts);
    assertBalancedPageMarkings(await blob.arrayBuffer());
  }
});

test('resume mode preserves legacy output and excludes every CV-only field', async () => {
  const data = exampleCv();
  data.mode = 'resume';
  for (const key of Object.keys(data.cv)) data.cv[key] = `UNIQUE_CV_ONLY_${key}`;
  const { mode, cv, ...legacy } = data;
  assert.deepEqual(resumeBlocks(data), resumeBlocks(legacy));
  assert.equal(buildText(data), buildText(legacy));
  assert.equal(buildMarkdown(data), buildMarkdown(legacy));
  const [currentFiles, legacyFiles] = await Promise.all([wordFiles(data), wordFiles(legacy)]);
  assert.equal(strFromU8(currentFiles['word/document.xml']), strFromU8(legacyFiles['word/document.xml']));
  assert.ok(!Object.keys(currentFiles).some(path => /^word\/footer/.test(path)), 'Resume keeps its original unnumbered layout');
  const pdf = await openPdf(data);
  try {
    let text = '';
    for (let page = 1; page <= pdf.numPages; page++) text += (await (await pdf.getPage(page)).getTextContent()).items.map(item => item.str ?? '').join('');
    assert.doesNotMatch(text, /UNIQUE_CV_ONLY_|Page \d+ of \d+/);
    assert.equal((await pdf.getMetadata()).info.Title, `${data.name} — Résumé`);
  } finally { await pdf.loadingTask.destroy(); }
});

test('academic DOCX retains every long-CV entry in order and has live page-number footer fields', async () => {
  const data = longCv(), files = await wordFiles(data);
  const document = strFromU8(files['word/document.xml']);
  const core = strFromU8(files['docProps/core.xml']);
  assert.match(core, /— Curriculum Vitae<\/dc:title>/);
  assert.match(document, /w:top="720" w:right="1008" w:bottom="720" w:left="1152"/);
  assert.match(document, /<w:footerReference /);
  const footerPaths = Object.keys(files).filter(path => /^word\/footer\d+\.xml$/.test(path));
  assert.equal(footerPaths.length, 1);
  const footer = strFromU8(files[footerPaths[0]]);
  assert.match(footer, /<w:jc w:val="center"/);
  assert.match(footer, />\s*PAGE\s*<\/w:instrText>/);
  assert.match(footer, />\s*NUMPAGES\s*<\/w:instrText>/);
  assert.match(footer, />Page <\/w:t>/);
  assert.match(footer, /> of <\/w:t>/);
  assert.doesNotMatch(footer, new RegExp(data.name));
  let position = -1;
  for (const block of resumeBlocks(data)) {
    for (const line of block.text.split('\n')) {
      const next = document.indexOf(xmlText(line), position + 1);
      assert.ok(next > position, `Missing or reordered Word entry: ${line}`);
      position = next;
    }
  }
});

test('multi-page CV PDF keeps every section readable and tagged, with page numbers as artifacts', async () => {
  const data = longCv(), pdf = await openPdf(data);
  try {
    assert.ok(pdf.numPages >= 3, 'Fixture must exercise a long academic CV');
    assert.ok(pdf.numPages < 12, 'Footer must not create phantom pages');
    let body = '';
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const { items } = await page.getTextContent({ includeMarkedContent: true });
      const ids = new Set();
      const collect = node => { if (node?.type === 'content') ids.add(node.id); node?.children?.forEach(collect); };
      collect(await page.getStructTree());
      const stack = [], bodyItems = [], footerItems = [];
      for (const item of items) {
        if (item.type === 'beginMarkedContentProps' || item.type === 'beginMarkedContent') stack.push(item);
        else if (item.type === 'endMarkedContent') {
          assert.ok(stack.length > 0, `Unmatched marked-content close on page ${number}`);
          stack.pop();
        }
        else if (item.str?.trim()) {
          assert.ok(item.transform[4] >= 50 && item.transform[4] + item.width <= 563, `Clipped text: ${item.str}`);
          if (stack.some(mark => mark.tag === 'Artifact')) footerItems.push(item);
          else {
            assert.ok(stack.some(mark => ids.has(mark.id)), `Untagged body: ${item.str}`);
            assert.ok(item.transform[5] >= 30 && item.transform[5] <= 756, `Body outside page: ${item.str}`);
            bodyItems.push(item);
          }
        }
      }
      assert.equal(stack.length, 0, `Unclosed marked content on page ${number}`);
      assert.ok(bodyItems.length > 0, `Empty body on page ${number}`);
      assert.equal(footerItems.map(item => item.str).join(''), `Page ${number} of ${pdf.numPages}`);
      assert.ok(footerItems.every(item => item.transform[5] >= 20 && item.transform[5] <= 24), 'Footer clears the bottom edge and stays below body');
      body += bodyItems.map(item => item.str).join('');
    }
    let position = -1;
    for (const block of resumeBlocks(data)) {
      const next = compact(body).indexOf(compact(block.text), position + 1);
      assert.ok(next > position, `Missing or reordered PDF content: ${block.text}`);
      position = next;
    }
    for (const key of Object.keys(data.cv)) assert.equal((body.match(new RegExp(`${key} entry \\d{3}`, 'g')) ?? []).length, 12, `${key} entry count`);
    assert.equal((await pdf.getMetadata()).info.Title, `${data.name} — Curriculum Vitae`);
    assert.deepEqual((await pdf.getOutline()).map(item => item.title), headings);
  } finally { await pdf.loadingTask.destroy(); }
});

test('empty CV sections are omitted and short or long-name CVs do not gain footer-only pages', async () => {
  const data = { mode: 'cv', cv: { research: ' \n ', references: '' } };
  assert.deepEqual(resumeBlocks(data), []);
  assert.equal(buildMarkdown(data), '\n');
  for (const fixture of [data, { ...data, name: 'Alexandria Catherine Morgan Researcher with a long professional name', cv: { references: 'Dr. Robin Lee, Example University.' } }]) {
    const pdf = await openPdf(fixture);
    try {
      assert.equal(pdf.numPages, 1);
      const text = (await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str ?? '').join('');
      assert.match(text, /Page 1 of 1/);
      assert.equal((await pdf.getMetadata()).info.Title, fixture.name ? `${fixture.name} — Curriculum Vitae` : 'Curriculum Vitae');
      if (fixture.name) assert.ok(compact(text).includes(compact(fixture.name)));
    } finally { await pdf.loadingTask.destroy(); }
  }
});

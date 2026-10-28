import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDocx, buildMarkdown, buildText, resumeBlocks } from '../src/documents.js';

const example = {
  name: 'Renée García, Ph.D.', phone: '555-0100', email: 'renee@example.com', location: 'Montréal', website: '',
  summary: 'Materials scientist & researcher <polymer>.',
  experience: [{ company: 'Example Materials', dates: '2021–Present', roles: [
    { title: 'Director', dates: '2024–Present', description: 'Lead research.', bullets: '• Built a laboratory.\n\n- Developed new materials.\n* Mentored scientists.' },
    { title: 'Scientist', dates: '2021–2024', description: '', bullets: 'Studied polymers.' },
  ] }],
  education: [{ school: 'Example University', date: '2020', degree: 'Ph.D. Chemistry', details: 'Fellowship recipient.' }],
  publications: 'García, R. “Polymer research.” 2025.\nGarcía, R. “Earlier research.” 2022.',
  skills: 'Polymer synthesis\nStatistical analysis',
};

test('pasted control characters produce safe Word XML while preserving soft line breaks and accents', async () => {
  const input = { name: 'Rene\u0301e', summary: 'First\u000BSecond\u0001 kept\u000CThird' };
  const blocks = resumeBlocks(input);
  assert.equal(blocks[0].text, 'Renée');
  assert.equal(blocks[2].text, 'First\nSecond kept\nThird');
  const files = unzipSync(new Uint8Array(await (await buildDocx(input)).arrayBuffer()));
  const xml = strFromU8(files['word/document.xml']);
  assert.doesNotMatch(xml, /[\u0001\u000b\u000c]|&#(?:x0*[1bBcC]|0*(?:1|11|12));/);
  assert.equal((xml.match(/<w:br\/>/g) ?? []).length, 2);
});

test('one content sequence preserves manual text, roles, Unicode and section order', () => {
  const blocks = resumeBlocks(example);
  assert.deepEqual(blocks.filter((b) => b.kind === 'heading').map((b) => b.text), [
    'Summary of Qualifications', 'Professional Experience', 'Academic Credentials', 'Publications and Patents', 'Technical Expertise',
  ]);
  assert.equal(blocks.filter((b) => b.kind === 'company').length, 2);
  assert.equal(blocks.filter((b) => b.kind === 'role').length, 3);
  assert.deepEqual(blocks.filter((b) => b.kind === 'bullet').map((b) => b.text), [
    'Built a laboratory.', 'Developed new materials.', 'Mentored scientists.', 'Studied polymers.', 'Fellowship recipient.',
  ]);
  assert.equal(blocks.find((b) => b.kind === 'name').text, example.name);
  assert.equal(blocks.find((b) => b.kind === 'description').text, example.summary);
});

test('blank optional entries produce no headings, placeholder text, or empty bullets', () => {
  assert.deepEqual(resumeBlocks({ experience: [{ company: '', roles: [{ title: '', bullets: '\n - \n' }] }], education: [{}] }), []);
  assert.deepEqual(resumeBlocks({ name: 'A' }), [{ kind: 'name', text: 'A' }]);
  assert.throws(() => resumeBlocks({ name: { html: 'bad' } }), /must be text/);
});

test('DOCX is a real editable archive with exact margins, Word numbering, and safely escaped text', async () => {
  const blob = await buildDocx(example);
  assert.ok(blob.size > 1000);
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const xml = strFromU8(files['word/document.xml']);
  const numbering = strFromU8(files['word/numbering.xml']);
  const styles = strFromU8(files['word/styles.xml']);
  assert.match(xml, /Renée García, Ph.D./);
  assert.match(xml, /Materials scientist &amp; researcher &lt;polymer&gt;\./);
  assert.match(xml, /w:w="12240" w:h="15840"/);
  assert.match(xml, /w:top="720" w:right="1008" w:bottom="720" w:left="1152"/);
  assert.match(xml, /<w:smallCaps\/>/);
  assert.match(xml, /<w:keepNext\/>/);
  assert.match(xml, /<w:numPr>/);
  assert.match(styles, /w:ascii="Garamond"/);
  assert.match(numbering, /w:val="bullet"/);
  assert.match(numbering, /w:val="%1\)"/);
  assert.match(numbering, /w:left="720" w:hanging="360"/);
  assert.match(numbering, /w:left="540" w:hanging="360"/);
  assert.match(xml, /w:before="960"/);
  let position = -1;
  for (const block of resumeBlocks(example)) {
    const needle = block.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const next = xml.indexOf(needle, position + 1);
    assert.ok(next > position, `Missing or out-of-order content: ${block.kind}`);
    position = next;
  }
});

test('DOCX preserves user paragraph breaks in summary and role overview', async () => {
  const summary = 'First paragraph.\n\nSecond paragraph.';
  const description = 'First responsibility.\r\nSecond responsibility.';
  const data = { name: 'Alex Morgan', summary, experience: [{ company: 'Example', roles: [{ description }] }] };
  const blob = await buildDocx(data);
  const xml = strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))['word/document.xml']);
  assert.equal((xml.match(/<w:br\/>/g) ?? []).length, 3);
  assert.match(xml, /First paragraph\.<\/w:t>[\s\S]*?<w:br\/>[\s\S]*?<w:br\/>[\s\S]*?Second paragraph\./);
  assert.match(xml, /First responsibility\.<\/w:t>[\s\S]*?<w:br\/>[\s\S]*?Second responsibility\./);
  assert.equal(resumeBlocks(data).find((block) => block.kind === 'description').text, summary);
});

test('Markdown and plain text include all visible content in source order with stable headings and lists', () => {
  const markdown = buildMarkdown(example);
  const plain = buildText(example);
  assert.match(markdown, /# Renée García, Ph\.D\./);
  assert.match(markdown, /## Professional Experience/);
  assert.match(markdown, /### Example Materials \(2021–Present\)/);
  assert.match(markdown, /#### Director \(2024–Present\)/);
  assert.match(markdown, /- Built a laboratory\./);
  assert.match(markdown, /1\. García, R\./);
  assert.match(markdown, /2\. García, R\./);
  assert.match(plain, /• Built a laboratory\./);
  assert.match(plain, /2\) García, R\./);
  let position = -1;
  for (const block of resumeBlocks(example)) {
    const next = plain.indexOf(block.text, position + 1);
    assert.ok(next > position, `Plain-text missing or out-of-order ${block.kind}`);
    position = next;
  }
  assert.equal(buildMarkdown({ name: 'Only Name' }), '# Only Name\n');
  assert.equal(buildText({ name: 'Only Name' }), 'Only Name\n');
});

test('Markdown treats user syntax, HTML and entities as literal résumé text', () => {
  const data = {
    name: 'A * B [link](https://example.com)',
    summary: '# Heading\n<script>alert(1)</script> &copy;\n12. Item\n+ Another\n    Indented\n===',
    experience: [{ company: 'A | B', roles: [{ title: '`Engineer`', bullets: '[x] Result\n![image](https://example.com/x.png)' }] }],
  };
  const md = buildMarkdown(data);
  assert.ok(md.includes('# A \\* B \\[link\\](https://example.com)'));
  assert.ok(md.includes('\\# Heading  \n\\<script\\>alert(1)\\</script\\> &amp;copy;'));
  assert.ok(md.includes('12\\. Item'));
  assert.ok(md.includes('\\+ Another'));
  assert.ok(md.includes('&#32;&#32;&#32;&#32;Indented'));
  assert.ok(md.includes('\\=\\=\\='));
  assert.ok(md.includes('### A \\| B'));
  assert.ok(md.includes('#### \\`Engineer\\`'));
  assert.ok(md.includes('- \\[x\\] Result'));
  assert.ok(md.includes('- \\!\\[image\\](https://example.com/x.png)'));
  assert.ok(buildText(data).includes('<script>alert(1)</script> &copy;'));
});

test('Word name and section headings have semantic styles with the existing black Garamond formatting', async () => {
  const files = unzipSync(new Uint8Array(await (await buildDocx(example)).arrayBuffer()));
  const xml = strFromU8(files['word/document.xml']);
  const styles = strFromU8(files['word/styles.xml']);
  assert.equal((xml.match(/<w:pStyle w:val="Heading1"\/>/g) ?? []).length, 1);
  assert.equal((xml.match(/<w:pStyle w:val="Heading2"\/>/g) ?? []).length, 5);
  for (const [id, level, size] of [['Heading1', 0, 40], ['Heading2', 1, 26]]) {
    const style = styles.match(new RegExp(`<w:style[^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`))?.[0];
    assert.ok(style, `Missing ${id}`);
    assert.match(style, new RegExp(`<w:outlineLvl w:val="${level}"`));
    assert.match(style, /w:ascii="Garamond"/);
    assert.match(style, /<w:color w:val="000000"/);
    assert.match(style, new RegExp(`<w:sz w:val="${size}"`));
  }
  assert.doesNotMatch(xml, /<w:tbl>|<w:hdr>|<w:ftr>|<w:txbxContent>/);
});

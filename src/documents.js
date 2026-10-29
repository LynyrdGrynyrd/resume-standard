const text = (value = '') => {
  if (typeof value !== 'string') throw new TypeError('Résumé fields must be text.');
  // Word/PDF paste artifacts: preserve line breaks, exclude XML-invalid controls.
  return value.replace(/\r\n?/g, '\n').replace(/[\u000b\u000c]/g, '\n')
    .replace(/[\u0000-\u0008\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu, '').normalize('NFC').trim();
};
const lines = (value) => text(value).split(/\r?\n/)
  .map((line) => line.replace(/^\s*(?:[-*](?:\s+|$)|•\s*)/, '').trim()).filter(Boolean);
const dated = (value, dates) => [text(value), text(dates) && `(${text(dates)})`].filter(Boolean).join(' ');

export function resumeBlocks(data = {}) {
  const isCv = data.mode === 'cv';
  const blocks = [];
  const add = (kind, value, extra = {}) => {
    if (value) blocks.push({ kind, text: value, ...extra });
  };
  const section = (title, contents) => {
    if (contents.length) blocks.push({ kind: 'heading', text: title, keepWithNext: true }, ...contents);
  };
  add('contact', [data.phone, data.email, data.location, data.website].map((v) => text(v)).filter(Boolean).join(' | '));
  add('name', text(data.name));
  if (text(data.summary)) section(isCv ? 'Profile' : 'Summary of Qualifications', [{ kind: 'description', text: text(data.summary), indent: 0 }]);

  const experience = [];
  for (const job of data.experience ?? []) {
    const contents = [];
    for (const role of job.roles ?? []) {
      const details = [];
      if (text(role.description)) details.push({ kind: 'description', text: text(role.description) });
      details.push(...lines(role.bullets).map((value) => ({ kind: 'bullet', text: value })));
      const title = dated(role.title, role.dates);
      if (title) contents.push({ kind: 'role', text: title, keepWithNext: details.length > 0 });
      contents.push(...details);
    }
    const company = dated(job.company, job.dates);
    if (company) experience.push({ kind: 'company', text: company, keepWithNext: contents.length > 0, gapBefore: experience.length > 0 });
    experience.push(...contents);
  }
  const education = [];
  for (const item of data.education ?? []) {
    const contents = [];
    if (text(item.degree)) contents.push({ kind: 'role', text: text(item.degree), keepWithNext: lines(item.details).length > 0 });
    contents.push(...lines(item.details).map((value) => ({ kind: 'bullet', text: value })));
    const school = dated(item.school, item.date);
    if (school) education.push({ kind: 'company', text: school, keepWithNext: contents.length > 0, gapBefore: education.length > 0 });
    education.push(...contents);
  }
  const publications = lines(data.publications).map((value) => ({ kind: 'publication', text: value }));
  const skills = lines(data.skills).map((value) => ({ kind: 'skill', text: value }));
  if (isCv) {
    section('Education', education);
    section('Academic and Professional Appointments', experience);
    for (const { key, label } of CV_SECTIONS) {
      if (key === 'references') section('Research Skills', skills);
      section(label, lines(data.cv?.[key]).map(value => ({ kind: 'description', text: value, indent: 0 })));
      if (key === 'grants') section('Publications', publications);
    }
  } else {
    section('Professional Experience', experience);
    section('Academic Credentials', education);
    section('Publications and Patents', publications);
    section('Technical Expertise', skills);
  }
  return blocks;
}

export function buildText(data) {
  let publication = 0;
  return resumeBlocks(data).map(block => {
    if (block.kind === 'publication') return `${++publication}) ${block.text}`;
    if (['bullet', 'skill'].includes(block.kind)) return `• ${block.text}`;
    return block.text;
  }).join('\n\n') + '\n';
}

export function buildMarkdown(data) {
  const escape = value => value.replace(/&/g, '&amp;').replace(/[\\`*_{}\[\]<>#!|~+=-]/g, '\\$&')
    .replace(/^(\s*\d+)([.)])(?=\s|$)/gm, '$1\\$2')
    .replace(/^ +/gm, spaces => '&#32;'.repeat(spaces.length));
  let publication = 0;
  return resumeBlocks(data).map(block => {
    const heading = { name: '#', heading: '##', company: '###', role: '####' }[block.kind];
    const value = escape(block.text);
    if (heading) return `${heading} ${value.replace(/\n/g, ' ')}`;
    if (block.kind === 'publication') return `${++publication}. ${value}`;
    if (['bullet', 'skill'].includes(block.kind)) return `- ${value}`;
    return value.replace(/\n/g, '  \n');
  }).join('\n\n') + '\n';
}

export async function buildDocx(data) {
  const { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, LevelFormat, Packer, PageNumber, Paragraph, TextRun } = await import('docx');
  const isCv = data.mode === 'cv';
  const documentType = isCv ? 'Curriculum Vitae' : 'Résumé';
  const rule = { style: BorderStyle.SINGLE, size: 4, color: '000000', space: 1 };
  const children = resumeBlocks(data).map((block, index) => {
    const options = {
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 40 },
      keepNext: Boolean(block.keepWithNext),
      widowControl: true,
    };
    const run = { text: block.text };
    switch (block.kind) {
      case 'contact':
        options.alignment = AlignmentType.CENTER;
        options.spacing = { after: 160 };
        run.size = 20;
        break;
      case 'name':
        options.heading = HeadingLevel.HEADING_1;
        options.alignment = AlignmentType.CENTER;
        options.border = { top: rule, bottom: rule };
        options.spacing = { before: 80, after: 200 };
        run.size = 40;
        run.bold = true;
        run.smallCaps = true;
        break;
      case 'heading':
        options.heading = HeadingLevel.HEADING_2;
        options.spacing = { before: 140, after: 60 };
        run.size = 26;
        run.bold = true;
        break;
      case 'company':
        options.indent = { left: 360 };
        options.spacing = { before: block.gapBefore ? 120 : 0, after: 20 };
        run.underline = {};
        break;
      case 'role':
        options.indent = { left: 540 };
        options.spacing = { after: 20 };
        run.italics = true;
        break;
      case 'description':
        options.indent = { left: Math.round((block.indent ?? 28.8) * 20) };
        options.spacing = { after: 60 };
        break;
      case 'publication':
        options.numbering = { reference: 'publications', level: 0 };
        break;
      case 'skill':
        options.numbering = { reference: 'skills', level: 0 };
        break;
      default:
        options.numbering = { reference: 'bullets', level: 0 };
    }
    if (index === 0 && ['contact', 'name'].includes(block.kind)) options.spacing.before = (options.spacing.before ?? 0) + 960;
    return new Paragraph({ ...options, children: block.text.split(/\r?\n/).map((line, lineIndex) =>
      new TextRun({ ...run, text: line, break: lineIndex ? 1 : undefined })) });
  });
  const document = new Document({
    creator: 'Résumé Standard',
    title: text(data.name) ? `${text(data.name)} — ${documentType}` : documentType,
    styles: { default: {
      document: {
        run: { font: 'Garamond', size: 22, color: '000000' },
        paragraph: { spacing: { line: 240 }, widowControl: true },
      },
      heading1: { run: { font: 'Garamond', size: 40, color: '000000', bold: true, smallCaps: true }, paragraph: { outlineLevel: 0 } },
      heading2: { run: { font: 'Garamond', size: 26, color: '000000', bold: true }, paragraph: { outlineLevel: 1 } },
    } },
    numbering: { config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } }, run: { font: 'Garamond' } } }] },
      { reference: 'skills', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 893, hanging: 360 } }, run: { font: 'Garamond' } } }] },
      { reference: 'publications', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1)', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
    ] },
    sections: [{ properties: { page: {
      size: { width: 12240, height: 15840 },
      margin: { top: 720, right: 1008, bottom: 720, left: 1152, ...(isCv ? { footer: 360 } : {}) },
    } }, ...(isCv ? { footers: { default: new Footer({ children: [new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 0 },
      children: [new TextRun({ font: 'Garamond', size: 18, children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] })],
    })] }) } } : {}), children }],
  });
  return Packer.toBlob(document);
}
import { CV_SECTIONS } from './state.js';

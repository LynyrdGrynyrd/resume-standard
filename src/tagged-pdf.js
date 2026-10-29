import { PDFDocument } from 'pdfkit';
import { toBlob } from 'pdfkit/output';
import { resumeBlocks } from './documents.js';

const LEFT = 57.6, RIGHT = 50.4, TOP = 36, BOTTOM = 36, WIDTH = 612 - LEFT - RIGHT;
const PAGE_HEIGHT = 792 - TOP - BOTTOM;
const listKinds = new Set(['bullet', 'skill', 'publication']);

function style(block) {
  const result = { font: 'normal', size: 11, indent: 0, before: 0, after: 2, align: 'justify' };
  switch (block.kind) {
    case 'contact': return { ...result, size: 10, align: 'center', after: 8 };
    case 'name': return { ...result, font: 'bold', size: 20, align: 'center', before: 4.5, after: 14.5, features: ['smcp'] };
    case 'heading': return { ...result, font: 'bold', size: 13, before: 7, after: 3 };
    case 'company': return { ...result, indent: 18, before: block.gapBefore ? 6 : 0, after: 1, underline: true };
    case 'role': return { ...result, font: 'italics', indent: 27, after: 1 };
    case 'description': return { ...result, indent: block.indent ?? 28.8, after: 3 };
    case 'publication': return { ...result, indent: 27 };
    case 'skill': return { ...result, indent: 44.65 };
    default: return { ...result, indent: 36 };
  }
}

export async function buildTaggedPdf(data, fontBuffers) {
  const isCv = data.mode === 'cv';
  const documentType = isCv ? 'Curriculum Vitae' : 'Résumé';
  const blocks = resumeBlocks(data);
  const name = blocks.find(block => block.kind === 'name')?.text || '';
  const doc = new PDFDocument({
    size: 'LETTER', margins: { top: TOP, right: RIGHT, bottom: BOTTOM, left: LEFT },
    font: null, pdfVersion: '1.7', tagged: true, lang: 'en-US', displayTitle: true,
    bufferPages: isCv,
    info: { Title: name ? `${name} — ${documentType}` : documentType, Creator: 'Résumé Standard' },
  });
  for (const key of ['normal', 'bold', 'italics', 'bolditalics']) {
    if (!fontBuffers?.[key]) throw new Error(`Missing résumé font: ${key}`);
    doc.registerFont(key, new Uint8Array(fontBuffers[key]));
  }
  const output = toBlob(doc);
  const root = doc.struct('Document'); doc.addStructure(root);
  doc.y = TOP + (['contact', 'name'].includes(blocks[0]?.kind) ? 48 : 0);
  let list, listKind, publication = 0, reservedThrough = -1;
  const setFont = settings => doc.font(settings.font).fontSize(settings.size);
  const layout = blocks.map(block => {
    const settings = style(block); setFont(settings);
    const marker = listKinds.has(block.kind) ? (block.kind === 'publication' ? `${++publication})` : '•') : null;
    const labelWidth = marker ? Math.max(18, doc.widthOfString(marker) + 3) : 18;
    // Use the reference's compact leading ratio without shrinking 11pt body type.
    const lineHeight = settings.size * 1.12;
    const options = {
      width: WIDTH - settings.indent - (labelWidth - 18), align: settings.align,
      lineGap: lineHeight - doc.currentLineHeight(true), underline: settings.underline,
      // PDFKit measures justified words without spaces; cross-word shaping otherwise overfills lines.
      features: settings.features ?? { kern: false, liga: false, clig: false },
    };
    const text = settings.align === 'center' ? block.text : `${block.text} `;
    return { block, settings, marker, labelWidth, options, text,
      height: settings.before + doc.heightOfString(text, options) + settings.after,
      firstLineHeight: settings.before + lineHeight + settings.after };
  });
  const ensureSpace = needed => {
    if (needed <= PAGE_HEIGHT && doc.y + needed > 792 - BOTTOM) doc.addPage();
  };
  const rule = () => {
    doc.markContent('Artifact', { type: 'Layout' });
    doc.save().lineWidth(0.5).moveTo(LEFT, doc.y).lineTo(612 - RIGHT, doc.y).stroke().restore();
    doc.endMarkedContent();
  };
  for (let index = 0; index < blocks.length; index++) {
    const { block, settings, marker, labelWidth, options, text } = layout[index];
    let last = index, needed = layout[index].height;
    while (blocks[last].keepWithNext && last + 1 < blocks.length) needed += layout[++last].height;
    // PDFKit's page-fit check uses the font box, even with tighter baseline spacing.
    needed += Math.max(0, -layout[last].options.lineGap);
    // Oversized paragraphs may flow, but their headings must retain the first line.
    if (needed > PAGE_HEIGHT) {
      needed -= layout[last].height - layout[last].firstLineHeight;
      if (needed > PAGE_HEIGHT) needed = layout[index].firstLineHeight + Math.max(0, -options.lineGap);
    }
    // Keep the placement decision for the whole heading chain, including its first body item.
    if (index > reservedThrough) {
      if (index > 0) ensureSpace(needed);
      reservedThrough = last;
    }
    setFont(settings);
    if (block.kind === 'name') rule();
    doc.y += settings.before;
    if (listKinds.has(block.kind)) {
      if (listKind !== block.kind) { list = doc.struct('L'); root.add(list); listKind = block.kind; }
      const item = doc.struct('LI'); list.add(item);
      const x = LEFT + settings.indent - 18, y = doc.y;
      item.add(doc.struct('Lbl', () => doc.text(`${marker} `, x, y, { lineBreak: false })));
      item.add(doc.struct('LBody', () => doc.text(text, x + labelWidth, y, options)));
    } else {
      list = null; listKind = null;
      const tag = block.kind === 'name' ? 'H1' : block.kind === 'heading' ? 'H2' : 'P';
      if (block.kind === 'heading') doc.outline.addItem(block.text);
      root.add(doc.struct(tag, block.kind === 'name' ? { actual: block.text } : {}, () => {
        doc.text(text, LEFT + settings.indent, doc.y, options);
      }));
    }
    if (block.kind === 'name') { doc.y += 4; rule(); doc.y -= 4; }
    doc.y += settings.after;
  }
  if (isCv) {
    const { start, count } = doc.bufferedPageRange();
    for (let index = start; index < start + count; index++) {
      doc.switchToPage(index);
      doc.markContent('Artifact', { type: 'Pagination', attached: ['Bottom'] });
      doc.font('normal').fontSize(9);
      const label = `Page ${index + 1} of ${count}`;
      // Supplying width invokes PDFKit's page wrapper even with lineBreak disabled.
      doc.text(label, LEFT + (WIDTH - doc.widthOfString(label)) / 2, 762, { lineBreak: false });
      doc.endMarkedContent();
    }
  }
  doc.end();
  return output;
}

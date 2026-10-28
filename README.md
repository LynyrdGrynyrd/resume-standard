# Résumé Standard

A manual-entry résumé builder with one classic Garamond template. Fill in the form, preview the actual PDF, and download a PDF, editable Word document, Markdown or plain text. No AI, network uploads, accounts, or server-side résumé storage.

Layout inspired by Phil Costanzo’s résumé template.

## Run

Node 22.12+ or 24, and npm:

```sh
npm ci
npm run dev
```

## Host on Netlify

Connect this project to Netlify. `netlify.toml` supplies the settings:

- Build command: `npm run build`
- Publish directory: `dist`
- Node: 22
- No environment secrets or backend services required.

Alternatively, run `npm run build` and upload the contents of `dist` through Netlify's manual deploy flow. Only publish `dist`, never the project directory, `.local`, or test results.

## Behavior

- One template: Garamond styling, centered small-cap name between thin rules, underlined employers, italic roles, indented bullets, US Letter.
- Sections: contact, qualifications, professional experience (multiple roles per employer), academic credentials, publications/patents, technical expertise. Empty sections are omitted. Entries can be added, removed, and reordered.
- Dates use month pickers or year dropdowns, with current-employment/current-role and expected-graduation checkboxes. Custom date wording remains available. Existing drafts retain their original strings until you edit them. Known reversed ranges block downloads with an error. Separate role dates are collapsed when empty.
- Education offers conventional degree types plus field of study, or custom wording for any other qualification.
- Accomplishments have individual fields with add, move and remove buttons. Paste multiple lines to create multiple fields. Up to 200 fields / 30,000 characters per role; oversized pastes are refused without truncation. Existing larger lists retain the original multiline editor.
- Employers can be collapsed with a company/role/date summary and reopened. A pre-download checklist links to missing names, titles and contact details; it does not demand optional content or block otherwise valid downloads.
- Save a résumé file (`.resume.json`) to back up or move between devices, then open it in this app. Files use a versioned format and a 5 MiB limit; validation happens before replacement confirmation. Invalid files leave current work intact. These files contain personal details, so store them privately. Opening a file is local and never uploads it.
- Markdown and plain-text exports use the same résumé content. Copy as text has a selected-text fallback if clipboard access is unavailable. These are additional formats for compatible tools; they are not a promise of application-portal support or ranking gains.
- PDF and preview share the same PDF bytes, with selectable text and automatic pagination. Ordinary accomplishments and citations stay together on a page; entries too long to fit with their headings flow across pages. All PDF fonts are bundled locally. No external font or analytics requests.
- PDFKit generates real PDF heading, paragraph and list tags with logical reading order, document language and section bookmarks. Decorative rules are artifacts. Word uses semantic heading styles. Tests verify text extraction and tagged content, but this is not PDF/UA certification or screen-reader validation.
- Word uses native text, paragraphs, and list numbering with Garamond specified. Word's font substitution and pagination can differ from the PDF. Check the Word document before sending.
- The PDF uses openly licensed EB Garamond rather than redistributing Microsoft's Garamond. Characters absent from that font are identified and PDF export is disabled, rather than dropping them silently; Word export remains available.
- Draft saving uses this browser's localStorage. It can be disabled; clearing a draft asks for confirmation. Anyone using the same browser profile can access its saved draft. There is no account sync or server backup. Clearing browser data removes the draft.
- If another tab changes the saved draft, this tab stops saving and keeps its current text. You can download it or explicitly replace the stored draft. Oversized pastes are refused with a message rather than silently truncated.
- Example and test data are fictional. Personal résumés, generated documents, and internal review notes are excluded from this repository.

## Checks

```sh
npm test
npm run build
npm run test:e2e
```

Browser tests use installed Microsoft Edge on Windows. On another OS, change `channel: 'msedge'` in `playwright.config.js` to your installed browser or install Playwright Chromium and remove the channel setting. Tests cover document structure and extraction, manual-entry downloads, long documents, safe file import/backup, clipboard fallback, accomplishment editing, checklist focus, draft failures, injection, mobile layout, and the Netlify content security policy. Visual verification is separate from these assertions.

## Structure

`src/documents.js` builds shared content plus Word, Markdown and text exports. `src/tagged-pdf.js` renders the tagged PDF. `src/main.js` owns the form, local saving, preview, and downloads. `src/state.js` defines the data shape and portable-file validation; `src/review.js` supplies pre-download checks. Font files and their licence/provenance are in `public/fonts`; `src/font-coverage.json` is the intersection of their Unicode cmap coverage.

Useful upstream references: [PDFKit accessibility](https://pdfkit.org/docs/accessibility.html), [docx Packer](https://docx.js.org/api/classes/index.Packer.html), [EB Garamond source](https://github.com/octaviopardo/EBGaramond12).

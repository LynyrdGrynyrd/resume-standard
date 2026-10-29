import './style.css';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { buildDocx, buildMarkdown, buildText, resumeBlocks } from './documents.js';
import { buildTaggedPdf } from './tagged-pdf.js';
import { STORAGE_KEY, emptyResume, newExperience, newRole, newEducation, readDraft, hasContent, filename, exampleResume, exampleCv, CV_SECTIONS, serializeResumeFile, parseResumeFile, MAX_RESUME_FILE_BYTES } from './state.js';
import { reviewIssues } from './review.js';
import { unsupportedCharacters } from './font-check.js';
import { parseDates, formatDates, dateError, DEGREE_TYPES, parseDegree, formatDegree } from './form-values.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
let fontPromise;
function loadFonts() {
  return fontPromise ??= Promise.all(Object.entries({ normal: 'Regular', bold: 'Bold', italics: 'Italic', bolditalics: 'BoldItalic' }).map(async ([key, name]) => {
    const response = await fetch(new URL(`fonts/EBGaramond-${name}.ttf`, document.baseURI));
    if (!response.ok) throw new Error('Could not load the résumé fonts. Please retry.');
    return [key, await response.arrayBuffer()];
  })).then(Object.fromEntries).catch(error => { fontPromise = null; throw error; });
}

const $ = selector => document.querySelector(selector);
let data = emptyResume();
let saveBlocked = false;
let draftSaved = false;
let lastSaved = null;
let step = 0;
let revision = 0;
let pdfDocument;
let pdfBlob;
let currentPage = 1;
let previewTimer;
let renderSequence = 0;
let rendering = false;
let fileReadSequence = 0;
let openEmployer = null;
let openRole = null;

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  lastSaved = saved;
  if (saved) { data = readDraft(saved); draftSaved = true; $('#save-status').textContent = 'Saved draft restored from this browser.'; }
} catch {
  saveBlocked = true;
  $('#remember').checked = false;
  $('#save-status').textContent = 'Browser storage unavailable or draft unreadable. Existing data has not been overwritten. Download your work before leaving.';
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(text, className, action) {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function field(target, key, label, options = {}) {
  const wrapper = element('label', `field ${options.wide ? 'wide' : ''}`);
  wrapper.append(element('span', 'field-label', label));
  const control = element(options.multiline ? 'textarea' : 'input');
  control.value = target[key];
  control.name = key;
  control.maxLength = options.multiline ? 30000 : 500;
  const pasteError = element('span', 'field-hint');
  pasteError.setAttribute('role', 'alert');
  pasteError.hidden = true;
  control.placeholder = options.placeholder || '';
  if (options.multiline) control.rows = options.rows || 4;
  else control.type = options.type || 'text';
  if (options.autocomplete) control.autocomplete = options.autocomplete;
  control.addEventListener('paste', event => {
    const pasted = event.clipboardData?.getData('text');
    const selected = (control.selectionEnd ?? 0) - (control.selectionStart ?? 0);
    if (pasted && control.value.length - selected + pasted.length > control.maxLength) {
      event.preventDefault();
      pasteError.textContent = `This paste exceeds the ${control.maxLength.toLocaleString()}-character limit. Nothing was pasted. Shorten the text and try again.`;
      pasteError.hidden = false;
    }
  });
  control.addEventListener('input', () => { pasteError.hidden = true; target[key] = control.value; options.onInput?.(); changed(); });
  wrapper.append(control);
  wrapper.append(pasteError);
  if (options.hint) wrapper.append(element('span', 'field-hint', options.hint));
  return wrapper;
}

function selectField(label, options, value, onChange) {
  const wrapper = element('label', 'field');
  wrapper.append(element('span', 'field-label', label));
  const select = element('select');
  for (const [key, title] of options) select.add(new Option(title, key));
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  wrapper.append(select);
  return wrapper;
}

function checkField(label, checked, onChange) {
  const wrapper = element('label', 'check-label date-check');
  const input = element('input'); input.type = 'checkbox'; input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  wrapper.append(input, document.createTextNode(label));
  return wrapper;
}

function dateField(target, key, title, { range = true, currentLabel = 'I currently work here' } = {}) {
  const group = element('fieldset', 'date-fields');
  group.append(element('legend', '', title));
  const body = element('div'); group.append(body);
  let parts = parseDates(target[key], { range });
  const error = element('p', 'date-error'); error.setAttribute('role', 'alert');
  const showError = () => { error.textContent = dateError(target[key], { range }); error.hidden = !error.textContent; };
  const commit = () => { target[key] = formatDates(parts, { range }); showError(); changed(); };
  function renderDates() {
    body.replaceChildren();
    body.append(selectField('Date format', [['month', 'Month and year'], ['year', 'Year only'], ['custom', 'Custom text']], parts.format, format => {
      const old = parseDates(target[key], { range });
      if (format === 'year' && old.format === 'month' && (old.start || old.end) && !confirm('Switch to year only and remove the months from these dates?')) { renderDates(); body.querySelector('select').focus(); return; }
      if (format !== 'custom' && target[key] && (old.format === 'custom' || (old.format === 'year' && format === 'month'))) {
        if (!confirm('Switch to date pickers and replace these dates? You will need to select new dates; no missing months will be guessed.')) { renderDates(); body.querySelector('select').focus(); return; }
        parts = { ...old, format, start: '', end: '' };
      } else {
        parts = { ...old, format };
        if (format === 'year') { parts.start = parts.start.slice(0, 4); parts.end = parts.end.slice(0, 4); }
      }
      if (format !== 'custom') commit();
      renderDates(); body.querySelector('select').focus();
    }));
    if (parts.format === 'custom') {
      body.append(field(target, key, 'Dates as written', { placeholder: range ? '2021 – Present' : 'Expected Fall 2027', hint: 'Use your own wording. It will appear as written.', onInput: showError }));
    } else {
      const grid = element('div', 'field-grid');
      const picker = (key, label) => {
        if (parts.format === 'year') {
          const years = new Set(Array.from({ length: new Date().getFullYear() + 11 - 1900 }, (_, index) => String(1900 + index)));
          if (parts[key]) years.add(parts[key]);
          return selectField(label, [['', 'Select year'], ...[...years].sort().reverse().map(year => [year, year])], parts[key], value => { parts[key] = value; commit(); });
        }
        const wrapper = element('label', 'field');
        wrapper.append(element('span', 'field-label', label));
        const input = element('input'); input.type = 'month'; input.value = parts[key];
        input.min = '0001-01'; input.max = '9999-12';
        input.addEventListener('change', () => {
          if (!input.checkValidity()) {
            input.value = parts[key];
            error.textContent = 'Enter a valid month and four-digit year. Your previous date has been kept.';
            error.hidden = false; return;
          }
          parts[key] = input.value; commit();
        });
        wrapper.append(input); return wrapper;
      };
      grid.append(picker('start', range ? 'Start date' : 'Graduation date'));
      let endControl;
      if (range) {
        const end = picker('end', 'End date');
        endControl = end.querySelector('input, select'); endControl.disabled = parts.current;
        grid.append(end);
      }
      body.append(grid, range
        ? checkField(currentLabel, parts.current, checked => { parts.current = checked; endControl.disabled = checked; commit(); })
        : checkField('Expected graduation', parts.expected, checked => { parts.expected = checked; commit(); }));
    }
    showError(); body.append(error);
  }
  renderDates(); return group;
}

function degreeField(school) {
  const group = element('div', 'degree-fields');
  let parts = parseDegree(school.degree);
  function renderDegree() {
    group.replaceChildren();
    group.append(selectField('Degree type', [['', 'Select a qualification'], ...DEGREE_TYPES.map(type => [type, type]), ['custom', 'Other / custom wording']], parts.type, type => {
      if (parts.type === 'custom' && type !== 'custom' && school.degree && !confirm('Replace your custom qualification with the selected degree type?')) { renderDegree(); group.querySelector('select').focus(); return; }
      const subject = type === 'custom' ? school.degree : parts.type === 'custom' ? '' : parts.subject;
      parts = { type, subject };
      school.degree = formatDegree(type, subject); changed(); renderDegree(); group.querySelector('select').focus();
    }));
    if (parts.type === 'custom') group.append(field(school, 'degree', 'Degree or qualification', { placeholder: 'Your qualification, exactly as you want it written' }));
    else group.append(field(parts, 'subject', 'Field of study (optional)', { placeholder: 'Chemistry, Business Administration…', onInput: () => { school.degree = formatDegree(parts.type, parts.subject); } }));
  }
  renderDegree(); return group;
}

function resumeDateError() {
  for (const [index, job] of data.experience.entries()) {
    if (dateError(job.dates)) return `Employer ${index + 1}: ${dateError(job.dates)}`;
    for (const [roleIndex, role] of job.roles.entries()) {
      if (dateError(role.dates)) return `Employer ${index + 1}, role ${roleIndex + 1}: ${dateError(role.dates)}`;
    }
  }
  return '';
}

function accomplishmentFields(role) {
  let values = role.bullets.split(/\r\n?|\n/);
  // shortcut: unusually large legacy lists use the existing text editor to avoid thousands of controls.
  if (values.length > 200) return field(role, 'bullets', 'Accomplishments', { multiline: true, hint: 'Large list: one accomplishment per line.' });
  const group = element('fieldset', 'accomplishments');
  group.append(element('legend', '', 'Accomplishments'), element('p', 'field-hint', 'One result per field. Paste several lines to add them together.'));
  const rows = element('div');
  const error = element('p', 'date-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  const withinLimits = next => {
    if (next.length > 200 || next.join('\n').length > 30000) {
      error.textContent = 'Keep this role to 200 accomplishments and 30,000 characters. Nothing was added.';
      error.hidden = false; return false;
    }
    return true;
  };
  const commit = next => {
    if (!withinLimits(next)) return false;
    values = next; role.bullets = values.join('\n'); error.hidden = true; changed(); return true;
  };
  function render(focusIndex, caret) {
    rows.replaceChildren();
    values.forEach((value, index) => {
      const row = element('div', 'accomplishment-row');
      const label = element('label', 'field'); label.append(element('span', 'field-label', `Accomplishment ${index + 1}`));
      const input = element('textarea'); input.rows = 2; input.value = value; input.maxLength = 30000;
      input.placeholder = 'Describe a result you achieved'; label.append(input);
      input.addEventListener('input', () => {
        if (!input.isConnected) return;
        const beforeCaret = input.value.slice(0, input.selectionStart).split(/\r\n?|\n/);
        const next = [...values]; next.splice(index, 1, ...input.value.split(/\r\n?|\n/));
        if (!commit(next)) input.value = values[index];
        else if (next.length !== rows.children.length) render(index + beforeCaret.length - 1, beforeCaret.at(-1).length);
      });
      input.addEventListener('paste', event => {
        if (!input.isConnected) return;
        const pasted = event.clipboardData?.getData('text');
        if (!pasted) return;
        const combined = input.value.slice(0, input.selectionStart) + pasted + input.value.slice(input.selectionEnd);
        const additions = combined.split(/\r\n?|\n/);
        const next = [...values]; next.splice(index, 1, ...additions);
        if (!withinLimits(next)) { event.preventDefault(); return; }
        if (!/[\r\n]/.test(pasted)) return;
        event.preventDefault();
        const beforeCaret = (input.value.slice(0, input.selectionStart) + pasted).split(/\r\n?|\n/);
        if (commit(next)) render(index + beforeCaret.length - 1, beforeCaret.at(-1).length);
      });
      const actions = element('div', 'entry-actions');
      for (const [direction, symbol] of [[-1, '↑'], [1, '↓']]) {
        const move = button(symbol, 'icon-button', () => {
          const next = [...values]; [next[index], next[index + direction]] = [next[index + direction], next[index]];
          if (commit(next)) render(index + direction);
        });
        move.setAttribute('aria-label', `Move accomplishment ${index + 1} ${direction < 0 ? 'up' : 'down'}`);
        move.disabled = index + direction < 0 || index + direction >= values.length; actions.append(move);
      }
      const remove = button('Remove', 'text-button remove', () => {
        if (values[index].trim() && !confirm('Remove this accomplishment?')) return;
        const next = values.filter((_, i) => i !== index);
        if (commit(next.length ? next : [''])) render(Math.min(index, values.length - 1));
      });
      remove.setAttribute('aria-label', `Remove accomplishment ${index + 1}`); actions.append(remove);
      row.append(label, actions); rows.append(row);
    });
    add.disabled = values.length >= 200;
    const focused = focusIndex === undefined ? null : rows.querySelectorAll('textarea')[focusIndex];
    if (focused) { focused.focus(); focused.setSelectionRange(caret ?? focused.value.length, caret ?? focused.value.length); }
  }
  const add = button('+ Add accomplishment', 'text-button', () => { if (commit([...values, ''])) render(values.length - 1); });
  group.append(rows, error, add); render(); return group;
}

function employerSummary(job, index) {
  return [job.company.trim() || `Employer ${index + 1}`, job.dates.trim(), `${job.roles.length} ${job.roles.length === 1 ? 'role' : 'roles'}`].filter(Boolean).join(' · ');
}

function roleSummary(role, index) {
  const count = role.bullets.split(/\r?\n/).filter(line => line.trim()).length;
  return [role.title.trim() || `Role ${index + 1}`, role.dates.trim(), `${count} ${count === 1 ? 'accomplishment' : 'accomplishments'}`].filter(Boolean).join(' · ');
}

function updateChecks() {
  const issues = reviewIssues(data);
  $('#check-count').textContent = issues.length ? `— ${issues.length} ${issues.length === 1 ? 'detail' : 'details'} to review` : '— no missing essentials';
  $('#check-list').replaceChildren(...issues.map(issue => {
    const item = element('li');
    item.append(button(issue.message, 'text-button', () => {
      step = issue.step;
      if (issue.employer !== undefined) openEmployer = data.experience[issue.employer];
      if (issue.role !== undefined) openRole = openEmployer.roles[issue.role];
      renderEditor();
      let scope = $('#editor');
      if (issue.employer !== undefined) scope = scope.querySelectorAll('.entry-card')[issue.employer];
      if (issue.role !== undefined) scope = scope.querySelectorAll('.role-card')[issue.role];
      if (issue.education !== undefined) scope = scope.querySelectorAll('.entry-card')[issue.education];
      let control;
      if (issue.field === 'dates') {
        const details = scope.querySelector('.optional-dates');
        if (issue.role !== undefined && details) details.open = true;
        control = scope.querySelector('.date-fields input, .date-fields textarea, .date-fields select');
      } else control = scope.querySelector(`[name="${issue.field}"]`);
      control?.focus(); control?.scrollIntoView({ block: 'center' });
    })); return item;
  }));
  if (!issues.length) $('#check-list').append(element('li', '', 'Your contact and entry details look complete. Read through your wording before sending.'));
}

function entryActions(list, index, label) {
  const actions = element('div', 'entry-actions');
  for (const [direction, symbol] of [[-1, '↑'], [1, '↓']]) {
    const move = button(symbol, 'icon-button', () => {
      [list[index], list[index + direction]] = [list[index + direction], list[index]];
      changed(); renderEditor(); $('#editor').focus();
    });
    move.setAttribute('aria-label', `Move ${label} ${direction < 0 ? 'up' : 'down'}`);
    move.disabled = index + direction < 0 || index + direction >= list.length;
    actions.append(move);
  }
  actions.append(button('Remove', 'text-button remove', () => {
    if (hasContent(list[index]) && !confirm(`Remove ${label} and its details?`)) return;
    list.splice(index, 1); changed(); renderEditor(); $('#editor').focus();
  }));
  return actions;
}

function renderEditor() {
  const editor = $('#editor');
  editor.replaceChildren();
  const cv = data.mode === 'cv';
  const titles = ['Contact details', cv ? 'Appointments and employment' : 'Work experience', 'Education', cv ? 'Academic sections' : 'Additional details'];
  const descriptions = ['Your name is needed to download. Include the contact details you want readers to use.', 'Open an employer, then a role, to edit. Add your most recent work first.', 'Add your degrees or qualifications. Include your thesis and advisor in the details if relevant.', cv ? 'Open the sections you need. Empty sections stay off your CV.' : 'These sections are optional. Empty sections stay off your résumé.'];
  $('#document-heading').textContent = cv ? 'Build your academic CV.' : 'Build your résumé.';
  $('#mode-help').textContent = cv ? 'Education first, with optional academic sections. Switching keeps every entry.' : 'Your classic résumé format. Switching keeps every entry, including CV sections.';
  $('#text-preview-label').textContent = cv ? 'Read CV as text' : 'Read résumé as text';
  $('#preview-panel').setAttribute('aria-label', cv ? 'CV preview' : 'Résumé preview');
  $('#save-file').textContent = cv ? 'Save CV file' : 'Save résumé file';
  $('#open-file').textContent = cv ? 'Open résumé or CV file' : 'Open résumé file';
  document.querySelectorAll('[name=document-mode]').forEach(control => { control.checked = control.value === data.mode; });
  editor.append(element('h3', '', titles[step]), element('p', 'section-description', descriptions[step]));
  if (step === 0) {
    const grid = element('div', 'field-grid');
    grid.append(
      field(data, 'name', 'Full name & credentials', { wide: true, placeholder: 'Alex Morgan, MBA', autocomplete: 'name' }),
      field(data, 'email', 'Email', { type: 'email', placeholder: 'alex@example.com', autocomplete: 'email' }),
      field(data, 'phone', 'Phone', { type: 'tel', placeholder: '(216) 555-0142', autocomplete: 'tel' }),
      field(data, 'location', 'Location', { placeholder: 'Cleveland, OH', autocomplete: 'address-level2' }),
      field(data, 'website', 'LinkedIn or website', { placeholder: 'linkedin.com/in/your-name' }),
      field(data, 'summary', cv ? 'Profile (optional)' : 'Summary of qualifications', { wide: true, multiline: true, rows: 7, placeholder: 'Describe your experience, strengths, and the work you do best.', hint: 'Optional. Shared between your résumé and CV.' }),
    );
    editor.append(grid);
  }
  if (step === 1) {
    if (!data.experience.includes(openEmployer)) openEmployer = data.experience.find(job => !hasContent(job)) ?? null;
    if (openEmployer && !openEmployer.roles.includes(openRole)) openRole = openEmployer.roles.find(role => !hasContent(role)) ?? null;
    data.experience.forEach((job, index) => {
      const card = element('fieldset', 'entry-card');
      card.append(element('legend', '', `Employer ${index + 1}`));
      const details = element('details', 'employer-details'); details.open = openEmployer === job;
      const summary = element('summary', 'employer-summary', employerSummary(job, index));
      details.addEventListener('toggle', () => {
        if (!details.isConnected) return;
        if (details.open) {
          openEmployer = job;
          editor.querySelectorAll('.employer-details').forEach(other => { if (other !== details) other.open = false; });
        } else if (openEmployer === job) openEmployer = null;
      });
      const body = element('div', 'employer-body'); details.append(summary, body); card.append(details);
      body.append(entryActions(data.experience, index, `employer ${index + 1}`));
      body.append(field(job, 'company', 'Employer', { placeholder: 'Company or organization' }), dateField(job, 'dates', 'Employment dates'));
      job.roles.forEach((role, roleIndex) => {
        const roleCard = element('fieldset', 'role-card');
        roleCard.append(element('legend', '', `Role ${roleIndex + 1}`));
        const roleDetails = element('details', 'role-details'); roleDetails.open = openRole === role;
        const roleHeading = element('summary', 'role-summary', roleSummary(role, roleIndex));
        roleDetails.addEventListener('toggle', () => {
          if (!roleDetails.isConnected) return;
          if (roleDetails.open) {
            openRole = role;
            editor.querySelectorAll('.role-details').forEach(other => { if (other !== roleDetails) other.open = false; });
          } else if (openRole === role) openRole = null;
        });
        const roleBody = element('div', 'role-body');
        roleBody.append(entryActions(job.roles, roleIndex, `role ${roleIndex + 1}`));
        const roleDates = element('details', 'optional-dates'); roleDates.open = Boolean(role.dates);
        roleDates.append(element('summary', '', 'Role dates (optional)'), dateField(role, 'dates', 'Role dates', { currentLabel: 'I currently hold this role' }));
        roleBody.append(field(role, 'title', 'Job title', { placeholder: cv ? 'Assistant Professor, Research Fellow…' : 'Operations Manager' }), roleDates, field(role, 'description', 'Role overview (optional)', { multiline: true, rows: 3, placeholder: 'Your scope, responsibilities, or team.' }), accomplishmentFields(role));
        roleBody.append(button('Done editing this role', 'button secondary collapse-role', () => { roleDetails.open = false; openRole = null; roleHeading.focus(); }));
        roleDetails.append(roleHeading, roleBody); roleCard.append(roleDetails);
        body.append(roleCard);
      });
      const addRole = button('+ Add another role here', 'text-button', () => {
        const role = newRole(); job.roles.push(role); openEmployer = job; openRole = role; changed(); renderEditor();
        document.querySelectorAll('.entry-card')[index].querySelectorAll('input[name=title]')[job.roles.length - 1].focus();
      });
      addRole.disabled = job.roles.length >= 20;
      body.append(addRole, button('Done editing this employer', 'button secondary collapse-employer', () => { details.open = false; openEmployer = null; summary.focus(); })); editor.append(card);
    });
    const addJob = button('+ Add employer', 'button add-button', () => {
      const job = newExperience(); data.experience.push(job); openEmployer = job; openRole = job.roles[0]; changed(); renderEditor();
      $('#editor > fieldset:last-of-type input[name=company]').focus();
    });
    addJob.disabled = data.experience.length >= 50; editor.append(addJob);
  }
  if (step === 2) {
    data.education.forEach((school, index) => {
      const card = element('fieldset', 'entry-card');
      card.append(element('legend', '', `Education ${index + 1}`), entryActions(data.education, index, `education ${index + 1}`));
      card.append(field(school, 'school', 'School or institution', { placeholder: 'University name' }), degreeField(school), dateField(school, 'date', 'Graduation', { range: false }), field(school, 'details', 'Additional details (optional)', { multiline: true, placeholder: 'Concentration, honors, thesis, or activities', hint: 'One bullet per line.' }));
      editor.append(card);
    });
    const addSchool = button('+ Add education', 'button add-button', () => {
      data.education.push(newEducation()); changed(); renderEditor();
      $('#editor > fieldset:last-of-type input[name=school]').focus();
    });
    addSchool.disabled = data.education.length >= 30; editor.append(addSchool);
  }
  if (step === 3 && !cv) {
    editor.append(field(data, 'publications', 'Publications and patents', { multiline: true, rows: 8, placeholder: 'Author(s). Title. Publication or patent number. Year.', hint: 'One entry per line. Entries are numbered automatically.' }), field(data, 'skills', 'Technical expertise', { multiline: true, rows: 7, placeholder: 'Operations: Production planning, inventory management\nTools: Excel, Power BI, ERP systems', hint: 'One bullet per line. Group related skills if useful.' }));
  }
  if (step === 3 && cv) {
    const academicField = (target, key, label, hint, rows = 5) => {
      const details = element('details', 'academic-section');
      const summary = element('summary', '', label);
      const status = element('span', 'section-state', target[key].trim() ? 'Added' : 'Optional');
      summary.append(status);
      details.append(summary, field(target, key, label, { multiline: true, rows, hint, onInput: () => { status.textContent = target[key].trim() ? 'Added' : 'Optional'; } }));
      editor.append(details);
    };
    const hints = {
      researchInterests: 'Your research areas or questions. Use your own wording.',
      research: 'One project per line. Include your role, institution, dates, methods and outcomes.',
      teaching: 'One course or mentoring activity per line. Include institution, role and dates.',
      grants: 'One award per line. Include funder, project, dates, your role and amount if relevant.',
      patents: 'One patent per line. Include inventors, title, patent number, year and status.',
      presentations: 'One talk or poster per line. Include title, event, date and whether invited.',
      honors: 'One honor per line, with awarding organization and year.',
      service: 'One committee, editorial, reviewing or outreach role per line, with dates.',
      affiliations: 'One professional society or membership per line, with role and dates.',
      references: 'One reference per line. Include name, title, institution and agreed contact details.',
    };
    for (const { key, label } of CV_SECTIONS) {
      if (key === 'patents') academicField(data, 'publications', 'Publications', 'One complete citation per line, most recent first. Include publication status where relevant. Shared with the résumé publications field.', 8);
      if (key === 'references') academicField(data, 'skills', 'Research Skills', 'One skill group per line. Methods, tools and languages. Shared with résumé technical expertise.');
      academicField(data.cv, key, label, hints[key], key === 'researchInterests' ? 3 : 5);
    }
  }
  document.querySelectorAll('[data-step]').forEach(node => {
    node.querySelector('.step-name').textContent = ['Basics', cv ? 'Roles' : 'Experience', 'Education', cv ? 'Academic' : 'More'][Number(node.dataset.step)];
    if (Number(node.dataset.step) === step) node.setAttribute('aria-current', 'step');
    else node.removeAttribute('aria-current');
  });
  $('#back').disabled = step === 0;
  $('#next').textContent = [cv ? 'Appointments →' : 'Experience →', 'Education →', cv ? 'Academic sections →' : 'More details →', 'Review & download →'][step];
}

function draftConflict() {
  draftSaved = false;
  saveBlocked = true;
  $('#remember').checked = false;
  $('#save-status').textContent = 'The saved draft changed in another tab. Your details here are kept. Download them, or turn saving back on to replace the saved draft.';
}

function save() {
  draftSaved = false;
  if (!$('#remember').checked || saveBlocked) return;
  try {
    if (localStorage.getItem(STORAGE_KEY) !== lastSaved) { draftConflict(); return; }
    const serialized = hasContent(data) ? JSON.stringify(data) : null;
    if (serialized) localStorage.setItem(STORAGE_KEY, serialized);
    else localStorage.removeItem(STORAGE_KEY);
    lastSaved = serialized;
    draftSaved = true;
    $('#save-status').textContent = 'Draft saved on this device. Nothing is uploaded.';
  } catch {
    $('#save-status').textContent = 'Could not save in this browser. Download your work before leaving.';
  }
}

function changed() {
  revision++;
  renderSequence++;
  save();
  updateChecks();
  $('#copy-fallback-label').hidden = true; $('#copy-fallback').value = '';
  $('#text-export-status').textContent = '';
  document.querySelectorAll('.employer-summary').forEach((summary, index) => {
    if (data.experience[index]) summary.textContent = employerSummary(data.experience[index], index);
    summary.parentElement.querySelectorAll('.role-summary').forEach((roleHeading, roleIndex) => {
      if (data.experience[index]?.roles[roleIndex]) roleHeading.textContent = roleSummary(data.experience[index].roles[roleIndex], roleIndex);
    });
  });
  $('#download-pdf').disabled = true;
  $('#download-docx').disabled = !data.name.trim() || Boolean(resumeDateError());
  $('#preview').setAttribute('aria-busy', 'true');
  $('#preview-status').textContent = 'Updating preview…';
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 450);
}

async function showPage() {
  const sequence = ++renderSequence;
  const activeDocument = pdfDocument;
  if (!activeDocument) return;
  $('#page-count').textContent = `Page ${currentPage} of ${activeDocument.numPages}`;
  $('#previous-page').disabled = currentPage === 1;
  $('#next-page').disabled = currentPage === activeDocument.numPages;
  const page = await activeDocument.getPage(currentPage);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${data.mode === 'cv' ? 'CV' : 'Résumé'} preview page ${currentPage}. Use the text view below for accessible text.`);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  if (sequence === renderSequence && activeDocument === pdfDocument) $('#preview').replaceChildren(canvas);
}

async function updatePreview() {
  if (rendering) return;
  rendering = true;
  const requestedRevision = revision;
  const snapshot = structuredClone(data);
  $('#download-docx').disabled = !snapshot.name.trim() || Boolean(resumeDateError());
  try {
    const dateIssue = resumeDateError();
    if (dateIssue) {
      renderSequence++;
      $('#preview').replaceChildren(element('p', 'preview-placeholder', 'Check your date range.'));
      $('#preview-status').textContent = 'Correct the dates to update your document.';
      $('#export-status').textContent = dateIssue;
      $('#preview').setAttribute('aria-busy', 'false');
      $('#previous-page').disabled = true; $('#next-page').disabled = true;
      $('#download-pdf').disabled = true; $('#download-docx').disabled = true;
      $('#page-count').textContent = 'Check dates';
      return;
    }
    const blocks = resumeBlocks(snapshot);
    $('#preview-text').replaceChildren(...blocks.map(block => element(block.kind === 'heading' ? 'h3' : 'p', '', block.text)));
    const normalizedName = blocks.find(block => block.kind === 'name')?.text || '';
    const missing = unsupportedCharacters(blocks.map(block => block.text).join('\n') + normalizedName.toUpperCase());
    if (missing.length) {
      renderSequence++;
      $('#preview').replaceChildren(element('p', 'preview-placeholder', 'Some characters need a different font.'));
      $('#preview-status').textContent = 'PDF unavailable for these characters.';
      $('#export-status').textContent = `This template’s PDF font cannot display: ${missing.slice(0, 12).join(' ')}. You can download Word and choose a font that supports them.`;
      $('#download-docx').disabled = !data.name.trim();
      $('#download-pdf').disabled = true;
      $('#preview').setAttribute('aria-busy', 'false');
      $('#previous-page').disabled = true;
      $('#next-page').disabled = true;
      $('#page-count').textContent = 'PDF preview unavailable';
      return;
    }
    // The preview and download share these exact PDF bytes.
    const blob = await buildTaggedPdf(snapshot, await loadFonts());
    const document = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    if (requestedRevision !== revision) { await document.loadingTask.destroy(); return; }
    const previous = pdfDocument;
    pdfDocument = document;
    pdfBlob = blob;
    currentPage = Math.min(currentPage, document.numPages);
    await showPage();
    if (previous) await previous.loadingTask.destroy();
    if (requestedRevision !== revision) return;
    $('#preview-status').textContent = !blocks.length ? 'Add your details or try the example.' : !data.name.trim() ? 'Enter your name in Basics to enable downloads.' : 'Your PDF, exactly as it will download.';
    if (!blocks.length) $('#preview').append(element('p', 'preview-placeholder preview-empty', `Your ${data.mode === 'cv' ? 'CV' : 'résumé'} will appear here as you add details.`));
    $('#preview').setAttribute('aria-busy', 'false');
    $('#download-pdf').disabled = !data.name.trim();
    $('#download-docx').disabled = !data.name.trim();
    $('#export-status').textContent = data.name.trim() ? '' : 'Enter your name to enable downloads.';
  } catch (error) {
    console.error(error);
    renderSequence++;
    $('#previous-page').disabled = true;
    $('#next-page').disabled = true;
    $('#preview-status').textContent = 'Preview could not be generated. Please retry.';
    const retry = button('Retry preview', 'button secondary', updatePreview);
    $('#preview').replaceChildren(retry);
    $('#preview').setAttribute('aria-busy', 'false');
  } finally {
    rendering = false;
    if (requestedRevision !== revision) updatePreview();
  }
}

function download(blob, extension, name, mode = data.mode) {
  const url = URL.createObjectURL(blob);
  const anchor = element('a');
  anchor.href = url; anchor.download = filename(name, extension, mode);
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

$('#download-pdf').addEventListener('click', () => {
  if (pdfBlob) { download(pdfBlob, 'pdf', data.name); $('#export-status').textContent = 'PDF downloaded.'; }
});
$('#download-docx').addEventListener('click', async () => {
  const snapshot = structuredClone(data);
  const exportRevision = revision;
  $('#download-docx').disabled = true;
  $('#export-status').textContent = 'Preparing your Word document…';
  try {
    download(await buildDocx(snapshot), 'docx', snapshot.name, snapshot.mode);
    $('#export-status').textContent = 'Word document downloaded. Word may adjust page breaks depending on installed fonts.';
  } catch (error) {
    console.error(error);
    $('#export-status').textContent = 'Word download failed. Your draft is still here; please try again.';
  } finally { if (revision === exportRevision) $('#download-docx').disabled = false; }
});

for (const [id, extension, mime, build] of [
  ['download-markdown', 'md', 'text/markdown', buildMarkdown],
  ['download-text', 'txt', 'text/plain', buildText],
]) {
  $(`#${id}`).addEventListener('click', () => {
    download(new Blob([build(data)], { type: `${mime};charset=utf-8` }), extension, data.name);
    $('#text-export-status').textContent = `${extension === 'md' ? 'Markdown' : 'Plain text'} downloaded.`;
  });
}
$('#copy-text').addEventListener('click', async () => {
  const text = buildText(data);
  const copiedRevision = revision;
  try {
    await navigator.clipboard.writeText(text);
    if (copiedRevision !== revision) return;
    $('#copy-fallback-label').hidden = true;
    $('#text-export-status').textContent = data.mode === 'cv' ? 'CV text copied.' : 'Résumé text copied.';
  } catch {
    if (copiedRevision !== revision) return;
    $('#copy-fallback').value = text;
    $('#copy-fallback-label').hidden = false;
    $('#copy-fallback').focus(); $('#copy-fallback').select();
    $('#text-export-status').textContent = 'Clipboard access is unavailable. Copy the selected text, or download Plain text.';
  }
});
$('#save-file').addEventListener('click', () => {
  try {
    download(new Blob([serializeResumeFile(data)], { type: 'application/json' }), data.mode === 'cv' ? 'cv.json' : 'resume.json', data.name);
    $('#file-status').textContent = `${data.mode === 'cv' ? 'CV' : 'Résumé'} file saved. Keep it somewhere private; it contains your details.`;
  } catch (error) { $('#file-status').textContent = error.message; }
});
$('#open-file').addEventListener('click', () => $('#resume-file').click());
$('#resume-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  const sequence = ++fileReadSequence;
  const readRevision = revision;
  $('#file-status').textContent = 'Reading résumé file on this device…';
  try {
    if (file.size > MAX_RESUME_FILE_BYTES) throw new Error('This file is too large. Résumé files must be 5 MiB or smaller.');
    const raw = await file.text();
    if (sequence !== fileReadSequence) return;
    const imported = parseResumeFile(raw);
    if ((hasContent(data) || revision !== readRevision) && !confirm('Replace the current résumé with this file? Save a résumé file first if you want to keep your current work.')) {
      $('#file-status').textContent = 'File not opened. Your current résumé was kept.'; return;
    }
    data = imported; step = 0; currentPage = 1; openEmployer = null; openRole = null;
    renderEditor(); changed(); $('#editor').focus();
    $('#file-status').textContent = `${data.mode === 'cv' ? 'CV' : 'Résumé'} file opened. Nothing was uploaded.`;
  } catch (error) {
    if (sequence === fileReadSequence) $('#file-status').textContent = `${error.message} Your current résumé was kept.`;
  }
});

function focusEditor() {
  $('#editor').focus({ preventScroll: true });
  $('#editor').scrollIntoView({ block: 'start' });
}

document.querySelectorAll('[data-step]').forEach(node => node.addEventListener('click', () => { step = Number(node.dataset.step); renderEditor(); focusEditor(); }));
document.querySelectorAll('[name=document-mode]').forEach(control => control.addEventListener('change', () => {
  if (!control.checked || !['resume', 'cv'].includes(control.value)) return;
  data.mode = control.value; currentPage = 1; renderEditor(); changed();
}));
$('#editor').addEventListener('submit', event => event.preventDefault());
$('#back').addEventListener('click', () => { step--; renderEditor(); focusEditor(); });
$('#next').addEventListener('click', () => {
  if (step === 3) { $('#preview-panel').focus({ preventScroll: true }); $('#preview-panel').scrollIntoView({ block: 'start' }); }
  else { step++; renderEditor(); focusEditor(); }
});
$('#previous-page').addEventListener('click', () => { currentPage--; showPage().catch(console.error); });
$('#next-page').addEventListener('click', () => { currentPage++; showPage().catch(console.error); });
$('#example').addEventListener('click', () => {
  if (hasContent(data) && !confirm('Replace your current draft with a fictional example? Download your current résumé first if you want to keep it.')) return;
  data = data.mode === 'cv' ? exampleCv() : exampleResume(); step = 0; currentPage = 1; openEmployer = null; openRole = null; renderEditor(); changed();
  $('#save-status').textContent = 'Fictional example loaded. Replace these details with your own.';
});
$('#remember').addEventListener('change', () => {
  if ($('#remember').checked) {
    let currentSaved;
    try { currentSaved = localStorage.getItem(STORAGE_KEY); } catch {
      $('#remember').checked = false;
      $('#save-status').textContent = 'Browser storage is unavailable. Download your work before leaving.';
      return;
    }
    if ((saveBlocked || currentSaved !== lastSaved) && !confirm('Replace the saved draft with the details in this tab? The saved draft may contain different work from another tab.')) { $('#remember').checked = false; return; }
    lastSaved = currentSaved;
    saveBlocked = false; save();
  } else {
    draftSaved = false;
    try {
      if (localStorage.getItem(STORAGE_KEY) === lastSaved) {
        localStorage.removeItem(STORAGE_KEY); lastSaved = null;
        $('#save-status').textContent = 'Draft is not saved. Download before closing this page.';
      } else $('#save-status').textContent = 'Saving is off here. The newer draft from another tab was kept.';
    }
    catch { $('#save-status').textContent = 'Could not remove saved data. Clear this site’s data in your browser settings.'; }
  }
});
$('#clear').addEventListener('click', () => {
  if (!confirm('Clear all résumé details and the saved draft from this browser? This cannot be undone.')) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { $('#save-status').textContent = 'Could not clear browser storage. Clear this site’s data in browser settings.'; return; }
  const mode = data.mode; data = emptyResume(); data.mode = mode;
  lastSaved = null; saveBlocked = false; step = 0; currentPage = 1; openEmployer = null; openRole = null;
  renderEditor(); changed(); $('#editor').focus();
});
window.addEventListener('beforeunload', event => {
  if (!draftSaved && hasContent(data)) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('storage', event => {
  if ((event.key === STORAGE_KEY || event.key === null) && event.newValue !== lastSaved && $('#remember').checked) draftConflict();
});
renderEditor(); updateChecks(); updatePreview();

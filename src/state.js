export const STORAGE_KEY = 'classic-resume-v1';
export const MAX_RESUME_FILE_BYTES = 5 * 1024 * 1024;
export const newRole = () => ({ title: '', dates: '', description: '', bullets: '' });
export const newExperience = () => ({ company: '', dates: '', roles: [newRole()] });
export const newEducation = () => ({ school: '', date: '', degree: '', details: '' });
export const emptyResume = () => ({
  name: '', phone: '', email: '', location: '', website: '', summary: '',
  experience: [newExperience()], education: [newEducation()], publications: '', skills: '',
});

function record(object, fields, collections = []) {
  return object !== null && typeof object === 'object' && !Array.isArray(object) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(object)) &&
    Object.keys(object).length === fields.length + collections.length &&
    fields.every(key => Object.hasOwn(object, key) && typeof object[key] === 'string' && object[key].length <= 30000) &&
    collections.every(key => Object.hasOwn(object, key));
}

function validResume(data) {
  return record(data, ['name', 'phone', 'email', 'location', 'website', 'summary', 'publications', 'skills'], ['experience', 'education']) &&
    Array.isArray(data.experience) && data.experience.length <= 50 &&
    Array.from(data.experience).every(job => record(job, ['company', 'dates'], ['roles']) && Array.isArray(job.roles) && job.roles.length <= 20 && Array.from(job.roles).every(role => record(role, ['title', 'dates', 'description', 'bullets']))) &&
    Array.isArray(data.education) && data.education.length <= 30 &&
    Array.from(data.education).every(item => record(item, ['school', 'date', 'degree', 'details']));
}

// Validate stored drafts before rendering; never silently replace an unreadable draft.
export function readDraft(raw) {
  const data = JSON.parse(raw);
  if (!validResume(data)) {
    throw new Error('This saved draft could not be read. It has not been overwritten.');
  }
  return data;
}

function checkFileSize(raw) {
  if (raw.length > MAX_RESUME_FILE_BYTES || new TextEncoder().encode(raw).length > MAX_RESUME_FILE_BYTES) {
    throw new Error('Résumé files must be 5 MiB or smaller. Your current draft has not been changed.');
  }
}

export function serializeResumeFile(data) {
  if (!validResume(data)) throw new Error('This draft contains invalid or unsupported fields and could not be saved as a résumé file.');
  const raw = JSON.stringify({ format: 'classic-resume', version: 1, data });
  checkFileSize(raw);
  return raw;
}

export function parseResumeFile(raw) {
  if (typeof raw !== 'string') throw new Error('Choose a résumé file saved by this app.');
  checkFileSize(raw);
  let file;
  try { file = JSON.parse(raw); }
  catch { throw new Error('This file is not valid JSON. Choose a résumé file saved by this app.'); }
  if (!record(file, ['format'], ['version', 'data']) || file.format !== 'classic-resume') {
    throw new Error('This is not a supported résumé file. Choose a résumé file saved by this app.');
  }
  if (file.version !== 1) throw new Error('This résumé file version is not supported by this app.');
  if (!validResume(file.data)) throw new Error('This résumé file contains invalid or unsupported fields.');
  return file.data;
}

export function hasContent(data) {
  return Object.values(data).some(value => typeof value === 'string' ? value.trim().length > 0 :
    Array.isArray(value) && value.some(hasContent));
}

export function filename(name, extension) {
  return `${name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/g, '').slice(0, 100) || 'Resume'} - Resume.${extension}`;
}

export const exampleResume = () => ({
  name: 'Alex Morgan', phone: '(216) 555-0142', email: 'alex@example.com',
  location: 'Cleveland, OH', website: 'linkedin.com/in/alex-example',
  summary: 'Operations leader with eight years of experience improving how teams plan, deliver, and grow. Combines hands-on process improvement with a clear, practical approach to developing people and serving customers.',
  experience: [
    { company: 'Northline Manufacturing', dates: '2021 – Present', roles: [
      { title: 'Operations Manager', dates: '2023 – Present', description: 'Lead a team of 18 across production planning, quality, and customer delivery.', bullets: 'Reduced order lead time from 12 days to 8 by redesigning the production scheduling process.\nIntroduced a training program that helped five team members move into senior roles.\nPartnered with sales and engineering to launch a new product line on schedule.' },
      { title: 'Senior Operations Analyst', dates: '2021 – 2023', description: '', bullets: 'Built a weekly planning process that connected customer demand with production capacity.\nStandardized inventory reporting across three locations.' },
    ] },
    { company: 'Fieldwork Supply Co.', dates: '2018 – 2021', roles: [
      { title: 'Operations Analyst', dates: '', description: '', bullets: 'Worked with warehouse teams to reduce picking errors and improve order accuracy.\nCreated clear operating procedures for receiving, inventory counts, and fulfillment.' },
    ] },
  ],
  education: [{ school: 'Lakeview University', date: '2018', degree: 'B.S. in Business Administration', details: 'Concentration in Operations Management\nGraduated with honors' }],
  publications: '', skills: 'Operations: Production planning, inventory management, continuous improvement\nLeadership: Team development, cross-functional collaboration, change management\nTools: Excel, Power BI, ERP systems',
});

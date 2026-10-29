export const STORAGE_KEY = 'classic-resume-v1';
export const MAX_RESUME_FILE_BYTES = 5 * 1024 * 1024;
export const CV_SECTIONS = [
  { key: 'researchInterests', label: 'Research Interests' },
  { key: 'research', label: 'Research Experience' },
  { key: 'teaching', label: 'Teaching and Mentoring' },
  { key: 'grants', label: 'Grants and Funding' },
  { key: 'patents', label: 'Patents' },
  { key: 'presentations', label: 'Presentations' },
  { key: 'honors', label: 'Honors and Awards' },
  { key: 'service', label: 'Academic Service' },
  { key: 'affiliations', label: 'Professional Affiliations' },
  { key: 'references', label: 'References' },
];
const cvFields = CV_SECTIONS.map(section => section.key);
const sharedFields = ['name', 'phone', 'email', 'location', 'website', 'summary', 'publications', 'skills'];
export const emptyCv = () => Object.fromEntries(cvFields.map(key => [key, '']));
export const newRole = () => ({ title: '', dates: '', description: '', bullets: '' });
export const newExperience = () => ({ company: '', dates: '', roles: [newRole()] });
export const newEducation = () => ({ school: '', date: '', degree: '', details: '' });
export const emptyResume = () => ({
  name: '', phone: '', email: '', location: '', website: '', summary: '',
  experience: [newExperience()], education: [newEducation()], publications: '', skills: '',
  mode: 'resume', cv: emptyCv(),
});

function record(object, fields, collections = []) {
  return object !== null && typeof object === 'object' && !Array.isArray(object) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(object)) &&
    Object.keys(object).length === fields.length + collections.length &&
    fields.every(key => Object.hasOwn(object, key) && typeof object[key] === 'string' && object[key].length <= 30000) &&
    collections.every(key => Object.hasOwn(object, key));
}

function validResume(data, legacy = false) {
  return record(data, legacy ? sharedFields : [...sharedFields, 'mode'], legacy ? ['experience', 'education'] : ['experience', 'education', 'cv']) &&
    (legacy || (['resume', 'cv'].includes(data.mode) && record(data.cv, cvFields))) &&
    Array.isArray(data.experience) && data.experience.length <= 50 &&
    Array.from(data.experience).every(job => record(job, ['company', 'dates'], ['roles']) && Array.isArray(job.roles) && job.roles.length <= 20 && Array.from(job.roles).every(role => record(role, ['title', 'dates', 'description', 'bullets']))) &&
    Array.isArray(data.education) && data.education.length <= 30 &&
    Array.from(data.education).every(item => record(item, ['school', 'date', 'degree', 'details']));
}

// Validate stored drafts before rendering; never silently replace an unreadable draft.
export function readDraft(raw) {
  const data = JSON.parse(raw);
  if (validResume(data)) return data;
  if (validResume(data, true)) return { ...data, mode: 'resume', cv: emptyCv() };
  throw new Error('This saved draft could not be read. It has not been overwritten.');
}

function checkFileSize(raw) {
  if (raw.length > MAX_RESUME_FILE_BYTES || new TextEncoder().encode(raw).length > MAX_RESUME_FILE_BYTES) {
    throw new Error('Résumé files must be 5 MiB or smaller. Your current draft has not been changed.');
  }
}

export function serializeResumeFile(data) {
  if (!validResume(data)) throw new Error('This draft contains invalid or unsupported fields and could not be saved as a résumé file.');
  const raw = JSON.stringify({ format: 'classic-resume', version: 2, data });
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
  if (![1, 2].includes(file.version)) throw new Error('This résumé file version is not supported by this app.');
  if (!validResume(file.data, file.version === 1)) throw new Error('This résumé file contains invalid or unsupported fields.');
  return file.version === 1 ? { ...file.data, mode: 'resume', cv: emptyCv() } : file.data;
}

export function hasContent(data) {
  if (!data || typeof data !== 'object') return false;
  return Object.entries(data).some(([key, value]) => key !== 'mode' && (typeof value === 'string' ? value.trim().length > 0 :
    Array.isArray(value) ? value.some(hasContent) : value && typeof value === 'object' && hasContent(value)));
}

export function filename(name, extension, mode = 'resume') {
  const label = mode === 'cv' ? 'CV' : 'Resume';
  return `${name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/g, '').slice(0, 100) || label} - ${label}.${extension}`;
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
  mode: 'resume', cv: emptyCv(),
});

// All names, institutions, publications and awards in this example are fictional.
export const exampleCv = () => ({
  name: 'Renée Park, Ph.D.', phone: '(216) 555-0186', email: 'renee.park@example.com',
  location: 'Cleveland, OH', website: 'example.com/renee-park',
  summary: 'Materials researcher studying recyclable polymers and reproducible experimental methods. Experience connecting laboratory research, undergraduate teaching, and collaborative projects.',
  experience: [
    { company: 'Example University', dates: '2023 – Present', roles: [
      { title: 'Assistant Professor of Materials Science', dates: '2024 – Present', description: 'Lead a research group investigating polymer processing and material reuse.', bullets: 'Developed shared protocols for mechanical testing and reproducible data analysis.\nSupervise two doctoral researchers and four undergraduate research students.\nCoordinate research collaborations across materials science and engineering education.' },
      { title: 'Research Fellow', dates: '2023 – 2024', description: '', bullets: 'Established a pilot study comparing repeated processing cycles in recyclable polymer systems.\nCreated a reusable experimental dataset and accompanying analysis notebooks.' },
    ] },
    { company: 'Northbridge Research Institute', dates: '2021 – 2023', roles: [
      { title: 'Postdoctoral Researcher', dates: '', description: 'Investigated relationships between polymer structure, processing, and mechanical performance.', bullets: 'Designed controlled experiments and documented uncertainty in material-property measurements.\nCoordinated research meetings and mentored summer research assistants.' },
    ] },
  ],
  education: [
    { school: 'Lakeview University', date: '2021', degree: 'Ph.D. in Materials Science', details: 'Dissertation: Processing pathways for reusable polymer materials\nAdvisor: Professor Avery Chen' },
    { school: 'Lakeview University', date: '2017', degree: 'M.S. in Materials Science', details: 'Thesis: Repeatability in polymer mechanical testing' },
    { school: 'Example State College', date: '2015', degree: 'B.S. in Chemistry', details: 'Graduated with honors' },
  ],
  publications: 'Park, R., Chen, A., and Ellis, J. Repeated processing and mechanical performance in reusable polymers. Example Journal of Materials Research, 12, 44–58. 2025.\nEllis, J. and Park, R. Reporting uncertainty in laboratory material measurements. Example Methods in Engineering, 8, 101–116. 2024.\nPark, R. and Chen, A. Reproducible workflows for polymer characterization. Example Polymer Studies, 6, 20–34. 2023.\nPark, R. Shared experimental protocols in graduate materials training. Example Journal of Research Education, 4, 71–82. 2022.',
  skills: 'Research methods: Polymer processing, mechanical testing, thermal analysis, experimental design\nData and software: Python, R, version control, reproducible notebooks\nLanguages: English and French',
  mode: 'cv',
  cv: {
    researchInterests: 'Recyclable polymers; structure–property relationships; reproducible materials research; research education.',
    research: '2024–Present: Reusable Polymer Systems, Example University. Investigate how repeated processing affects mechanical performance and material lifetime.\n2021–2023: Measurement Reliability, Northbridge Research Institute. Designed inter-laboratory protocols for consistent characterization.\n2017–2021: Doctoral Research, Lakeview University. Studied processing conditions and recovery of material properties.',
    teaching: '2024–Present: Introduction to Materials Science, Example University. Instructor; lectures, laboratory exercises, and assessment design.\n2025: Reproducible Research Methods. Developed and taught a graduate workshop on experimental records and analysis notebooks.\n2023–Present: Research mentoring. Supervised undergraduate projects and co-advised graduate researchers.\n2018–2020: Chemistry Laboratory, Lakeview University. Graduate teaching assistant.',
    grants: '2025–2027: Reusable Materials Pilot Study. Example Research Foundation; principal investigator; $75,000.\n2024–2025: Undergraduate Research Access. Example University internal grant; co-investigator; $12,000.\n2021–2023: Postdoctoral Research Fellowship. Northbridge Research Institute.',
    patents: 'Park, R. and Ellis, J. Laboratory fixture for repeated polymer testing. Fictional patent application EX-2025-001, filed 2025.',
    presentations: '2025: Reusable polymers across processing cycles. Invited talk, Example Materials Symposium, Cleveland, OH.\n2024: Reproducible characterization workflows. Oral presentation, Example Research Methods Conference, Madison, WI.\n2023: Experimental uncertainty in material testing. Poster, Example Early Career Research Forum, Pittsburgh, PA.',
    honors: '2025: Early Career Research Award, Example University.\n2021: Dissertation Research Prize, Lakeview University.\n2019: Graduate Teaching Recognition, Lakeview University.',
    service: '2024–Present: Member, Graduate Curriculum Committee, Example University.\n2023–Present: Reviewer, Example Journal of Materials Research.\n2025: Organizer, Reproducible Materials Research workshop.',
    affiliations: '2021–Present: Member, Example Materials Research Society.\n2024–Present: Member, Example Association for Engineering Education.',
    references: 'Avery Chen, Professor of Materials Science, Lakeview University. avery.chen@example.com. Doctoral advisor.\nJordan Ellis, Research Director, Northbridge Research Institute. jordan.ellis@example.com. Postdoctoral supervisor.',
  },
});

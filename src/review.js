import { hasContent } from './state.js';
import { dateError } from './form-values.js';

export function reviewIssues(data) {
  const issues = [];
  const add = (message, step, field, extra = {}) => issues.push({ message, step, field, ...extra });
  if (!data.name.trim()) add('Add your name.', 0, 'name');
  if (!data.email.trim() && !data.phone.trim()) add('Add an email address or phone number so someone can contact you.', 0, 'email');
  else if (data.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) add('Check the email address.', 0, 'email');
  data.experience.forEach((job, employer) => {
    if (!hasContent(job)) return;
    if (!job.company.trim()) add(`Employer ${employer + 1}: add the employer name.`, 1, 'company', { employer });
    if (dateError(job.dates)) add(`Employer ${employer + 1}: ${dateError(job.dates)}`, 1, 'dates', { employer });
    job.roles.forEach((role, roleIndex) => {
      if (hasContent(role) && !role.title.trim()) add(`Employer ${employer + 1}, role ${roleIndex + 1}: add the job title.`, 1, 'title', { employer, role: roleIndex });
      if (dateError(role.dates)) add(`Employer ${employer + 1}, role ${roleIndex + 1}: ${dateError(role.dates)}`, 1, 'dates', { employer, role: roleIndex });
    });
  });
  data.education.forEach((school, education) => {
    if (hasContent(school) && !school.school.trim()) add(`Education ${education + 1}: add the school or institution.`, 2, 'school', { education });
  });
  return issues;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyResume } from '../src/state.js';
import { reviewIssues } from '../src/review.js';

test('review checks contact and populated entries without demanding optional content', () => {
  const data = emptyResume();
  assert.deepEqual(reviewIssues(data).map(item => item.field), ['name', 'email']);
  data.name = 'Taylor'; data.phone = '555-0100';
  assert.deepEqual(reviewIssues(data), []);
  data.experience[0].roles[0].bullets = 'Improved turnaround.';
  data.education[0].degree = 'M.S.';
  assert.deepEqual(reviewIssues(data).map(({ field, step }) => [field, step]), [['company', 1], ['title', 1], ['school', 2]]);
  data.email = 'broken@'; data.experience[0].dates = '2025 – 2023';
  const issues = reviewIssues(data);
  assert.equal(issues[0].field, 'email');
  assert.deepEqual(issues.find(item => item.field === 'dates'), { message: 'Employer 1: End date must be on or after the start date.', step: 1, field: 'dates', employer: 0 });
});

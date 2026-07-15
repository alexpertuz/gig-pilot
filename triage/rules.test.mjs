import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCandidate } from './contracts.mjs';
import { applyRuleGate } from './rules.mjs';

const PROFILE = {
  rate_card: {
    hourly: { target: 75, walk_away: 40 },
    project: { min: 500 },
    declined_models: ['unpaid', 'equity', 'revenue_share'],
  },
};

function candidate({
  title,
  description = 'Community post with enough body text to evaluate the author intent accurately.',
  source,
  budget,
  paymentModel,
}) {
  const slug = encodeURIComponent(title.toLowerCase().replace(/\W+/g, '-').slice(0, 40));
  return normalizeCandidate({
    url: `https://example.test/${slug}`,
    title,
    description,
    source,
    budget,
    paymentModel,
  }, { provider: source?.startsWith('r/') ? 'reddit' : 'test', firstSeen: '2026-07-11' });
}

const regressions = [
  {
    title: '27-F- need $1000 for rent! 😭',
    description: 'I am short on rent and looking for help from anyone who can contribute.',
    source: 'r/jobbit',
    reason: 'source_policy',
  },
  {
    title: 'no se si por Expo go + React navigation me van a dar una crisis nerviosa',
    description: 'Estoy intentando aprender y necesito consejos para arreglar la navegación.',
    source: 'r/programacion',
    reason: 'discussion',
  },
  {
    title: 'Building the Next Billion-Dollar Fintech from Kerala – WhyNot',
    description: 'A founder story about the product I have been building and lessons learned.',
    source: 'r/ycombinator',
    reason: 'source_policy',
  },
  {
    title: 'Why wont my password pop up in my email on respondent.io?',
    description: 'Anyone having the same password reset problem with this website?',
    source: 'r/beermoney',
    reason: 'discussion',
  },
  {
    title: 'I’m a PhD-qualified software engineer specializing in Python tutoring',
    description: 'I specialize in online tutoring and research support. Contact me for my services.',
    source: 'r/jobbit',
    reason: 'job_seeker',
  },
  {
    title: 'Aprender Java y Python en Venezuela',
    description: '¿Cuál curso recomiendan para aprender a programar desde cero?',
    source: 'r/programacion',
    reason: 'discussion',
  },
];

for (const item of regressions) {
  test(`rejects named non-gig regression: ${item.title}`, () => {
    const result = applyRuleGate(candidate(item), PROFILE);
    assert.equal(result.state, 'reject');
    assert.ok(
      result.reasonCodes.includes(item.reason),
      `expected ${item.reason}, received ${JSON.stringify(result.reasonCodes)}`,
    );
  });
}

test('rejects annual salaried employment before model evaluation', () => {
  const result = applyRuleGate(candidate({
    title: '[HIRING] Frontend React Engineer — $180,000 per year',
    description: 'This is a full-time employee role with health benefits.',
    source: 'r/jobbit',
  }), PROFILE);

  assert.equal(result.state, 'reject');
  assert.ok(result.reasonCodes.includes('full_time'));
});

test('rejects a below-floor fixed project', () => {
  const result = applyRuleGate(candidate({
    title: '[Task] Fix a React form',
    description: 'The fixed project budget is $100 for the completed form.',
    source: 'r/slavelabour',
    budget: 'fixed project budget is $100',
  }), PROFILE);

  assert.equal(result.state, 'reject');
  assert.ok(result.reasonCodes.includes('below_rate_floor'));
});

test('rejects supply-side r/forhire posts even when they mention a strong stack', () => {
  const result = applyRuleGate(candidate({
    title: '[For Hire] React and Node developer available',
    description: 'Hire me for your next project. Portfolio and CV available.',
    source: 'r/forhire',
  }), PROFILE);

  assert.equal(result.state, 'reject');
  assert.ok(result.reasonCodes.includes('job_seeker'));
});

test('rejects commission-per-close work as contingent compensation', () => {
  const result = applyRuleGate(candidate({
    title: '[HIRING] Commission-Based Lead Generator — 10-20% Per Close',
    description: 'Generate leads for our startup launchpad and receive commission for each closed sale.',
    source: 'r/forhire',
  }), PROFILE);

  assert.equal(result.state, 'reject');
  assert.ok(result.reasonCodes.includes('contingent_compensation'));
});

test('rejects performance-only compensation before model evaluation', () => {
  const result = applyRuleGate(candidate({
    title: '[Hiring] Social media growth partner (paid based on performance)',
    description: 'Grow our iOS app audience and receive performance-based compensation for results.',
    source: 'r/forhire',
  }), PROFILE);

  assert.equal(result.state, 'reject');
  assert.ok(result.reasonCodes.includes('contingent_compensation'));
});

test('lets an explicit paid r/forhire client request reach model evaluation', () => {
  const result = applyRuleGate(candidate({
    title: '[Hiring] React developer for Stripe checkout — $90/hr',
    description: 'We need an independent contractor to deliver the checkout integration next month.',
    source: 'r/forhire',
    budget: '$90/hr',
  }), PROFILE);

  assert.equal(result.state, 'survivor');
  assert.deepEqual(result.reasonCodes, []);
});

test('lets an explicit paid founder request from a discussion-first source reach the model', () => {
  const result = applyRuleGate(candidate({
    title: 'Looking to hire a React contractor for checkout',
    description: 'We need someone to build and deliver Stripe checkout. Project budget is $2,000.',
    source: 'r/ycombinator',
    budget: 'Project budget is $2,000',
  }), PROFILE);

  assert.equal(result.state, 'survivor');
});

test('lets an explicit Spanish paid client request reach the model', () => {
  const result = applyRuleGate(candidate({
    title: 'Busco desarrollador freelance para integrar pagos',
    description: 'Necesito contratar a alguien para desarrollar la integración. Presupuesto del proyecto: $1500.',
    source: 'r/programacion',
    budget: 'Presupuesto del proyecto: $1500',
  }), PROFILE);

  assert.equal(result.state, 'survivor');
});

test('quarantines an otherwise plausible request with insufficient content', () => {
  const result = applyRuleGate(candidate({
    title: 'Need a developer',
    description: 'DM me.',
    source: 'unknown-board',
  }), PROFILE);

  assert.equal(result.state, 'quarantine');
  assert.ok(result.reasonCodes.includes('insufficient_content'));
});

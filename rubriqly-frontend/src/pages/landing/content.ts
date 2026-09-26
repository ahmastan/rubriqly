import { STARTER_RUBRICS } from '../../lib/starterRubrics'

// All landing page copy and sample content lives here, so wording can change without touching
// components. Honesty rules: no invented testimonials, numbers or accuracy claims; results are
// "an estimated level", never a grade; the essay and scores below are made up for the demo.

/**
 * The public contact address (Contact, Privacy and Terms pages, and forgotten passwords), set per
 * deployment with VITE_CONTACT_EMAIL. When it's not set, the pages say an address is coming soon.
 */
export const CONTACT_EMAIL: string = import.meta.env.VITE_CONTACT_EMAIL?.trim() ?? ''

/** The public source code. */
export const GITHUB_URL = 'https://github.com/ahmastan/rubriqly'

/** Where "check a draft" calls to action go. Signed-out visitors are sent to sign in first. */
export const APP_ENTRY = '/check/new'

export const nav = {
  links: [
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Rubrics', href: '#rubrics' },
    { label: 'For teachers', href: '#teachers' },
    { label: 'FAQ', href: '#faq' },
  ],
  signIn: { label: 'Sign in', to: '/signin' },
  signUp: { label: 'Sign up', to: '/signup' },
}

export const hero = {
  eyebrow: 'Rubric self-check for student writing',
  headline: 'Know where your draft stands before you hit submit.',
  // Alternatives: "See your draft the way the rubric does." / "Revise against the rubric, not a
  // rewrite." / "Every criterion. Every paragraph. Before it's due."
  subheadline:
    'Rubriqly checks your draft against the rubric and shows, paragraph by paragraph, where to revise. It never writes a word for you.',
  primaryCta: { label: 'Check a draft', to: APP_ENTRY },
  secondaryCta: { label: 'See how it works', href: '#demo' },
}

/** The made-up draft used in the hero and the scroll demo. */
export const demoDraft = {
  title: 'Why the 1918 Flu Changed Public Health',
  paragraphs: [
    {
      text: 'When the influenza pandemic of 1918 reached American cities, most had no health department able to coordinate a response. This essay argues that the pandemic forced cities to treat health as a shared public responsibility.',
      tags: [
        { label: 'Claim', present: true },
        { label: 'Context', present: true },
      ],
    },
    {
      text: 'Cities that acted early fared better. St. Louis closed schools and theaters within days of its first cases, and historians comparing death rates point to timing as the difference.',
      tags: [
        { label: 'Claim', present: true },
        { label: 'Evidence', present: true },
        { label: 'Analysis', present: true },
      ],
    },
    {
      text: 'Many people got sick and many people died. It was a very hard time and doctors did not have the medicine they needed.',
      tags: [
        { label: 'Evidence', present: false },
        { label: 'Analysis', present: false },
      ],
      weak: true,
    },
    {
      text: 'After 1918, more states required doctors to report influenza cases, and cities expanded their health departments.',
      tags: [
        { label: 'Claim', present: true },
        { label: 'Evidence', present: true },
      ],
    },
  ],
}

/** Made-up example results shown in the demo. Levels are out of 4. */
export const demoResults = {
  rubric: 'Argumentative essay',
  levels: ['Beginning', 'Developing', 'Proficient', 'Exemplary'],
  criteria: [
    { name: 'Thesis', desc: 'Clear, arguable, answers the prompt', level: 4, confidence: 0.88 },
    { name: 'Evidence', desc: 'Relevant, specific, cited', level: 3, confidence: 0.81 },
    {
      name: 'Analysis',
      desc: 'Explains how evidence supports the claim',
      level: 2,
      confidence: 0.77,
      tip: 'After each piece of evidence, explain in a sentence or two how it supports your thesis.',
    },
    { name: 'Organization', desc: 'Logical order and transitions', level: 3, confidence: 0.84 },
    {
      name: 'Conventions',
      desc: 'Grammar, spelling, citation format',
      level: 3,
      confidence: 0.52,
      lowConfidence: true,
    },
  ],
  before: { draft: 'Draft 2', level: 2, levelName: 'Developing' },
  /** Made-up average level of each draft, oldest first, for the "since draft 2" bars. */
  history: [2.1, 2.4, 2.9],
  after: { draft: 'Draft 3', level: 3, levelName: 'Proficient', change: '+0.5' },
}

/** Step captions for the pinned demo. Also the text version of the demo for screen readers. */
/** Breadcrumb shown in the demo's app frame. */
export const demoFrame = { assignment: 'Essay 2', draft: 'Draft 3' }

export const demoSteps = [
  {
    n: '01',
    title: 'Paste your draft',
    body: 'Paste it or upload a file. Rubriqly reads it paragraph by paragraph.',
  },
  {
    n: '02',
    title: 'Pick the rubric',
    body: 'Each criterion becomes a question with the rubric’s own level descriptions.',
  },
  {
    n: '03',
    title: 'Every paragraph gets tagged',
    body: 'Does it make a claim? Use evidence? Explain it? You see it per paragraph.',
  },
  {
    n: '04',
    title: 'Levels, with honest confidence',
    body: 'An estimated level for each criterion. Low confidence is flagged: check it yourself.',
  },
  {
    n: '05',
    title: 'Know exactly where to revise',
    body: 'The weakest paragraph is highlighted, with the rubric author’s tip for your level.',
  },
  { n: '06', title: 'Watch it improve', body: 'Check the next draft and see how far it moved.' },
]

export const statement = {
  text: 'Rubriqly scores your draft against the rubric. It never writes, rewrites, or finishes a sentence for you.',
  teachers:
    'Under the hood, Rubriqly scores drafts with a model that can only pick levels and answer yes or no. It has no way to produce text, so the revision is always the student’s own work.',
}

export const howItWorks = {
  heading: 'Three steps, then you revise.',
  steps: [
    {
      n: '1',
      title: 'Pick a rubric',
      body: 'Start with a built-in rubric, scan a photo of your teacher’s rubric, or build your own.',
    },
    {
      n: '2',
      title: 'Add your draft',
      body: 'Paste your text or upload a .docx, .pdf or .txt file. Add the assignment prompt if you have it.',
    },
    {
      n: '3',
      title: 'Revise with feedback',
      body: 'See estimated levels, paragraph tags and the rubric’s tips, then make the changes yourself.',
    },
  ],
}

/** One line on what each built-in rubric is for, shown on its library card. */
const RUBRIC_PURPOSE: Record<string, string> = {
  'argumentative-essay': 'For essays that take a position and defend it with evidence.',
  'lab-report': 'For experiments: a hypothesis, the method, the data and what it means.',
  'research-paper': 'For papers that build an answer from several sources.',
}

export const rubricLibrary = {
  heading: 'Start from a rubric, or bring your own.',
  body: 'Built-in rubrics cover common assignments. Scan a photo of your teacher’s rubric, or write your own criteria, levels and tips in the builder.',
  rubrics: STARTER_RUBRICS.map((r) => ({
    id: r.id,
    title: r.title,
    purpose: RUBRIC_PURPOSE[r.id] ?? '',
    criteria: r.criteria.map((c) => ({ name: c.name, desc: r.summaries?.[c.id] ?? '' })),
    levels: r.levels,
    checklist: r.checklist.map((item) => item.name),
    wordCount: r.rules.word_count,
    to: `${APP_ENTRY}?rubric=${r.id}`,
  })),
  buildYourOwn: {
    title: 'Build your own',
    body: 'Write the criteria, the level descriptions and a tip for each level. Add yes/no checklist items and a word range.',
    to: '/rubrics/new',
  },
}

export const teachers = {
  heading: 'For teachers',
  points: [
    {
      title: 'Your rubric, your words',
      body: 'Write a rubric once in the builder: the levels, what each one looks like, and the tip students see. Sharing rubrics with a class is coming soon.',
    },
    {
      title: 'More revision before it reaches you',
      body: 'Students see which criteria and which paragraphs need work while there’s still time to fix them.',
    },
    {
      title: 'It can’t do the writing',
      body: 'The model that scores drafts only returns levels and yes/no answers. Every sentence in the final draft is the student’s.',
    },
  ],
}

export const privacy = {
  heading: 'Your drafts stay yours.',
  points: [
    'Drafts and results are saved in your browser, on your device.',
    'When you check a draft, its text is sent to Vercel AI Gateway to be scored by the Jev model.',
    'Rubric photos you scan are read by Google’s Gemini model through Vercel AI Gateway, and aren’t kept.',
    'Rubriqly never writes or rewrites your text.',
    'Export or delete everything from Settings at any time.',
  ],
  link: { label: 'Read the privacy policy', to: '/privacy' },
}

export const faq = {
  heading: 'Questions',
  items: [
    {
      q: 'Is this a grade?',
      a: 'No. Rubriqly gives an estimated level for each criterion, an estimate to guide your revision, not a grade. Your teacher decides the grade.',
    },
    {
      q: 'Can it write my essay?',
      a: 'No. The model that scores your draft only picks levels and answers yes/no questions. It can’t write, rewrite or finish text, so every change is yours.',
    },
    {
      q: 'Which rubrics work?',
      a: 'Built-in rubrics cover argumentative essays, lab reports and research papers. You can also scan a photo of your teacher’s rubric, or build your own with levels, descriptions, tips and yes/no checklist items.',
    },
    {
      q: 'Does the AI that reads rubric photos see my essay?',
      a: 'No. Scanning a rubric uses a separate model, Google’s Gemini, that only receives your rubric photos. It copies the rubric and suggests questions and tips, clearly marked, for you to check before saving. Your drafts only ever go to the scoring model.',
    },
    {
      q: 'Is it free?',
      a: 'There’s a free plan with limited usage. Paid plans with extra features are on the way.',
    },
    {
      q: 'What happens to my drafts?',
      a: 'They’re saved in your browser on your device. The text you check is sent to Vercel AI Gateway for scoring. You can export or delete everything from Settings.',
    },
    {
      q: 'Is Rubriqly open source?',
      a: 'Yes. Rubriqly is open source under the MIT license and published on GitHub, so you can see exactly how drafts are scored, suggest improvements or run your own copy. This site is the hosted version.',
    },
    {
      q: 'Which writing does it work best for?',
      a: 'Writing that a rubric can describe: essays, reports and research papers with clear criteria. It’s less suited to creative writing like poetry.',
    },
  ],
}

export const finalCta = {
  headline: 'Your next draft, checked before it’s due.',
  cta: { label: 'Check a draft', to: APP_ENTRY },
}

export const footer = {
  links: [
    { label: 'Privacy', to: '/privacy' },
    { label: 'Terms', to: '/terms' },
    { label: 'Contact', to: '/contact' },
  ],
  github: { label: 'GitHub', href: GITHUB_URL },
  note: 'Estimated levels, not grades.',
}

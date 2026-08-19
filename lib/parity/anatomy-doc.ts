/**
 * Renders `docs/parity-items-categories.md` from `lib/parity/anatomy.ts`.
 *
 * The doc is generated rather than written because a hand-maintained parity
 * table is a claim that decays: the screens change, the table does not, and
 * the artefact a reviewer trusts most becomes the one that is most wrong.
 * `tests/parity/anatomy.test.ts` fails when the file on disk differs from this
 * render, and regenerates it on demand:
 *
 *     PARITY_DOC_WRITE=1 npx vitest run tests/parity/anatomy.test.ts
 *
 * Kept out of the React tree deliberately — this module is pure string work,
 * so the suite can assert the rendered markdown without a DOM.
 */

import {
  ANATOMY,
  KIT_API_GAPS,
  KIT_GAPS,
  SCHEMA_GAPS,
  anatomyTally,
  type AnatomySection,
  type AnatomyRow,
} from './anatomy';

const SECTION_TITLES: Record<AnatomySection, string> = {
  page: 'Page frame — heading, actions, tabs',
  filterbar: 'Filter bar',
  table: 'Table',
  footer: 'Footer & paging',
  empty: 'Empty state',
};

const SECTION_ORDER: AnatomySection[] = ['page', 'filterbar', 'table', 'footer', 'empty'];

/** Markdown table cells may not contain a raw pipe or a hard line break. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

function verdictCell(row: AnatomyRow): string {
  if (row.verdict === 'match') {
    return '**MATCH**';
  }
  const gap = row.kitGap === undefined ? '' : ' _(kit gap — see below)_';
  return `**DIFFERS** — ${cell(row.why ?? '')}${gap}`;
}

function screenCell(row: AnatomyRow): string {
  return row.screen === 'both' ? 'both' : row.screen;
}

export function renderAnatomyDoc(): string {
  const tally = anatomyTally();
  const lines: string[] = [];

  lines.push('# Items & Categories — admin ⇄ Showcase parity');
  lines.push('');
  lines.push('<!--');
  lines.push('  GENERATED FILE — DO NOT EDIT.');
  lines.push('  Source of truth: lib/parity/anatomy.ts');
  lines.push('  Regenerate:      PARITY_DOC_WRITE=1 npx vitest run tests/parity/anatomy.test.ts');
  lines.push('-->');
  lines.push('');
  lines.push(
    'One row per anatomical element of the host admin\'s own Items and Categories index pages, ' +
      'with what the admin does, what Showcase does, and whether they agree. Every `source` is a ' +
      'file in the chiya-shots host — the admin column is quoted from it, not remembered.',
  );
  lines.push('');
  lines.push(
    `**Tally: ${tally.match} MATCH · ${tally.differs} DIFFERS** (of ${tally.total} elements). ` +
      'A DIFFERS is not automatically a defect: several are deliberate embed-vs-host divergences, ' +
      'several are host-side contract breaks that this exercise surfaced, and ' +
      `${KIT_GAPS.length + KIT_API_GAPS.length} are kit gaps this task was told not to fix. Each states which.`,
  );
  lines.push('');
  lines.push('The classes in **contract** are asserted against the RENDERED Showcase markup by');
  lines.push('`tests/dom/index-anatomy.test.tsx`, and the absence of any hand-written geometry');
  lines.push('alongside them by `tests/parity/class-contract.test.ts`.');
  lines.push('');

  for (const section of SECTION_ORDER) {
    const rows = ANATOMY.filter((row) => row.section === section);
    if (rows.length === 0) {
      continue;
    }
    lines.push(`## ${SECTION_TITLES[section]}`);
    lines.push('');
    lines.push('| Element | Screen | Admin | Showcase | Verdict | Contract classes | Host source |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const row of rows) {
      lines.push(
        `| <a id="${row.id}"></a>${cell(row.element)} | ${screenCell(row)} | ${cell(row.admin)} | ` +
          `${cell(row.showcase)} | ${verdictCell(row)} | ` +
          `${row.contract.length === 0 ? '—' : row.contract.map((c) => `\`.${c}\``).join(' ')} | ` +
          `\`${row.source}\` |`,
      );
    }
    lines.push('');
  }

  lines.push('## Kit gaps blocking full parity');
  lines.push('');
  lines.push(
    'Found while building these screens, and deliberately **not fixed** — `@flashmandu/app-bridge-ui` ' +
      'is being edited by another agent, so each is written down with the exact selector and the exact ' +
      'declaration instead.',
  );
  lines.push('');
  for (const gap of KIT_GAPS) {
    lines.push(`### ${gap.element} — [\`${gap.rowId}\`](#${gap.rowId})`);
    lines.push('');
    lines.push(`- **Selector:** ${gap.selector}`);
    lines.push(`- **Needed:** ${gap.declaration}`);
    lines.push('');
  }
  for (const gap of KIT_API_GAPS) {
    lines.push(`### ${gap.element}`);
    lines.push('');
    lines.push(`- **Selector:** ${gap.selector}`);
    lines.push(`- **Needed:** ${gap.declaration}`);
    lines.push('');
  }

  lines.push('## Schema gaps blocking full parity');
  lines.push('');
  lines.push(
    'Fields the admin index pages render that the app-facing GraphQL schema does not expose. ' +
      'Reported, not worked around: `packages/flashmandu/apps/graphql/` is host schema and this ' +
      'task adds nothing to it.',
  );
  lines.push('');
  lines.push('| Field | Needed by | Today |');
  lines.push('|---|---|---|');
  for (const gap of SCHEMA_GAPS) {
    lines.push(`| ${cell(gap.field)} | ${cell(gap.neededBy)} | ${cell(gap.today)} |`);
  }
  lines.push('');

  return lines.join('\n');
}

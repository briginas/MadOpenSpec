import type {PreparedInput} from './types.ts';
export function renderChange(input: PreparedInput) {
  const files = new Map<string, string>();
  const capList = (isNew: boolean) => input.capabilities.filter(c => c.isNew === isNew).map(c => `- \`${c.path}\`: ${c.purpose ?? 'Update existing requirements.'}`).join('\n') || 'None.';
  const sources = [`- [Story ${input.story.id}](${input.sourceLink})`, ...input.references.map((ref, i) => `- [${ref.requirementId ?? 'Source'}](${input.referenceLinks[i]})`)];
  files.set('proposal.md', `# Proposal\n\n## Why\n\n${input.why}\n\n## What Changes\n\n${input.title}\n\n## Capabilities\n\n### New Capabilities\n\n${capList(true)}\n\n### Modified Capabilities\n\n${capList(false)}\n\n## Impact\n\nThis change implements Story ${input.story.id}. Record refinements here.\n\n## Sources\n\n${sources.join('\n')}\n`);
  const tasks: string[] = [];
  for (const cap of input.capabilities) {
    const lines = ['# Spec Delta', '', ...(cap.purpose ? ['## Purpose', '', cap.purpose, ''] : [])];
    for (const operation of ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED']) {
      const requirements = cap.requirements.filter(r => r.operation === operation);
      if (!requirements.length) continue;
      lines.push(`## ${operation} Requirements`, '');
      for (const r of requirements) {
        if (r.operation === 'RENAMED') {
          lines.push(`- FROM: \`### Requirement: ${r.from}\``, `- TO: \`### Requirement: ${r.name}\``, '');
        } else {
          lines.push(`### Requirement: ${r.name}`, '');
          if (r.operation === 'REMOVED') lines.push(`**Reason**: ${r.reason}`, '', `**Migration**: ${r.migration}`, '');
          else {
            lines.push(r.text, '');
            for (const s of r.scenarios) {
              lines.push(`#### Scenario: ${s.name}`);
              if (s.given) lines.push(`- **GIVEN** ${s.given}`);
              lines.push(`- **WHEN** ${s.when}`, `- **THEN** ${s.then}`, ...(s.and ?? []).map(and => `- **AND** ${and}`), '');
              for (const result of [s.then, ...(s.and ?? [])]) tasks.push(`Implement “${result}”`, `Verify “${result}”`);
            }
          }
        }
        if (r.operation === 'REMOVED') tasks.push(`Remove the ${r.name} requirement`, `Verify removal of ${r.name}`);
        if (r.operation === 'RENAMED') tasks.push(`Rename ${r.from} to ${r.name}`, `Verify the rename from ${r.from} to ${r.name}`);
      }
    }
    files.set(`specs/${cap.path}/spec.md`, lines.join('\n'));
  }
  files.set('tasks.md', `# Tasks\n\nRefine this checklist before applying the change.\n\n## 1. Implementation and verification\n\n${(input.tasks ?? tasks).map((task, i) => `- [ ] 1.${i + 1} ${task}`).join('\n')}\n`);
  return files;
}

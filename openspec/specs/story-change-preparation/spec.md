# story-change-preparation Specification

## Purpose

Create a reproducible OpenSpec change for one selected BMAD story from explicit agent input, and preserve subsequent manual refinements.

## Requirements

### Requirement: Explicit structured input

The creation command SHALL accept a story ID and a JSON document containing the story source, requirement references, rationale, explicit capabilities, requirement operations, and scenarios. The CLI MUST validate the structure, matching IDs, referenced items, and applicability of the operations without calling an LLM.

#### Scenario: Complete valid input
- **WHEN** the agent supplies an existing story with unambiguous references
- **THEN** the CLI creates a change only for that story
- **AND** other stories remain in the backlog without new changes

#### Scenario: Inconsistent input
- **WHEN** the JSON is invalid, the IDs differ, a reference is missing, or an operation does not apply
- **THEN** the CLI reports a specific error before writing any change content

### Requirement: Generate initial artifacts

The CLI SHALL use the standard OpenSpec change creation process and write `proposal.md`, delta specs, and an initial `tasks.md`. The agent input SHALL supply requirement wording and capability choices. The CLI MUST preserve Given/When/Then/And clauses and source references. It MUST NOT infer story-level coverage from epic-level coverage.

#### Scenario: Generate artifacts
- **WHEN** the input supplies the objective, acceptance criteria, and capability paths
- **THEN** the generated files contain those details and a link to the source story
- **AND** each expected outcome becomes an initial task unless the input explicitly supplies detailed tasks
- **AND** the agent can add `design.md` later

#### Scenario: Modify an existing requirement
- **WHEN** the input contains a MODIFIED requirement
- **THEN** the CLI verifies that the supplied block matches the exact existing requirement name and retains all existing scenarios
- **AND** it rejects an incomplete block before writing

### Requirement: Prevent duplicate changes and regeneration

The CLI MUST maintain at most one linked change per story. Repeating creation with the same input SHALL return the existing link without overwriting files. Different input SHALL produce an error that identifies the existing change. A closed story SHALL retain its archive link without acquiring a new change.

#### Scenario: Agent has already refined a change
- **WHEN** the user repeats creation with the original JSON after editing specs, design, or tasks
- **THEN** the CLI returns the existing change and preserves the files byte for byte

#### Scenario: Retry with different input
- **WHEN** the user supplies different JSON for a linked story
- **THEN** the CLI directs the user to refine the existing change and leaves the files intact

### Requirement: Recover interrupted creation

The CLI SHALL recognize its own interrupted creation and complete only the missing steps when retried with the same input. If the change directory belongs to a different operation or its ownership is ambiguous, the CLI SHALL report a diagnostic. A matching name alone cannot authorize overwriting or adopting it.

#### Scenario: Failure after writing some files
- **WHEN** the CLI receives the same input for its own incomplete operation
- **THEN** it preserves existing files and adds only the missing artifacts and link information

#### Scenario: Change ID already in use
- **WHEN** the intended change directory exists without a verified link to the current operation
- **THEN** the CLI reports a conflict and preserves its contents

### Requirement: English change documents

The preparation skill SHALL defer to the target project's language rules for agent-authored change content, including prose supplied in change input JSON. The CLI SHALL generate its own proposal and task text in English and preserve supplied wording, identifiers, links and literal examples.

#### Scenario: Prepare a change for a project with a different documentation language
- **WHEN** the target project requests French documentation
- **THEN** the agent can supply French requirements, scenarios and tasks without conflicting instructions from the preparation skill

#### Scenario: Create a change from English input
- **WHEN** the creator supplies English change text with no custom tasks
- **THEN** the proposal, spec deltas and generated implementation and verification tasks are in English

#### Scenario: Preserve a literal from the source
- **WHEN** a requirement or task supplied to the CLI contains a non-English literal
- **THEN** the generated document retains the literal exactly

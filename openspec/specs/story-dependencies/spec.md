# story-dependencies Specification

## Purpose

Extract prerequisites deterministically from explicit BMAD story fields and check them before implementation. Explain what blocks a story while keeping independent stories available.

## Requirements

### Requirement: Extract dependencies from each story's field

The `dependencies extract [--json]` command SHALL read the configured backlog and extract the `Dependencies` or `Зависимости` field from each `Story N.M` section. The CLI MUST ignore frontmatter, epic fields, fenced code blocks, and mentions outside the field. The report SHALL include the story ID, title, `extractionState`, `dependsOn`, and diagnostics with the source field and line number.

#### Scenario: Story fields in the worked example
- **WHEN** story 1.1 declares `только существующий движок и интерфейс; Story 1.2 для завершения этой story не требуется.` and story 1.2 declares `Story 1.1; будущих stories нет.`
- **THEN** extraction returns `known` and `[]` for 1.1, and `known` and `["1.1"]` for 1.2

#### Scenario: Fields outside a story and references in acceptance criteria
- **WHEN** a document contains an epic-level Dependencies field, frontmatter with `dependencies: pass`, a fenced example, or a reference to Story 1.2 in acceptance criteria
- **THEN** none of these supplies a story's dependency field or creates an edge

#### Scenario: Supported field formatting
- **WHEN** a field uses `**Dependencies:**`, `**Dependencies**:`, or either form with the Russian label `Зависимости`
- **THEN** the CLI matches the label case-insensitively and reads the field value to the end of its paragraph

### Requirement: Match the complete field value against a closed grammar

The CLI SHALL match the entire field value against the documented closed grammar. A positive list of `Story N.M` references creates required edges. An explicit declaration of no story dependencies yields `[]`. Negated mentions MUST NOT create edges. Any unrecognized remainder MUST yield `unknown` and discard partial matches. The CLI MUST NOT invoke an LLM or infer dependencies from story order or numbers.

#### Scenario: Explicit list of prerequisites
- **WHEN** the field contains `Story 1.1, Story 1.2.` or `Story 1.1, Story 1.2; будущих stories нет.`
- **THEN** the direct prerequisites are `["1.1", "1.2"]`

#### Scenario: Explicit declaration of no dependencies
- **WHEN** the field contains `none`, `нет`, `отсутствуют`, or `нет зависимостей между stories`, optionally followed by a period
- **THEN** extraction returns `known` and `[]`

#### Scenario: Negating one dependency leaves the list unknown
- **WHEN** the entire field value is `Story 1.2 не требуется`
- **THEN** extraction returns `unknown` and `dependsOn: null`
- **AND** it neither creates an edge to 1.2 nor supplies an empty list

#### Scenario: A positive dependency followed by a negative clause
- **WHEN** the field contains `Story 1.1; будущих stories нет.`
- **THEN** the CLI retains the dependency on 1.1 because the final clause only excludes future stories

#### Scenario: Unsupported text after a recognized reference
- **WHEN** the field contains `Story 1.1; возможно, ещё авторизация`
- **THEN** the CLI returns `unknown` and `dependsOn: null` with the full source value
- **AND** it discards the recognized prefix as an incomplete list

### Requirement: Unknown and ambiguous fields

A missing, empty, repeated, or ambiguous field SHALL yield `extractionState: unknown` and `dependsOn: null`. The CLI MUST NOT pick the first duplicate or treat an unknown list as empty. Extraction SHALL exit with 0 only for a fully known, valid graph, with 1 for unknown or invalid data or a read error, and with 2 for invalid arguments. JSON stdout MUST contain one report.

#### Scenario: Missing field
- **WHEN** a story has no dependency field
- **THEN** the CLI reports its ID, `unknown`, and a missing-field diagnostic asking for clarification

#### Scenario: Duplicate or conflicting fields
- **WHEN** a story has two dependency fields, even if one uses `Dependencies` and the other `Зависимости`
- **THEN** the CLI returns `unknown` and identifies both locations

#### Scenario: Unrecognized wording
- **WHEN** the full value does not match any supported pattern
- **THEN** the CLI reports `unknown`, shows the source line, and asks for clarification
- **AND** it neither calls an LLM nor accepts a manual graph in place of the parser result

### Requirement: Structural validity of the extracted graph

The CLI MUST detect duplicate story IDs, duplicate edges, references to missing IDs, self-dependencies, and cycles, including cross-epic cycles. Diagnostics SHALL identify the participating IDs and show a closed chain for a cycle. Unknown fields MUST remain unknown during validation, even when the known edges contain no cycle.

#### Scenario: Missing prerequisite story
- **WHEN** story 1.3 explicitly depends on story 9.1, which is absent from the backlog
- **THEN** the CLI reports `invalid` for that dependency and shows IDs 1.3 and 9.1

#### Scenario: Cross-epic cycle
- **WHEN** the fields declare that 1.1 depends on 2.1 and 2.1 depends on 1.1
- **THEN** the CLI reports `invalid` and the chain `1.1 -> 2.1 -> 1.1`

#### Scenario: Unknown part of the graph
- **WHEN** the known edges contain no cycle but one story has an unknown field
- **THEN** full-backlog extraction exits with 1 and retains `unknown` for that story

### Requirement: Read current sources without side effects

Extraction, check, and status SHALL derive the graph from the current configured backlog without using a stored or manually registered graph. Extraction SHALL return the source path and the SHA-256 hash of the bytes read. These commands MUST NOT create locks, metadata, or changes, edit BMAD documents, or update checklists. If data changes after it is read and before the check completes, the check MUST deny permission to start.

#### Scenario: Dependency changes between calls
- **WHEN** a story's backlog field changes and the check runs again
- **THEN** the check uses the new value without requiring registration or cache removal

#### Scenario: Source changes during the check
- **WHEN** the backlog, sprint status, or registry changes after it is read and before the check finishes
- **THEN** the CLI reports `unknown` and `SOURCE_CHANGED` and denies permission to start

#### Scenario: Read-only commands
- **WHEN** the developer runs extraction, check, or status, regardless of the result
- **THEN** project files remain byte-for-byte identical, and the command creates no metadata or lock

### Requirement: Prerequisite completion

An unlinked prerequisite SHALL count as complete when its BMAD status is unambiguously `done`. For a linked story, the CLI MUST also verify the `closed` phase, archive, marker, and receipt. An active change, completed tasks, `review`, archiving, or a pending BMAD update MUST NOT establish completion. Unknown or conflicting data MUST prevent implementation from starting.

#### Scenario: Prerequisite completed through BMAD
- **WHEN** a prerequisite has no MadOpenSpec link and its sole BMAD status is `done`
- **THEN** it satisfies the dependency without requiring a change

#### Scenario: Archived prerequisite with an incomplete close
- **WHEN** a linked prerequisite is in phase `archived` and all its tasks are complete
- **THEN** the dependent story remains blocked until close completes successfully

#### Scenario: Closed story with unverifiable evidence
- **WHEN** a prerequisite has BMAD status `done` and phase `closed` but the archive or receipt cannot be verified
- **THEN** the check reports that completion is unknown and explains the verification failure
- **AND** implementation of the dependent story cannot start

#### Scenario: Main specs change after a successful close
- **WHEN** a prerequisite closed successfully and later changes updated the main specs through the normal workflow
- **THEN** those updates alone do not invalidate the prerequisite's confirmed completion

### Requirement: Targeted pre-implementation check

The `change check --story <N.M> [--json]` command SHALL check the selected story's field, its entire reachable prerequisite graph, and each prerequisite's completion. The result SHALL include `storyId`, `dependencyState`, `dependsOn`, `blockedBy`, and `issues`. Only `ready` allows implementation to proceed. States `blocked`, `unknown`, and `invalid` prevent it. The CLI MUST exit with 0 for `ready`, 1 when it denies permission to start, and 2 for invalid arguments.

#### Scenario: Incomplete direct dependency
- **WHEN** story 1.2 depends on incomplete story 1.1
- **THEN** the check returns `blocked` and exits with 1
- **AND** the message says that story 1.2 is blocked until story 1.1 is complete and includes the current title and status of 1.1

#### Scenario: Dependency chain
- **WHEN** story 2.1 depends on 1.3, which depends on 1.1, and both prerequisites are incomplete
- **THEN** the result includes both incomplete prerequisites with their dependency chains from 2.1
- **AND** the message suggests completing 1.1 first if its field and prerequisites allow it to start

#### Scenario: Transitive dependency through a completed story
- **WHEN** story 2.1 depends on completed story 1.3 but transitive prerequisite 1.1 is incomplete
- **THEN** the check blocks 2.1 and shows the chain `2.1 -> 1.3 -> 1.1`

#### Scenario: Unknown field on a reachable prerequisite
- **WHEN** the selected story's field is recognized but a direct or transitive prerequisite has an unknown field
- **THEN** the check returns `unknown` and exits with 1 even if that prerequisite is marked `done`
- **AND** it identifies the story ID and the field at issue

#### Scenario: Independent story with an unrelated graph error
- **WHEN** the selected story explicitly declares no dependencies and an unrelated story has an unrecognized field or participates in a separate cycle
- **THEN** the selected story's check returns `ready` and exits with 0
- **AND** full-backlog extraction continues to report the unrelated problems

#### Scenario: All prerequisites complete
- **WHEN** the selected and reachable fields are known, the branch is valid, and every prerequisite is verifiably complete
- **THEN** the check returns `ready` with an empty `blockedBy` and exits with 0

### Requirement: Preparation and recovery remain available

Blocked or unknown dependencies MUST NOT prevent OpenSpec change creation or refinement. Reading dependencies SHALL remain independent of the original change input. Unknown or invalid fields MUST NOT prevent normal close or recovery of an operation already in progress, so prerequisites can still be completed.

#### Scenario: Prepare a change in advance
- **WHEN** the developer prepares a change for a story with incomplete or unknown prerequisites
- **THEN** preparation can proceed and the implementation restriction is reported explicitly

#### Scenario: Correct the field of a story with an existing change
- **WHEN** the dependency field is updated in BMAD and the CLI reads it again
- **THEN** the existing change retains its original input hash, marker, artifacts, and link

#### Scenario: Recover a prerequisite story
- **WHEN** a prerequisite needs another close attempt and its dependency fields are still unrecognized
- **THEN** the normal close workflow remains available and checks its own preconditions

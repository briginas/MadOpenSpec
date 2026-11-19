# workflow-status Specification

## Purpose

Report story and change status from project files so users and agents can distinguish successful operations from incomplete work and unknown states.

## Requirements

### Requirement: Current story status

The full JSON report SHALL include each story's ID, title, BMAD status, linked active change or archive, and counts of completed and remaining tasks. Status SHALL count unlinked stories without creating changes and distinguish open changes from BMAD status. For each story, JSON SHALL include direct dependencies, the dependency check result, and blocking stories with their dependency chains, using the same rules as `change check`.

#### Scenario: Backlog and active change
- **WHEN** one story has an active change and the others have yet to be selected
- **THEN** status shows the active change and its tasks only for the selected story
- **AND** default text counts the remaining stories and the epic overview lists them individually

#### Scenario: Waiting for a prerequisite
- **WHEN** a story's dependency field identifies an incomplete prerequisite
- **THEN** status shows `dependencyState: blocked` and the blocking story's ID, title, state, and dependency chain
- **AND** this blocker alone neither adds an error to `issues` nor changes the successful exit code

#### Scenario: Independent story
- **WHEN** a story explicitly declares that it has no story dependencies
- **THEN** status shows `dependencyState: ready`, `dependsOn: []`, and `blockedBy: []`
- **AND** incomplete independent stories with lower numbers do not block it

### Requirement: Text and JSON interfaces

The CLI SHALL use the same source data for text status and `status --json`. JSON SHALL contain machine-readable IDs, statuses, counts, and diagnostics. The CLI MUST keep operational logs out of JSON stdout. Each story SHALL include `dependencyState`, `dependsOn`, and `blockedBy` and preserve the meaning and availability of existing `schemaVersion: 1` fields.

#### Scenario: Agent requests status
- **WHEN** the agent runs `mad-openspec status --json`
- **THEN** stdout contains one valid JSON document with every story and diagnostic underlying both text views

#### Scenario: Unknown dependency list
- **WHEN** a story's field is missing, duplicated, or only partially recognized
- **THEN** JSON contains `dependsOn: null`, state `unknown`, and a diagnostic identifying the source field
- **AND** the text output reports that the dependencies are unknown
- **AND** an empty `blockedBy` does not imply readiness

### Requirement: Report errors and incomplete operations

Status SHALL detect missing or ambiguous links, corrupt data, incomplete operations, and problems with dependency fields or the graph. Unavailable counts SHALL remain unknown. Status SHALL extract the graph from the current backlog with the strict parser. It MUST NOT perform open-ended analysis of content drift, invoke an LLM, or repair files.

#### Scenario: Archive exists before BMAD update
- **WHEN** the registry records an incomplete close after archiving
- **THEN** status reports the pending BMAD update and tells the user that close can be retried
- **AND** the archive alone does not authorize dependent stories to start

#### Scenario: Task file is unreadable
- **WHEN** status cannot obtain task counts from OpenSpec
- **THEN** it reports a diagnostic and unknown counts without declaring completion

#### Scenario: Read project state
- **WHEN** the user runs status on a healthy or damaged project
- **THEN** project file contents remain unchanged

#### Scenario: Stories without a Dependencies field
- **WHEN** `DEPENDENCIES_FIELD_MISSING` is the only diagnostic
- **THEN** status determines the project stage as usual and exits with 0
- **AND** the summary counts stories that omit the field, and JSON retains `dependencyState: unknown` and the backlog path and line number for each one

#### Scenario: Story selection and implementation check
- **WHEN** a connected backlog is ready for selection and story 1.1 omits the field
- **THEN** status reports stage `ready` and suggests choosing a story for preparation
- **AND** `change check --story 1.1` reports `unknown` and exits with 1 until the dependencies are clarified
- **AND** a missing field yields `dependsOn: null`. An empty list requires an explicit declaration such as `**Dependencies:** none`.

#### Scenario: Cycle alongside a missing field
- **WHEN** one story omits the field and two other stories depend on each other
- **THEN** status reports stage `attention`, shows the cycle chain, and exits with 1
- **AND** the summary counts each story that omits its own field once, including when its diagnostic also appears on a dependent story

#### Scenario: Invalid field or dependency graph
- **WHEN** a field value is unrecognized, a source is unavailable, or the extracted graph contains a structural error
- **THEN** status reports `unknown` or `invalid`, includes the diagnostic in `issues`, and exits with 1
- **AND** available story fields and change states remain visible

#### Scenario: Unknown field on an unrelated branch
- **WHEN** one story has an unknown field and another has recognized prerequisites and does not depend on it
- **THEN** status shows `unknown` and diagnostics for the first story and evaluates the second independently
- **AND** status can exit with 1 without changing the result of the second story's targeted check

### Requirement: Compact workflow summary

Status SHALL provide a `--summary` view that groups stories by epic, shows titles and counts by state, and lists all open stories. JSON SHALL include the same underlying data as additions to schema version 1. Status SHALL report dependency blockers separately from the lifecycle state. Reading status MUST NOT modify the project.

#### Scenario: Multiple epics and open stories
- **WHEN** the backlog contains multiple epics, closed stories, several open changes, and stories awaiting selection
- **THEN** the summary shows every epic and story in numeric ID order, with progress and overall counts
- **AND** it lists all open stories and does not mark an empty epic as complete

#### Scenario: Equivalent formats
- **WHEN** a user runs `status`, `status --summary`, `status --json`, or `status --summary --json`
- **THEN** all formats use the same state and both JSON invocations return the same full report
- **AND** the existing story, issue, dependency, and task fields remain available

### Requirement: Deterministic story states

Status SHALL derive `workflowState` from the BMAD status, verified link, and task counts. An open change MUST NOT imply that implementation has started. Completed tasks MUST NOT imply closure. Status SHALL show unknown or conflicting data explicitly, exclude those stories from confirmed completions, and report dependency state separately.

#### Scenario: Open change and task progress
- **WHEN** a verified active change has a nonempty task list
- **THEN** completing all tasks yields `tasks-complete`, completing some tasks or having BMAD status `in-progress` or `review` yields `in-progress`, and otherwise zero completed tasks yields `prepared`
- **AND** `prepared` indicates no recorded progress, while `tasks-complete` indicates that checks and closure are still required

#### Scenario: Closure and backlog
- **WHEN** a story has no change link and its BMAD status is `backlog`/`ready-for-dev`, `in-progress`/`review`, or `done`
- **THEN** its workflow state is `not-started`, `in-progress`, or `done`, respectively
- **AND** a linked story reaches `done` only after its `closed` phase is confirmed and BMAD agrees that it is `done`

#### Scenario: Damaged data and unfinished operations
- **WHEN** data is unavailable, a status is unrecognized, or the evidence conflicts
- **THEN** status reports `unknown` or `attention`, includes a diagnostic, and exits with 1
- **AND** it reports `attention` for a change being created or closed, and preserves a known lifecycle state when dependencies have errors

### Requirement: Document availability before connection

Status SHALL report the connection state and availability of the backlog and sprint status both before and after `connect`. Saved paths SHALL take precedence. Before connection, discovery SHALL use BMAD configuration and the rules used by `connect`. Status MUST distinguish a missing, ambiguous, or damaged source from one whose availability is unknown. Status MUST NOT create a configuration, choose an ambiguous source, or install tools.

#### Scenario: Documents ready before connection
- **WHEN** the project is disconnected but its BMAD configuration unambiguously identifies accessible documents
- **THEN** status shows epics, stories, and available BMAD statuses, reports the missing connection, and suggests `connect`
- **AND** it leaves dependency readiness for implementation unconfirmed until connection

#### Scenario: Incomplete project
- **WHEN** BMAD configuration is absent or the configured directories lack a backlog or sprint status
- **THEN** status reports an unknown location or confirmed absence for each document, preserves available data, and gives the next step
- **AND** expected absence before connection is a normal result, while a read error, resolver error, or ambiguous source produces exit code 1

#### Scenario: Damaged connection
- **WHEN** the saved configuration is damaged or points to unavailable documents
- **THEN** status reports a diagnostic and exits with 1 without falling back to other discovered files or presenting empty lists as proof that no stories exist

### Requirement: At-a-glance status
Default text SHALL show project counts by recorded workflow state, open stories with known task progress and dependency readiness, and actionable diagnostics. Both text views SHALL summarize missing dependency fields once with the affected story IDs. The epic overview SHALL retain all stories, source availability, and next steps.

#### Scenario: One prepared change and nine unspecified dependency lists
- **WHEN** a verified change has zero of seven tasks complete and nine unstarted stories omit their dependency field
- **THEN** default text shows the prepared story's title, change ID and 0/7 progress, counts the nine unstarted stories and identifies them in one missing-field warning
- **AND** the overview lists all ten titles in numeric order within their epics

#### Scenario: Unavailable inputs
- **WHEN** a required document is unavailable
- **THEN** the compact view identifies the affected input and includes the next step and any actionable diagnostic

### Requirement: Terminal status colors
Text views SHALL highlight workflow and diagnostic labels in an interactive terminal. Prepared and in-progress labels use blue, closed uses green, unspecified or waiting dependencies use yellow, and errors use red. Titles, counts and identifiers remain readable in the terminal's normal color.

#### Scenario: Plain text and JSON
- **WHEN** stdout is redirected or NO_COLOR is set to a nonempty value
- **THEN** text views contain the same labels without ANSI styling
- **AND** JSON output is independent of terminal and color settings

#### Scenario: Interactive status
- **WHEN** stdout is an interactive terminal with color enabled
- **THEN** both text views highlight the status labels and preserve their meaning when color is removed

### Requirement: Single-epic progress checklist
The CLI SHALL provide a read-only plain text `status --epic N` view of the current status report. It SHALL show the epic ID and title, confirmed closed and total story counts, a blank line and each story's ID and title in numeric order. Only `done` counts as closed. The optional `--just-closed N.M` annotation requires a confirmed closed link in the selected epic.

#### Scenario: Mixed workflow states
- **WHEN** an epic has closed, in-progress and other stories
- **THEN** each done story has a ✓, each in-progress story has a → and every other story has a ○ with its state
- **AND** ongoing work shows known task counts, completed tasks awaiting closure remain open, and blocked open stories show their blocking IDs

#### Scenario: Last story closes
- **WHEN** every story is done and the user requests the just-closed annotation
- **THEN** every row has a ✓, only the selected row is annotated, and the counts refer to stories irrespective of the epic's BMAD status

#### Scenario: Progress cannot be confirmed
- **WHEN** the backlog is unavailable, the epic is absent or the specified closed link cannot be verified in that epic
- **THEN** the command exits unsuccessfully with a diagnostic and no checklist

#### Scenario: Empty epic
- **WHEN** the selected epic exists in the backlog and contains no stories
- **THEN** the command shows zero of zero and an explicit empty list without declaring completion

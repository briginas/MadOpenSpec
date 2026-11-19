# change-completion Specification

## Purpose

Close an implemented change with a command that updates the main specs and records story completion, including when an interruption requires a retry.

## Requirements

### Requirement: Preconditions for closing a change

Close SHALL verify a single valid story link, an accessible BMAD record, the required artifacts for the supported schema, a nonempty list of fully completed tasks, and a successful `openspec validate --strict`. Failure of any precondition SHALL stop close before archiving.

#### Scenario: Incomplete tasks
- **WHEN** at least one tracked task is unchecked
- **THEN** the CLI lists the blockers without archiving or updating BMAD

#### Scenario: Missing required artifact
- **WHEN** a required artifact is missing or the task file is empty
- **THEN** close reports an error even if the other files exist

#### Scenario: Strict validation fails
- **WHEN** OpenSpec reports an error or warning that fails strict validation
- **THEN** close keeps the change active and reports the OpenSpec diagnostic

### Requirement: Run project checks during implementation

Close MUST NOT run tests, lint, type checking, or builds, require an agent acceptance report, or certify that these checks passed. Its preconditions SHALL cover only artifact readiness and the correctness of the close operation.

#### Scenario: Change meets the close preconditions
- **WHEN** all close preconditions are met
- **THEN** close proceeds to archiving without invoking project test or build commands

### Requirement: Archive before marking a story complete

The CLI SHALL use the standard OpenSpec archive operation to update the main specs and archive the change. Only confirmed success SHALL permit marking the selected BMAD story and its registered story file `done` and recording the archive link in the registry. The CLI MUST preserve BMAD planning content and the statuses of other stories and the epic.

#### Scenario: Successful close
- **WHEN** OpenSpec has updated the specs and archived the change
- **THEN** the CLI marks only the linked story `done` and records the actual archive path
- **AND** it preserves comments and unrelated fields in the BMAD documents

#### Scenario: Archive error or conflict
- **WHEN** OpenSpec has not confirmed both the spec update and the archive operation
- **THEN** the CLI reports an error without marking the story complete

### Requirement: Resume incomplete close operations

The CLI MUST retain enough information to distinguish the archive step from the BMAD update. After a confirmed archive, retrying close SHALL complete only the remaining writes without reapplying the delta. If archive success cannot be verified after a failure, the CLI SHALL report that recovery is needed without declaring completion.

#### Scenario: Failure after archiving
- **WHEN** the change was successfully archived but the BMAD write did not finish
- **THEN** retrying close verifies the archive and completes the status and registry updates
- **AND** it does not invoke archiving again for that change

#### Scenario: Change already closed
- **WHEN** the user retries close and the archive and `done` status are consistent
- **THEN** the CLI reports the completed operation without modifying files

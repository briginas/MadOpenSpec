# project-integration Specification

## Purpose

Connect MadOpenSpec to an existing BMAD and OpenSpec project, verify tool versions, and safely record source paths and links between artifacts.

## Requirements

### Requirement: Explicit connection to an existing project

The `connect` command SHALL locate and record paths for one existing BMAD backlog in `epics.md` format, its `sprint-status.yaml`, the BMAD manifest, and the local OpenSpec root. For document paths the user omits, it SHALL use the effective BMAD configuration, including overrides. It SHALL validate the documents and tool compatibility without running installers.

#### Scenario: Connect a valid project
- **WHEN** the user supplies existing paths and supported versions
- **THEN** the CLI saves the configuration in `.mad-openspec/` and reports its location
- **AND** the BMAD and OpenSpec planning documents retain their original content

#### Scenario: OpenSpec has not been initialized
- **WHEN** the user runs `connect` in a project without a valid local OpenSpec root
- **THEN** the CLI reports an error without creating a new OpenSpec root

#### Scenario: Connect without installing
- **WHEN** the user omits document paths, the BMAD configuration identifies one valid epics file and sprint status file, and the tools are compatible
- **THEN** the command validates the documents and records their paths without installing or updating components

#### Scenario: Missing backlog
- **WHEN** the user runs `connect` before creating the required documents
- **THEN** the command returns an error listing the missing sources
- **AND** it creates neither a placeholder backlog nor an integration configuration

#### Scenario: Legacy command name
- **WHEN** the user runs `mad-openspec init`
- **THEN** the CLI exits with 2 and directs the user to `mad-openspec connect`
- **AND** it performs neither connection nor installation

### Requirement: Verify tool compatibility

The CLI MUST support BMAD 6.12.4 and OpenSpec 2.1.1 with the `spec-driven` schema. Before modifying the project, it SHALL verify the actual versions and the local OpenSpec root. An incompatible or unknown version or an external store SHALL stop the write and produce a diagnostic.

#### Scenario: Unsupported BMAD version
- **WHEN** the manifest reports a BMAD version other than 6.12.4
- **THEN** a command that would modify the project fails before writing

#### Scenario: Root redirects to an external store
- **WHEN** OpenSpec resolves the supplied path to a different root
- **THEN** the CLI reports the unsupported configuration and writes nothing there

### Requirement: Stable story IDs and link registry

The CLI SHALL identify each story by its `N.M` ID, unique in the configured backlog and independent of the title. The registry SHALL record the story ID, source document, exact BMAD status key, change ID, and actual archive path after close. A linked ID cannot be reassigned to another story.

#### Scenario: Title of a linked story changes
- **WHEN** the user inspects the link for the original story ID
- **THEN** it identifies the same change regardless of the new title

#### Scenario: Ambiguous BMAD record
- **WHEN** zero or multiple keys in `development_status` match the source story
- **THEN** a command that would modify the project reports the error without selecting a key

### Requirement: Safe writes and interruption recovery

The CLI MUST confine writes to the configured project after resolving symlinks, serialize modifications, and protect the registry against partial JSON writes. On retry, it SHALL recognize incomplete steps and preserve existing documents.

#### Scenario: Destination outside the project
- **WHEN** a capability path, artifact path, or symlink leads outside the allowed project
- **THEN** the CLI rejects the operation before writing to that path

#### Scenario: Concurrent modifications
- **WHEN** another modifying command holds the project lock
- **THEN** the second command reports the lock conflict without applying its changes

#### Scenario: Corrupt registry
- **WHEN** the registry exists but cannot be read or fails structural validation
- **THEN** the CLI reports corruption and preserves the file without replacing it with an empty registry

### Requirement: Resolve source paths from BMAD configuration

On the first connection, `connect` SHALL resolve omitted document paths from the effective BMAD configuration, including overrides. It SHALL locate epics under `planning_artifacts` and sprint status under `implementation_artifacts`, and validate a sole candidate before connecting. Missing sources SHALL produce an error. Ambiguous results SHALL require explicit paths without an interactive prompt. Configuration errors MUST NOT trigger a fallback to default paths.

#### Scenario: Custom directories and overrides
- **WHEN** the user omits paths and the effective BMAD configuration points to custom directories with one epics file and one sprint status file
- **THEN** connect validates those files and connects the backlog
- **AND** it reports the resolved paths and how it determined them

#### Scenario: Multiple candidates
- **WHEN** discovery finds multiple candidates for one document
- **THEN** connect returns `BACKLOG_AMBIGUOUS` and a stable list of candidates
- **AND** it asks the user to specify `--epics` or `--sprint-status` without selecting the first file or prompting interactively

#### Scenario: One explicit path
- **WHEN** the user supplies the path to one document
- **THEN** connect skips discovery for that document and validates the supplied path
- **AND** it resolves the other document's path independently

#### Scenario: All paths supplied explicitly
- **WHEN** the user supplies all required paths and the documents are valid
- **THEN** connect links the backlog without invoking the resolver or requiring Python

#### Scenario: Invalid BMAD configuration
- **WHEN** the resolver fails or cannot resolve a required directory
- **THEN** connect reports the configuration error and stops
- **AND** it does not search a hard-coded `_bmad-output` directory in place of the configured location

#### Scenario: BMAD is not installed
- **WHEN** the user runs connect in a project without BMAD
- **THEN** the command reports the missing tool without installing it or creating an integration configuration

#### Scenario: Backlog already connected
- **WHEN** a valid integration configuration exists and BMAD now points to different directories
- **THEN** connect retains the registered paths and existing story links

### Requirement: Pin and explicitly update the project CLI version

A newly connected project SHALL record the running package version. Project commands SHALL diagnose a missing or different pin before doing workflow work and give a recovery command. Help and version SHALL remain available. Status SHALL report the diagnostic through its normal report.

#### Scenario: Existing connected project
- **GIVEN** a legacy 0.3.3 connection without a CLI version
- **WHEN** the operator runs `mad-openspec update` from the project root
- **THEN** it upgrades the configuration and managed skills to the running release and preserves story links, planning documents and unrelated settings

#### Scenario: Different release
- **GIVEN** the configured release differs from the running CLI
- **WHEN** the operator runs a workflow command
- **THEN** it reports both versions and stops before performing project operations

#### Scenario: Repeat or preview an update
- **GIVEN** a configured project or a project prepared only with setup
- **WHEN** the operator previews the update with `--dry-run --json` or repeats a completed update
- **THEN** it reports the outcome and leaves persistent files intact

#### Scenario: Modified skill
- **GIVEN** a managed skill contains local edits
- **WHEN** the user runs update
- **THEN** it identifies the conflicting file and preserves the old version and user edits

### Requirement: Migrate project-local OpenSpec installations

Update SHALL upgrade supported 1.16.0 connections and completed setup receipts to 2.1.1, refresh managed project skills, and retain active changes, archives, BMAD records and project settings. Preview SHALL list the writes. Conflicts SHALL preserve user edits. Repeating an update SHALL leave persistent files untouched.

#### Scenario: Connected story in progress
- **WHEN** a project with an active linked change upgrades
- **THEN** status identifies the same story and change, and close can archive it and mark the story done

#### Scenario: Setup-only installation
- **WHEN** a project upgrades before connecting a backlog
- **THEN** update refreshes the skills at its configured OpenSpec root and updates the setup receipt

#### Scenario: Local skill edits
- **WHEN** a managed skill differs from the recognized original and the target version
- **THEN** update reports the conflicting path before writing project files

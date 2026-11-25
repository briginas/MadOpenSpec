# Spec Delta

## MODIFIED Requirements

### Requirement: Verify tool compatibility

The CLI MUST support BMAD 6.12.4 and OpenSpec 2.1.1 with the `spec-driven` schema. Before modifying the project, it SHALL verify the actual versions and the local OpenSpec root. An incompatible or unknown version or an external store SHALL stop the write and produce a diagnostic.

#### Scenario: Unsupported BMAD version
- **WHEN** the manifest reports a BMAD version other than 6.12.4
- **THEN** a command that would modify the project fails before writing

#### Scenario: Root redirects to an external store
- **WHEN** OpenSpec resolves the supplied path to a different root
- **THEN** the CLI reports the unsupported configuration and writes nothing there

## ADDED Requirements

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

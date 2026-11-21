# toolchain-setup Specification

## Purpose

Install MadOpenSpec tools and project skills reproducibly with one command. Reuse compatible components and report conflicts or incomplete setup.

## Requirements

### Requirement: Explicit noninteractive installation

The `setup` command SHALL install any missing components without prompting the user. The components are BMAD 6.12.4 with BMM, local OpenSpec 1.16.0 with its built-in `spec-driven` schema, and the MadOpenSpec skills for Codex. Setup SHALL use explicit arguments and documented stable defaults, independent of the operating system username and locale.

#### Scenario: New project
- **WHEN** the user runs `setup` in an existing project directory without BMAD or OpenSpec
- **THEN** the command installs the pinned components and project skills
- **AND** it reports each step's result and suggests running `connect` separately once the BMAD documents are ready

#### Scenario: Missing prerequisite
- **WHEN** the environment lacks a prerequisite for running an installer
- **THEN** setup identifies the missing prerequisite before installing any component
- **AND** it leaves installation of system runtimes and package managers to the user

### Requirement: Reproducible component selection

Setup MUST use only the pinned installers and dependencies supplied through the MadOpenSpec lockfile. It SHALL limit BMAD installation to core/BMM and Codex, without fetching additional modules from mutable channels. Global tools and npm dist-tags MUST NOT determine which versions run.

#### Scenario: Different OpenSpec version on PATH
- **WHEN** the global `openspec` has a different version and MadOpenSpec bundles OpenSpec 1.16.0
- **THEN** setup uses the bundled OpenSpec
- **AND** it preserves the global installation

### Requirement: Skip compatible components

Setup SHALL first inspect every component and classify it as compatible, missing, or conflicting. For compatible components, it SHALL skip the installer and preserve existing files. Repeating a completed setup with the same parameters MUST preserve the contents and modification times of persistent project files.

#### Scenario: Partially configured project
- **WHEN** the correct BMAD version and BMM are installed but OpenSpec is missing
- **THEN** setup skips BMAD and installs the missing OpenSpec and skills

#### Scenario: Repeat setup
- **WHEN** all components and configuration match a previous successful setup
- **THEN** the command reports the skipped components without reinstalling them or writing persistent files

### Requirement: Stop on conflict

Setup MUST fail its preliminary checks before installing any component if it detects an incompatible version, damaged installation, unsupported store or schema, or conflicting skills or settings. A matching filename or directory name MUST NOT establish compatibility. The command SHALL preserve user files and explain the conflict.

#### Scenario: Incompatible BMAD version
- **WHEN** the manifest specifies a version other than 6.12.4
- **THEN** setup reports a conflict before installing any missing components

#### Scenario: Modified MadOpenSpec skill
- **WHEN** the target skill directory exists and its contents differ from the bundled skill
- **THEN** setup reports a conflict and preserves the existing directory

#### Scenario: Incomplete installation
- **WHEN** `_bmad/` exists without a valid manifest or required BMM or Codex files
- **THEN** setup reports an incomplete installation without skipping it as compatible or silently reinstalling it

### Requirement: Preview and machine-readable report

Setup SHALL support `--dry-run` to perform checks and display the plan without modifying files, running installers, or making network requests. With `--json`, it SHALL emit one JSON document with `schemaVersion: 1`, components, actions, tool readiness, and diagnostics. Subprocess logs MUST stay out of JSON stdout. The exit code SHALL be 0 on success, 1 for an operational error, and 2 for invalid arguments.

#### Scenario: Preview installation
- **WHEN** the user runs `setup --dry-run --json` in an empty project
- **THEN** setup reports its installation plan without searching for or evaluating a backlog
- **AND** it creates no files, locks, or internal records and makes no network requests

#### Scenario: Installer fails in JSON mode
- **WHEN** a subprocess fails during `setup --json`
- **THEN** stdout contains one valid report with the error and the results of preceding steps
- **AND** the command exits with 1

### Requirement: Verify results and report partial completion

Setup MUST verify the expected result of each step independently of the subprocess exit code. On failure, it SHALL stop subsequent steps, retain confirmed results, and report the incomplete installation. A retry SHALL skip verified compatible components. An ambiguous or damaged result MUST NOT trigger an automatic reinstall or a success report.

#### Scenario: Installer omits expected files
- **WHEN** an installer exits with 0 but verification cannot confirm that the required component is present
- **THEN** setup returns an error without marking the component as installed

#### Scenario: Failure after installing one component
- **WHEN** BMAD installs successfully and a subsequent step fails
- **THEN** the report retains the confirmed BMAD result and explains why setup stopped
- **AND** on retry, setup skips the BMAD installer after verifying the installation

### Requirement: Separate tool setup from backlog connection

Setup SHALL install and verify only tools and skills, independently of planning documents. It MUST NOT search for or validate a backlog, run connect, or create or modify integration configuration or story links. Connecting the backlog SHALL require a separate explicit user action. The setup result SHALL report tool readiness and omit the integration states `pending` and `ready`.

#### Scenario: Planning documents do not yet exist
- **WHEN** the user runs setup before creating epics and sprint status
- **THEN** setup installs missing tools and reports the result
- **AND** it creates no `.mad-openspec/config.json`, stories, or changes

#### Scenario: Backlog is ready
- **WHEN** the user runs setup in a project with valid epics and sprint status
- **THEN** the command only verifies and installs tools
- **AND** the user can connect the backlog in a separate command

#### Scenario: Invalid or ambiguous backlog
- **WHEN** a project has multiple backlogs or invalid epics or sprint status
- **THEN** the setup plan and result are independent of those documents
- **AND** setup does not read them

#### Scenario: Project already connected
- **WHEN** the user runs setup in a project with an existing integration configuration
- **THEN** setup preserves that configuration and the registry

### Requirement: Project boundaries and concurrent modifications

Setup MUST restrict installation destinations to the physical project root and reject symlinks that resolve outside it before running installers. A modifying run SHALL acquire the shared MadOpenSpec exclusive lock and recheck its plan under that lock. Setup MUST NOT modify global configurations or other projects. Permitted side effects of the official installers SHALL be verified and documented.

#### Scenario: Destination outside the project
- **WHEN** `_bmad/`, `openspec/`, or a target skill directory resolves through a symlink outside the project root
- **THEN** setup reports an error before installation and preserves the external files

#### Scenario: Project locked
- **WHEN** another modifying MadOpenSpec process holds the project lock
- **THEN** setup returns `PROJECT_LOCKED` without running installers

### Requirement: English artifact language on fresh OpenSpec setup

Setup SHALL configure a new OpenSpec installation to produce English artifacts independently of the BMAD communication language.

#### Scenario: Install OpenSpec in a new project
- **WHEN** setup initializes OpenSpec for a project with Russian as its communication language
- **THEN** the resulting OpenSpec project context requests English artifacts

#### Scenario: Existing OpenSpec configuration
- **WHEN** setup encounters an existing compatible OpenSpec configuration with a language preference
- **THEN** it preserves that configuration

### Requirement: Deliver planning guidance through BMAD customization

Setup and update SHALL enable the reconciliation rule on ordinary invocations of bmad-spec, bmad-prd, bmad-correct-course and bmad-create-epics-and-stories using BMAD's project customization mechanism. Both operations SHALL preserve existing settings, support read-only preview and leave exactly one effective rule attachment per workflow on repeat runs.

#### Scenario: New or previously configured project
- **WHEN** the user runs setup on a new project or update on an existing installation
- **THEN** all four workflows load the guidance before backlog connection is needed
- **AND** team and personal settings remain effective

#### Scenario: Repeat delivery
- **WHEN** the user repeats a successful setup or update
- **THEN** the workflows still load the rule once each and persistent files retain their contents and modification times

### Requirement: Select a BMAD planning profile

Setup SHALL accept `--bmad-profile planning|full`, default to planning on fresh projects, and report the effective profile in text and JSON previews. Planning SHALL install the brief, SPEC, PRD, architecture, UX, brainstorming, epics, sprint planning and correct-course skills plus the help, review, advanced elicitation and party mode helpers. Its skill and file manifests and help catalogs SHALL describe the installed subset. Other Codex skills and existing project output SHALL be preserved.

#### Scenario: Fresh planning project
- **WHEN** ordinary setup runs in a project without BMAD
- **THEN** only the thirteen selected BMAD skills are installed for Codex, with their assets and the shared BMAD runtime
- **AND** explicitly selecting full installs the complete core/BMM skill set

#### Scenario: Invalid profile
- **WHEN** setup receives an unsupported profile value
- **THEN** it exits with code 2 before writing files

#### Scenario: Repeat and verify
- **WHEN** setup runs again without a profile argument after a planning installation
- **THEN** it uses the saved profile and skips a complete installation without persistent writes
- **AND** missing required skills or assets cause a conflict even if a skill is missing from its manifest

#### Scenario: Preserve existing profiles
- **WHEN** setup encounters an existing full installation, including one from before profiles existed
- **THEN** an ordinary setup reuses it

#### Scenario: Migrate to planning
- **WHEN** the user explicitly selects planning on a compatible full installation
- **THEN** preview lists the skills to remove and the modifying run removes only verified upstream skill directories, filters the catalogs and records planning
- **AND** retained skills, unrelated skills, BMAD settings, backlog and story links are preserved
- **AND** local changes or extra files in a removal candidate block setup before writes, a failed migration restores the previous installation, and repeat setup skips a completed migration

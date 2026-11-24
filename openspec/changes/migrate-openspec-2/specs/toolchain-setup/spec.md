# Spec Delta

## MODIFIED Requirements

### Requirement: Explicit noninteractive installation

The `setup` command SHALL install any missing components without prompting the user. Setup requires Node.js 22.20.0 or later. The components are BMAD 6.12.4 with BMM, local OpenSpec 2.1.1 with its built-in `spec-driven` schema, with six project-local core skills, and the MadOpenSpec skills for Codex. Setup SHALL use explicit arguments and documented stable defaults, independent of the operating system username and locale.

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
- **WHEN** the global `openspec` has a different version and MadOpenSpec bundles OpenSpec 2.1.1
- **THEN** setup uses the bundled OpenSpec
- **AND** it preserves the global installation

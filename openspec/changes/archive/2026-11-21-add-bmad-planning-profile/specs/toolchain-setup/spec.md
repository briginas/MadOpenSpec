## ADDED Requirements

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

## ADDED Requirements

### Requirement: Deliver planning guidance through BMAD customization

Setup and update SHALL enable the reconciliation rule on ordinary invocations of bmad-spec, bmad-prd, bmad-correct-course and bmad-create-epics-and-stories using BMAD's project customization mechanism. Both operations SHALL preserve existing settings, support read-only preview and leave exactly one effective rule attachment per workflow on repeat runs.

#### Scenario: New or previously configured project
- **WHEN** the user runs setup on a new project or update on an existing installation
- **THEN** all four workflows load the guidance before backlog connection is needed
- **AND** team and personal settings remain effective

#### Scenario: Repeat delivery
- **WHEN** the user repeats a successful setup or update
- **THEN** the workflows still load the rule once each and persistent files retain their contents and modification times

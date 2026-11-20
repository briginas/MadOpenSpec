## ADDED Requirements

### Requirement: Reconcile product plans with current capability specifications

Once the change scope is known, BMAD planning skills SHALL compare the request and current SPEC or PRD with the requirements and scenarios of affected capabilities in the configured OpenSpec root's `openspec/specs/`, including direct OpenSpec changes. They SHALL identify accepted behavior, the requested delta and constraints to retain.

#### Scenario: Product requirement has drifted
- **GIVEN** the SPEC defers yard editing and the current OpenSpec requirement accepts moving benches within the yard
- **WHEN** the user asks to rotate benches through bmad-spec or bmad-prd
- **THEN** before recording requirements the skill identifies movement as accepted, rotation as new, and the yard boundary as a constraint
- **AND** agreed changes go through the skill owning the SPEC or PRD and detailed scenarios stay in OpenSpec

#### Scenario: Validation finds a discrepancy
- **WHEN** bmad-spec or bmad-prd is validating a document with a stale requirement
- **THEN** it reports the discrepancy and leaves the requirements intact

#### Scenario: Ambiguous sprint change
- **WHEN** a discrepancy leaves two materially different sprint plans plausible
- **THEN** bmad-correct-course identifies the conflicting statements and asks the user to resolve them before preparing its sprint change proposal

#### Scenario: Direct story decomposition from older documents
- **GIVEN** previously prepared planning documents still defer yard editing, movement within the yard has since been accepted in OpenSpec, and the request adds rotation
- **WHEN** the user invokes bmad-create-epics-and-stories directly
- **THEN** it reconciles the inputs and uses the document owner to correct the stale requirement before forming affected stories
- **AND** the backlog covers rotation while preserving the boundary and excludes work to implement movement again

#### Scenario: A comparison becomes stale
- **WHEN** the affected scope or relevant source specifications have changed since an earlier comparison
- **THEN** the skill refreshes the affected comparison before relying on it for a planning decision

#### Scenario: Reuse a current comparison
- **WHEN** a previous comparison covers the request and its sources are still current
- **THEN** the skill may use its results directly

#### Scenario: No applicable requirements
- **WHEN** the main specs directory is absent, empty or contains no requirements relevant to the change
- **THEN** the skill continues normal planning

# agent-workflow Specification

## Purpose

Guide Codex through work on BMAD stories and OpenSpec changes. The agent and user make requirements and design decisions. The CLI performs the corresponding file and state operations.

## Requirements

### Requirement: Analysis before change creation

The preparation skill SHALL direct the agent to read the selected story, related BMAD documents, current specs, and relevant changes. The agent SHALL identify capabilities and requirements and discuss conflicts or ambiguities with the user. The agent MUST obtain dependencies from `dependencies extract --json` and MUST NOT replace an unknown result with its own graph or infer dependencies from story numbers.

#### Scenario: Prepare an existing story
- **WHEN** the user selects a story for implementation
- **THEN** the agent reads the context, prepares structured input, and calls the creation command for that story alone
- **AND** the agent extracts dependencies from the current backlog through the CLI and uses its diagnostics

#### Scenario: Use dependencies extracted by the CLI
- **WHEN** the CLI extracts dependency fields from the stories
- **THEN** the agent uses the recognized IDs and explicit empty lists without registering its own JSON graph
- **AND** the agent leaves other stories without new changes and makes no automatic edits to BMAD planning content

#### Scenario: Unknown dependency field
- **WHEN** the CLI reports an unrecognized, missing, or duplicate field on the selected story or a prerequisite
- **THEN** the agent identifies the field and asks the user to clarify it
- **AND** the agent suggests a supported field value for the user to enter through the normal BMAD workflow
- **AND** the agent preserves the unknown result without assuming independence, adding all earlier stories, or falling back to an LLM

#### Scenario: Clarification in chat
- **WHEN** the user explains a dependency but the strict parser still rejects the current BMAD field
- **THEN** the agent keeps implementation on hold
- **AND** a fresh CLI check must confirm the corrected field before implementation starts

#### Scenario: Prepare a blocked story
- **WHEN** prerequisites are incomplete or their dependency fields are unknown
- **THEN** the agent can prepare and refine the change
- **AND** the agent identifies the stories to complete or fields to clarify before implementation

### Requirement: Change refinement and approval

After generation, the skill SHALL direct the agent to refine the specs, design, and tasks and present the change to the user before implementation. OpenSpec refinements MUST stay in the change. Changes to BMAD source requirements MUST go through their owning BMAD workflows before the linked change is refined against them.

#### Scenario: Refine a scenario in a change
- **WHEN** the agent refines a generated change
- **THEN** the agent records the refinements in OpenSpec and presents them for approval
- **AND** the agent leaves BMAD planning content unchanged

### Requirement: Single implementation workflow

The implementation skill SHALL hand the approved change to the existing OpenSpec apply workflow with an explicit change ID only after `change check --story <N.M> --json` succeeds. On any other result, the agent MUST stop before implementation. The agent MUST NOT run the BMAD build/dev workflow for the same story. The agent SHALL run application checks during implementation and record task completion in OpenSpec.

#### Scenario: Implement an approved change
- **WHEN** the user asks to implement a prepared change
- **THEN** the agent checks dependencies through the CLI and, on success, runs OpenSpec apply, verifies the result, and marks completed tasks
- **AND** the agent keeps a single implementation backlog in OpenSpec

#### Scenario: Incomplete prerequisite
- **WHEN** the CLI reports incomplete direct or transitive prerequisites
- **THEN** the agent stops before calling OpenSpec apply or editing code or the checklist
- **AND** the agent reports the prerequisite IDs, titles, states, and the order imposed by their dependencies
- **AND** the agent leaves selection of another story to the user

#### Scenario: Select a change by ID or context
- **WHEN** the user selects a change by ID, through conversation context, or as the only active linked change
- **THEN** the agent uses status to identify the exact story ID and runs the same dependency check
- **AND** the check can block implementation regardless of how the change was selected

#### Scenario: Resume implementation
- **WHEN** the developer asks to resume a partially implemented change
- **THEN** the agent repeats extraction and the check against the current backlog and prerequisite statuses
- **AND** a previous successful check does not authorize resumption

#### Scenario: Unknown or invalid dependencies
- **WHEN** the check fails, reports an unknown state, or returns an invalid response
- **THEN** the agent stops and reports the diagnostic and the action needed to resolve it
- **AND** prior approval, the `active` phase, and completed tasks cannot override the check

#### Scenario: Error confined to an unrelated branch
- **WHEN** extraction or status reports a problem with another story, but the selected story's link is confirmed and its targeted check returns `ready`
- **THEN** the agent can pass the approved change to OpenSpec apply
- **AND** the exit code from full-backlog extraction cannot substitute for the targeted check

### Requirement: Close and inspect state through the CLI

Skills SHALL use the CLI to close changes and inspect state. The agent MUST leave registry edits, BMAD status updates, and archive moves to the CLI. The CLI MUST NOT call an LLM or require a separate agent report at close.

#### Scenario: Close after implementation
- **WHEN** implementation and its checks are complete
- **THEN** the agent calls the CLI close command with the change ID and reports its actual result
- **AND** if close fails, the agent does not manually mark the story `done`

### Requirement: Story progress checklist

The CLI SHALL provide a read-only `change progress --story N.M` command for active linked stories. Each apply message reporting completion of one or more tasks MUST end with the command's fresh output in a plain text block after the task checkboxes have been updated.

#### Scenario: Render a partially implemented story
- **WHEN** the selected story has checked and unchecked OpenSpec tasks
- **THEN** the command prints `Прогресс по истории N.M · готово C из T`, one blank line and the task descriptions in source order
- **AND** every checked task has a ✓, the first unchecked task has a →, and each subsequent unchecked task has a ○, followed by a space and the original description

#### Scenario: Report completion of the last task
- **WHEN** all tasks have been checked
- **THEN** every row has a ✓ and the completed count equals the total

#### Scenario: Progress unavailable
- **WHEN** the active link cannot be confirmed, or the task list is unavailable or empty
- **THEN** the command exits unsuccessfully and provides a diagnostic without printing a checklist
- **AND** the agent reports the diagnostic in place of the checklist

### Requirement: Close messages end with current epic progress
After a successful close, the agent SHALL report the outcome and end its message with fresh CLI output for the linked story's epic in a plain text block. It SHALL request the just-closed annotation when this operation completed closure, including a successful retry of a pending BMAD update.

#### Scenario: Successful story closure
- **WHEN** close succeeds for a previously open story
- **THEN** the final block includes the annotated story and every sibling from its epic

#### Scenario: Already closed
- **WHEN** close confirms an already closed story
- **THEN** the agent shows current epic progress without the just-closed annotation

#### Scenario: Pending closure or unavailable progress
- **WHEN** closure fails, including after archiving, or the follow-up epic view cannot be read
- **THEN** the agent ends with the diagnostic in place of the checklist and reports the actual close outcome

### Requirement: Select the next workflow step in chat

The four MadOpenSpec skills SHALL use `request_user_input_async` when available, localize the question and prose choices to the user's language, and offer exact invocations with the resolved identifiers. The agent SHALL invoke the selected skill only after the user submits a reply. Without cards it SHALL display the same choices as text.

#### Scenario: Choose a story or recommended action
- **WHEN** guide recommends an actionable command
- **THEN** it offers the exact command as a ready reply
- **AND** when several stories qualify, it offers their IDs and titles for selection first

#### Scenario: Approve or revise a validated plan
- **WHEN** prepare presents the validated plan for story N.M
- **THEN** it asks whether to approve the plan and start implementation with choices to submit `$mad-openspec-apply story N.M` or request revisions
- **AND** submitting apply approves that plan, while requesting revisions returns to refinement and validation

#### Scenario: Offer closure once after successful implementation
- **WHEN** apply has completed every task and all applicable checks have passed
- **THEN** it sends the final report and offers a separate card to run `$mad-openspec-close <changeId>` or leave the change open
- **AND** partial progress, failed checks and an unanswered card do not trigger closure or repeated prompts

#### Scenario: Continue after closing a story
- **WHEN** close succeeds and project-wide status confirms unfinished stories
- **THEN** close offers a separate card to select the next story with `$mad-openspec-guide` or finish
- **AND** guide starts at project scope after this choice

#### Scenario: Finish the project
- **WHEN** close succeeds and all stories are complete
- **THEN** the workflow ends with the close report

#### Scenario: Preserve progress in a text-only client
- **WHEN** apply or close offers a next step without a choice card
- **THEN** the question and the same options precede the final verbatim CLI output block

### Requirement: Handle changes to an approved story during apply

The apply skill SHALL distinguish implementation adjustments from changes to an agreed requirement or acceptance criterion. On a changed outcome it MUST pause implementation and task completion, state the old and new criterion and affected documents, and carry forward any explicit user decision.

#### Scenario: Repair the parser to meet the approved criterion
- **WHEN** the parser needs a fix to find a house in NSPD and confirm its cadastral number as agreed
- **THEN** the agent continues the current OpenSpec apply and verifies the existing criterion

#### Scenario: Accept a map outline and defer confirmation to scene creation
- **WHEN** the user decides that displaying a Yandex or OSM building outline suffices at lookup and that house confirmation is required separately at scene creation
- **THEN** the agent pauses code edits and task completion and records the changed criterion and affected BMAD and OpenSpec documents
- **AND** it uses the decision without asking the user to choose the behavior again

#### Scenario: Update affected BMAD sources
- **WHEN** the changed criterion affects BMAD planning content
- **THEN** the agent identifies the installed workflows owning the story, epic, requirements source (PRD or `SPEC.md`) and architecture and uses the owners to update the affected artifacts
- **AND** apply makes no direct BMAD edits, including to `epics.md`
- **AND** if a required workflow cannot update an artifact, the agent names the workflow, artifact and blocker and keeps implementation paused

#### Scenario: Reconcile completed work and resume the same story
- **WHEN** the affected BMAD documents reflect the decision
- **THEN** the agent invokes prepare for the same story ID and refines requirements, design, tasks and verification in the existing linked change
- **AND** it retains work and completion marks supported by the revised criteria and reopens tasks needing changes
- **AND** after strict validation succeeds it presents the revised plan for approval
- **AND** only after approval does it invoke MadOpenSpec apply for the same story and require a fresh successful `mad-openspec change check --story N.M --json` before resuming OpenSpec implementation

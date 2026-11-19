---
name: mad-openspec-guide
description: Explain the current MadOpenSpec workflow stage and recommend the next step from project status. Use when the user asks where they are in the workflow, what remains, or what to do next, optionally for a specific BMAD story or linked change.
---

# Guide the user through MadOpenSpec

Explain where the project or selected story stands and recommend one next step. Guide is read-only. If the user has separately requested an action, continue with the applicable workflow after the explanation.

## Read status and select a focus

From the target project root, run `mad-openspec status --json`. For a local npm installation, use `npx --no-install mad-openspec`. Distinguish terminal commands from chat invocations such as `$mad-openspec-prepare story 1.2`.

Use `inputs`, `summary`, `epics`, `stories` and `issues` from the same report. Read `summary.stage` for the project, `workflowState` for a story's lifecycle and `dependencyState` for its prerequisites. Adapt the general `nextSteps` to the selected story and its diagnostics. Use the reported dependencies. Story numbers and narrative mentions do not establish edges.

Exit code 1 can accompany a usable JSON report. Explain the available facts and the specific diagnostic. If the command fails, the JSON is invalid or required fields are missing, identify what remains unknown. An incomplete report cannot establish that the project has no work. Leave installation repairs to an explicit request.

If status reports `VERSION_MISMATCH`, report the project and CLI versions and the recovery instruction before selecting a story. The operator can preview a supported migration with `mad-openspec update --dry-run`.

Choose the focus in this order:

1. A story ID (`story N.M`) or linked change ID (such as `story-1-2`) supplied by the user. Confirm the match in `stories`. If it is missing, report that and keep the user's selection.
2. A single story or change already selected in the conversation. When the user asks to select the next story, including from the close skill, start a fresh project overview at step 4.
3. The sole story in `summary.activeStoryIds`.
4. A project overview. If several stories are open, list their IDs, titles and states and ask the user to choose. If none are open, show unfinished candidates, taking known dependencies into account. Recommend a sole suitable candidate with the reason. Story order alone cannot determine the choice.

## Recommend the next step

Check the source data, selected link and pending operations first. Report unrelated branch errors separately from the selected story's readiness. Use exact story and change IDs in the response.

| Reported state | Recommended action |
| --- | --- |
| Document paths unknown | Ask where the documents are, or suggest `mad-openspec setup` if the tools still need setup. Unknown paths do not establish that documents or tools are missing. |
| Backlog missing | Continue BMAD preparation. Explain that status cannot distinguish the brief, PRD, UX and architecture stages. If the conversation confirms these are ready, suggest `$bmad-create-epics-and-stories`. Otherwise, ask which materials exist. |
| Backlog present, sprint status missing | Suggest `$bmad-sprint-planning`. |
| Both documents ready, project disconnected | Suggest `mad-openspec connect`. If sources are ambiguous, list the candidate paths for the user to choose. If the connection is damaged, address the reported cause before reconnecting. |
| Unfinished story without a linked change | Suggest `$mad-openspec-prepare story N.M`. BMAD `in-progress` or `review` alone does not establish a link. |
| Active change, story `prepared` | No task progress is recorded. If approval is unknown, recommend reviewing and approving the change. After approval, suggest `$mad-openspec-apply story N.M`. A task list alone cannot confirm planning or approval. |
| Active change, story `in-progress` | Suggest resuming with `$mad-openspec-apply story N.M`, taking dependencies and approval into account. |
| All tasks complete, change open | If implementation checks are unknown or failed, recommend completing the applicable tests, lint, type checks and build. Once passing checks are confirmed, suggest `$mad-openspec-close <change-id>` with the ID from status. |
| Story closed | Report completion and offer a choice of unfinished stories. For `summary.stage: complete`, report that all stories are closed according to the available data. Release and epic closure require separate evidence. |

When implementation is the next step, use the selected story's dependency state:

- **`blocked`** — List unfinished prerequisites from `blockedBy`, with titles and dependency chains. Recommend completing them first and keep the selected story in focus. Its change can still be prepared.
- **`unknown` or `invalid`** — Show the specific diagnostic and identify what source data needs clarification or correction. An empty `blockedBy` alone cannot establish readiness. Dependencies are unconfirmed before connect.
- **`ready`** — Recommend apply for an approved change. Apply must run a fresh `mad-openspec change check --story N.M --json` immediately before implementation.

Dependency state does not prevent prepare or close. For `attention` or `unknown`, base guidance on `issues` and `phase`. For `BMAD_UPDATE_PENDING` or `archived`, recommend fixing the reported BMAD issue and retrying close for the exact change ID. For `RECOVERY_REQUIRED`, recommend reviewing the evidence and following the recovery procedure in the installed package's `docs/usage.md`. A second archive or merge risks repeating the operation. For other errors, use the actual diagnostic. Keep implementation in the MadOpenSpec apply workflow. Avoid direct upstream OpenSpec apply or parallel BMAD development for the same story.

## Summarize project status

State what is ready, what remains and why the recommended action follows. Identify any unknown checks, approvals or early BMAD stages.

Use `request_user_input_async` for choices when available. Ask in the user's language. If several stories qualify, offer one option per story with its actual `storyId` and title. Use the submitted choice to focus the recommendation. When the recommended action has a command, offer that exact command as a ready reply, for example `$mad-openspec-prepare story 1.4`. Substitute the selected story's actual `storyId` or linked `changeId`. If cards are unavailable, show the same options in text. Wait for a submitted reply before invoking the selected skill.

For example, when a story is prepared and approval is unknown:

> Story 1.2 has an open change, `story-1-2`, with no tasks marked complete. Review and approve the change. Once approved, run `$mad-openspec-apply story 1.2` in chat. The skill will check the dependencies again before implementation.

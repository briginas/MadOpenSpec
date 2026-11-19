---
name: mad-openspec-apply
description: Use when a user requests implementation of an agreed OpenSpec change linked to a BMAD story in a MadOpenSpec project.
---

# Implement an approved change

Invoke this skill in Codex chat with the same story ID used for preparation.

```text
$mad-openspec-apply story 1.2
```

## Select the linked change

Run `mad-openspec status --json` with the installed CLI. For a local npm installation, use `npx --no-install mad-openspec`.

1. For `story N.M`, find the exact `storyId` in the report and read its `changeId`. For a change ID, as in `$mad-openspec-apply story-1-2`, match `changeId` directly. Always confirm the link in the report.
2. With no argument, use the story or change clearly selected in the conversation. Otherwise, use the sole linked change with `phase: active`. If several qualify, list their story IDs, titles and change IDs and ask the user to choose. If none qualify, suggest preparing the intended story.
3. If the specified story is missing or has no change, explain and suggest `$mad-openspec-prepare story N.M`. If the specified change has no BMAD story link, report that and stop. Keep the user's selection throughout apply.
4. Require `phase: active`. For a closed or archived change, report its state. For incomplete creation or recovery, show the status diagnostic. Stop if status fails to produce valid JSON, the link cannot be confirmed, or the selected change has an ownership or recovery error. A status exit code of 1 caused solely by unknown or invalid dependencies in another branch still allows a targeted check of this story.

Tell the user the story ID and change ID. A submitted apply choice for this plan from prepare counts as approval. If approval is missing or unclear, ask the user to approve the change before implementation.

## Check readiness immediately before implementation

After confirming the link, phase and approval, run the following command before calling the OpenSpec skill, editing code or updating task checkboxes. Substitute the exact `storyId` from the selected status record, including when selection began with a change ID.

```sh
mad-openspec change check --story N.M --json
```

Proceed only on exit code 0 with valid JSON containing all of the following:

- `schemaVersion: 1` and the selected `storyId`.
- `dependencyState: ready` and a `dependsOn` array of valid story IDs.
- Empty `blockedBy` and `issues` arrays.

Stop on any other result, including missing output, command failure, invalid JSON or a mismatched ID. For `blocked`, report the prerequisite IDs, titles, statuses and dependency chains, and explain which stories must finish first. For `unknown` or `invalid`, identify the field and line or damaged data and request the specific correction. A chat answer, a manually supplied graph or an LLM interpretation cannot override the source field. Leave BMAD edits and any move to a prerequisite story to the user's explicit choice.

Repeat the link and phase checks and run a fresh targeted check whenever implementation resumes or the selected story changes. Earlier checks, project-wide reports and completed tasks cannot authorize a later run. This check covers invocations through this skill. Calling upstream OpenSpec directly bypasses it.

## Implement and report

Apply the following reporting rule throughout the upstream workflow, including its final report. After recording one or more completed tasks in OpenSpec, run `mad-openspec change progress --story N.M` with the selected story ID before sending the completion message. Put the step result and any checks first. End the message with the command's exact stdout in a plain text code block. Run it again for each completion message so the arrow reflects the latest checkboxes. If the command fails, report its diagnostic in place of the checklist.

**Required sub-skill:** Invoke `openspec-apply-change` with the exact change ID, for example `story-1-2`. It reads native OpenSpec status, apply instructions and every returned context file, implements the tasks and tracks them in OpenSpec. If the skill is missing, report that and suggest the standard OpenSpec setup. MadOpenSpec has no separate CLI apply command.

Run the target project's applicable tests, lint, type checks and build. Check off completed tasks and confirm progress in OpenSpec. Report the change ID, progress, actual check results and any missing context. Keep implementation in OpenSpec. Skip the parallel BMAD build/dev workflow for this story and leave its documents, tasks and statuses as they are. Use `$mad-openspec-close` for formal closure, when the CLI archives the change and updates BMAD status.

Offer closure once, only when all tasks are complete and all applicable checks have passed. Ask in the user's language, using “Закрыть изменение `<changeId>`?” in Russian. Offer `$mad-openspec-close <changeId>` and “Оставить изменение открытым” (localized). Use the actual linked `changeId` in both places.

When `request_user_input_async` is available, send the implementation report as an intermediate chat message ending with the verbatim progress block. Immediately call the tool in the same turn and wait for the user's reply before sending a final response. In a text-only client, put the question and choices before the report's final CLI block. Invoke close only after the user submits the close choice. Leaving the change open ends apply.

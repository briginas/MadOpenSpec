---
name: mad-openspec-close
description: Use when implementation of a linked MadOpenSpec change is finished or its archive succeeded but BMAD completion needs retrying.
---

# Close an implemented change

Confirm the exact change ID from the user's request and `mad-openspec status --json`. Keep the matching row's `storyId`, `epicId` and pre-close `phase`. Use the installed CLI, or `npx --no-install mad-openspec` for a local npm installation. Once implementation and its applicable checks are complete, close the change. For example:

```sh
mad-openspec change close story-1-2
```

Close verifies the story link, required artifacts, a nonempty checklist with every task complete, and strict OpenSpec validation. It then archives the change and updates BMAD. Report tests, lint, type checks and build results only if they ran during implementation. Close neither runs those checks nor requires an agent report.

| Outcome | What to report or do |
| --- | --- |
| Incomplete tasks or invalid change | Report the error code and cause. Resolve the issue in OpenSpec. |
| Confirmed archive with a pending BMAD update (`archived` / `BMAD_UPDATE_PENDING`) | Correct the BMAD issue identified by the diagnostic and retry close with the same change ID. The retry completes outstanding writes and skips archiving. |
| `RECOVERY_REQUIRED` | Stop automatic retries. The archive outcome is uncertain. Show the state and available evidence and refer to the recovery procedure in the installed package's `docs/usage.md`. Avoid manual status or registry edits, a second merge, or moving archives. |
| Success | Report the change ID, `closed` phase, archive path, BMAD `done` status and any remaining issues. |

After success, run `mad-openspec status --epic N --just-closed N.M` with the saved IDs. If the pre-close phase was already `closed`, run `mad-openspec status --epic N` instead. End the message with the command's fresh stdout verbatim in a plain text code block, after the outcome and any checks. A successful retry from `archived` qualifies for the annotation.

Use a fresh project-wide `mad-openspec status --json` after success to check for unfinished stories across all epics. When all stories are done, end with the report. If the project status is inconclusive, report the diagnostic before the epic block and offer a next step only if an unfinished story is confirmed.

When work remains, ask in the user's language, using “Перейти к выбору следующей истории?” in Russian. Offer `$mad-openspec-guide` and “Закончить на этом” (localized).

When offering these choices with `request_user_input_async`, send the close report as an intermediate chat message ending with the verbatim epic block or its read diagnostic. Immediately call the tool in the same turn and wait for the user's reply before sending a final response. In a text-only client, put the question and choices before the report's final CLI block or diagnostic. Only a submitted guide choice opens project-wide story selection. The finish choice ends the workflow.

If close fails, inspect `mad-openspec status --json` for recovery details and end with the closure diagnostic. If only the epic read fails, report the successful close and end with the read diagnostic.

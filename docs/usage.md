# MadOpenSpec usage guide

Run shell commands from the **target project root**. Send skills beginning with `$` as messages in that project's Codex chat. For the installation commands and a first story walkthrough, start with the [README](../README.md).

[Setup](#installation-and-setup) · [Connect](#connecting-a-backlog) · [Dependencies](#story-dependencies) · [Prepare and apply](#preparing-a-selected-story) · [Close and recover](#closing-a-change-and-recovering-from-errors) · [Status](#status) · [Update](#update-madopenspec-in-an-existing-project)

## Installation and setup

`mad-openspec setup` installs BMAD 6.12.4 with BMM, OpenSpec 1.16.0 with the built-in `spec-driven` schema, and the Codex skills. It uses the installers pinned in the CLI checkout. Run `mad-openspec setup --dry-run` to inspect the plan before writing files.

| To configure | Option | Default for a new project |
| --- | --- | --- |
| BMAD user name | `--user-name <name>` | `Developer` |
| BMAD conversation language | `--communication-language <language>` | `Russian` |
| BMAD document language | `--document-output-language <language>` | `Russian` |
| OpenSpec location | `--openspec-root <directory>` | Project root (the parent of `openspec/`) |

Fresh OpenSpec artifacts use English. Setup preserves compatible installations and their settings. It reports conflicts for incompatible versions, modified skills, conflicting explicit settings, or unsafe paths. Keep the OpenSpec store inside the project and use the built-in schema without overrides.

Add `--json` to setup or its preview for `steps`, `issues`, `nextSteps`, and the overall `toolchain` result (`planned`, `ready`, `blocked`, or `failed`). If an installer fails, correct the reported issue and rerun setup. For `SETUP_RECOVERY_REQUIRED`, compare the component files with `.mad-openspec/setup-state.json` and resolve the partial installation first.

## Connecting a backlog

Run `mad-openspec connect` once BMAD has produced the epics document and sprint status file. Use `--json` to see each chosen path and its source. A compatible manual installation can connect directly.

| Document | Where automatic discovery looks |
| --- | --- |
| Epics | `epics*.md` directly in `modules.bmm.planning_artifacts` |
| Sprint status | `sprint-status*.yaml` directly in `modules.bmm.implementation_artifacts` |

Discovery uses Python 3.11+ and BMAD's `_bmad/scripts/resolve_config.py`. It applies `_bmad/config.toml`, `_bmad/config.user.toml`, `_bmad/custom/config.toml`, and `_bmad/custom/config.user.toml` in that order. If no file matches, check the configured directory. If several match, select the intended file with its flag. Passing both paths also works without Python.

```sh
mad-openspec connect --epics planning/epics.md --sprint-status planning/sprint-status.yaml
```

The manifest defaults to `_bmad/_config/manifest.yaml` and must report `installation.version: 6.12.4`. Use `--bmad-manifest` or `--openspec-root` for other locations. Backlogs use `## Epic N:` and `### Story N.M:` headings. Each selected story must have exactly one sprint key of the form `N-M-title` or `N-M`.

Commit `.mad-openspec/config.json` and `.mad-openspec/registry.json` with the project. The config saves document paths for later runs. The registry records story-to-change links. Reconnecting with conflicting paths reports an error. In older scripts, replace `mad-openspec init` with `mad-openspec connect`.

## Story dependencies

Give each story one dependency field. Use `**Dependencies:** none` for a story that can start immediately, or `**Dependencies:** Story 1.1, Story 2.3` for prerequisites. IDs can cross epics. Story order alone has no effect.

```sh
mad-openspec dependencies extract          # Check the whole backlog
mad-openspec change check --story 1.2      # Can this story start?
```

Both commands read the current files and accept `--json`. Extraction reads only the backlog. The targeted check also reads sprint status and the registry and follows transitive prerequisites. An unrelated cycle or unknown field can fail extraction while the selected story is ready.

| Readiness | What to do |
| --- | --- |
| `ready` | Start or resume the approved change. The check exits with 0. |
| `blocked` | Finish the named prerequisite. An unlinked story needs BMAD status `done`. A linked story also needs verified closure. |
| `unknown` | Clarify the field in the backlog or fix the unreadable or inconsistent source named in the diagnostic. |
| `invalid` | Correct a graph error such as a cycle, duplicate edge, self-reference, or missing story ID. |

A targeted check exits with 1 for any state other than `ready`. Extraction exits with 1 for unknown or invalid data anywhere in the backlog. You can still prepare a story or close a completed change. If either check reports `SOURCE_CHANGED`, wait for edits to finish and rerun it.

### Accepted field values

The labels `Dependencies` and `Зависимости` are case-insensitive and accept the colon inside or outside the bold text. Values are case-sensitive and must match in full. IDs are positive integers without leading zeros.

| Value | Meaning |
| --- | --- |
| `Story 1.1` or a comma-separated list of `Story N.M` references | Depends on the listed stories. A final period is optional. |
| `Story 1.1; будущих stories нет.` | Same result. The suffix also works after a list. |
| `none`, `нет`, `отсутствуют`, `нет зависимостей между stories` | No prerequisites. A final period is optional. |
| `только существующий движок и интерфейс; Story 1.2 для завершения этой story не требуется.` | No prerequisites. The full phrase accepts any one valid story ID. |

Missing, empty, repeated, or partially recognized fields produce `unknown`. The parser ignores ordinary prose and fenced examples. In extraction JSON, `source` identifies the backlog path and hash. Each story includes the original field and line, `extractionState`, `dependsOn` (IDs, `[]`, or `null`), and issues. Check JSON gives the selected `storyId`, `dependencyState`, and each blocker's shortest `chain`. See the [sample backlog and expected results](examples/story-dependencies/README.md).

## Preparing a selected story

Send `$mad-openspec-prepare story 1.2` in Codex. The agent reads the story, related requirements, current specs, and active changes. It creates `story-1-2`, refines its proposal, delta specs, design, and tasks, and presents the change for your approval.

After approval, send `$mad-openspec-apply story 1.2` or `$mad-openspec-apply story-1-2`. With no argument, apply uses the story selected in the chat or the sole active linked change. It asks you to choose if several qualify. At every start or resume it checks readiness for that story, then invokes the upstream OpenSpec apply skill and runs the project's applicable checks.

To see the checklist, run `mad-openspec change progress --story 1.2`. A check mark means complete, an arrow marks the first open task, and a circle marks each later open task.

### Create a change from JSON

For scripts or manual preparation, save input matching the [change input schema](../schemas/change-input.schema.json). For example, given story `1.2` in the configured backlog and requirement `FR1` in its PRD, save this as `change-input.json`.

```json
{
  "schemaVersion": 1,
  "story": {"id": "1.2", "source": "planning/epics.md"},
  "title": "Invite a team member",
  "why": "The team owner needs to invite members by email.",
  "references": [{"path": "planning/prd.md", "requirementId": "FR1"}],
  "capabilities": [{
    "path": "invitations",
    "purpose": "Invite members by email and show pending invitations to the team owner.",
    "requirements": [{
      "operation": "ADDED",
      "name": "Invite a team member",
      "text": "The system SHALL send an invitation by email.",
      "scenarios": [{
        "name": "Successful invitation",
        "given": "a team exists",
        "when": "the owner invites a member",
        "then": "the member receives an email",
        "and": ["the invitation appears in the list", "the system sends no duplicate email"]
      }]
    }]
  }]
}
```

```sh
mad-openspec change create --story 1.2 --input change-input.json
```

Add `--story-file <path>` to register a separate BMAD story file. If `tasks` is omitted, the CLI generates implementation and verification tasks from each THEN and AND. Review the generated change before apply.

For `MODIFIED`, match the existing requirement name exactly and retain its scenarios. For `REMOVED`, supply `reason` and `migration`. For `RENAMED`, supply `from` and the new `name`. Keep names and scenario fields on one line.

Repeating create with identical input preserves refinements. For `STORY_ALREADY_LINKED`, continue with the existing change. After an interruption, retry the original input. The CLI restores missing files only when it can verify ownership.

## Closing a change and recovering from errors

After implementation and project checks, run `mad-openspec change close story-1-2` or send `$mad-openspec-close story-1-2` in Codex. Close verifies the link, required artifacts, a nonempty completed checklist, and strict OpenSpec validation. It archives the change, updates the main specs, saves an archive receipt, and marks the BMAD story and its registered story file `done`. Closing the last story leaves the BMAD epic status unchanged.

| Outcome | Next action |
| --- | --- |
| Incomplete tasks or invalid specs | Fix the change, run the applicable checks, and retry close. |
| `BMAD_UPDATE_PENDING` or phase `archived` | Fix the reported BMAD issue and retry close with the same change ID. The CLI verifies the saved receipt and finishes the outstanding writes. |
| `RECOVERY_REQUIRED` | Stop retries. Compare the operation log, archived marker, original delta, and main specs to establish which writes succeeded. A second merge or manual edit to the registry or BMAD status can hide an incomplete update. |
| `PROJECT_LOCKED` | Read the PID in `.mad-openspec/write.lock`. Remove a stale lock only after verifying the process has exited. |
| Phase `closed` | Review and commit the result. Repeating close preserves the files. |

Keep main spec targets inside `openspec/specs/` and remove symlinks inside the change before archive. Avoid concurrent edits while close is running. An already-synced delta can close successfully with `specsUpdated: false` and zero archive totals.

## Status

| To see | Run |
| --- | --- |
| Counts, open stories, blockers, and next steps | `mad-openspec status` |
| Every epic and story, including completed work | `mad-openspec status --summary` |
| A checklist for one epic | `mad-openspec status --epic 1` |
| The full machine-readable report | `mad-openspec status --json` |

All views are read-only. Before connection, status looks for the BMAD documents. Missing files can be normal during planning. After connection, it uses the saved paths. For a plain-text epic checklist highlighting a verified closure, use `status --epic 1 --just-closed 1.2`. Set `NO_COLOR=1` to disable terminal colors.

### JSON report

`inputs` identifies document paths and whether each input is present, missing, unknown, ambiguous, or invalid. Ambiguous inputs include candidates. If the backlog is unreadable, the report may contain empty story and epic lists. `summary` gives the project stage, counts, active story IDs, and next steps.

Each story has a BMAD status, change ID and phase when linked, task counts when available, and dependency details (`dependencyState`, `dependsOn`, `blockedBy`). Its `workflowState` describes recorded progress.

| State | How to read it |
| --- | --- |
| `not-started` | Unlinked story in the backlog or ready for development. |
| `prepared` | Active change with a nonempty checklist and no recorded implementation progress. Review approval before apply. |
| `in-progress` | Partly completed checklist or BMAD status `in-progress` or `review`. |
| `tasks-complete` | All tasks checked. Confirm project checks and close the change. |
| `done` | BMAD records completion and any linked change has verified closure. |
| `attention` | An operation is incomplete or records conflict. Read the diagnostic. |
| `unknown` | Evidence is missing, unreadable, or unrecognized. |

Status exits with 0 for a successful report. Known blockers or a missing dependency field alone allow exit 0, even when that story's readiness check exits with 1. Other diagnostics, including ambiguous inputs and cycles, give exit 1. Invalid command arguments give exit 2. For commands supporting `--json`, stdout contains one report even on operational failure.

### Choosing the next step

Send `$mad-openspec-guide` for help interpreting status or `$mad-openspec-guide story 1.2` to focus on one story. The guide reads project state and recommends the next command or skill. Before the backlog exists, it may ask which planning documents you have completed.

## Update MadOpenSpec in an existing project

From the target project, run the CLI version you want the project to use.

```sh
mad-openspec --version
mad-openspec update --dry-run
mad-openspec update
mad-openspec status
```

Update refreshes the four managed skills, the setup receipt if present, and the version pin in a connected project. It works before backlog connection and can adopt an unversioned connection or migrate versions 0.3.3 through 0.3.6. For other versions, use the CLI identified by the diagnostic. Add `--json` to see affected files. If a managed skill was edited locally, save your edits and restore its released contents before retrying.

## Installing Codex skills

Setup normally installs all four MadOpenSpec skills and the upstream OpenSpec apply skill. To install **only the four MadOpenSpec skills**, run the following from the target project root with the checkout or installed package path. It copies missing files, skips identical skills, and reports conflicts for local modifications.

```sh
node --input-type=module - /absolute/path/to/MadOpenSpec <<'JS'
import path from 'node:path';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const packageDir = path.resolve(process.argv[2]);
const entry = existsSync(path.join(packageDir, 'src/setup.ts')) ? 'src/setup.ts' : 'dist/src/setup.js';
const {copySkill} = await import(pathToFileURL(path.join(packageDir, entry)).href);
for (const name of ['mad-openspec-guide', 'mad-openspec-prepare', 'mad-openspec-apply', 'mad-openspec-close']) {
  await copySkill(process.cwd(), name);
}
JS
```

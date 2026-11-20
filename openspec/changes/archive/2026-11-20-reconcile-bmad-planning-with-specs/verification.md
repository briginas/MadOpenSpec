# Bench rotation acceptance walkthrough

## Inputs

Start with a setup-only project and `--openspec-root product`. The current BMAD SPEC has a yard-view capability and a non-goal reading “Yard editing is deferred.” The PRD references that SPEC. The prepared architecture describes bench placement, and the UX document describes selecting a bench on the yard plan.

Add the accepted requirement “Move a bench” directly to `product/openspec/specs/bench-placement/spec.md`. A resident can move a bench, its entire footprint must stay inside the yard, and an invalid move retains the last placement. The request is to add rotation. Use a fresh copy of these inputs for each entry point.

## Observations

| Entry point | Outcome of following the installed instructions |
| --- | --- |
| `$bmad-spec` | The blanket deferral conflicted with the accepted movement requirement. The SPEC update recorded movement as accepted, rotation as the requested capability, and other yard editing as deferred. The yard boundary still applied. |
| Direct `$bmad-create-epics-and-stories` | Requirements extraction started with the original stale documents. The active workflow resolved the shared rule without an earlier SPEC planning session. The SPEC owner's update path appended the decision to the memlog and re-derived the SPEC before decomposition. The coverage map linked movement to its OpenSpec requirement. The backlog contained one story, “Rotate a placed bench,” with the yard boundary in its acceptance criteria. |

This was a manual walkthrough of the installed skill instructions. BMAD's customization resolver and memlog script ran in both paths. MadOpenSpec's backlog parser checked the resulting story list. The smoke test independently exercises the resolver for all four installed skills.

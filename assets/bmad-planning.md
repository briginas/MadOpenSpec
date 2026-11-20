# Planning changes to an existing product

Once you know which product behavior the request affects, locate the current capability specifications under `openspec/specs/`. Resolve this directory relative to the connected project's `openspec.root` in `.mad-openspec/config.json`, or the setup receipt's `settings.openspecRoot` in `.mad-openspec/setup-state.json` before connection. The default root is the project directory.

Read the requirements and scenarios for the affected capabilities, including behavior accepted directly through OpenSpec. Compare them with the request and the current BMAD SPEC or PRD. Use the main specs as the accepted baseline. If the directory is missing, empty, or contains no relevant requirements, continue the ordinary workflow.

Summarize the comparison with references to the relevant capability requirements and the affected BMAD statements. Identify behavior already covered, the requested additions or changes, and existing constraints that must still hold. A previous comparison can be reused after checking that it covers the current request and still reflects the relevant main specs and planning document. Refresh the affected part when the scope or sources change.

Apply the comparison at the following points in the active workflow.

- **bmad-spec and bmad-prd** — Compare before committing new or updated product requirements. In validation mode, report discrepancies only. Leave the product requirements as they are.
- **bmad-correct-course** — Compare before drafting the sprint change proposal. Base the proposed work on the outstanding change.
- **bmad-create-epics-and-stories** — Compare during requirements extraction, including direct invocation with existing documents and resumed planning before drafting affected stories. If a source requirement is stale, have its owner update it and read the corrected source before forming those stories. Count accepted capabilities as already covered in requirements coverage. Create stories only for outstanding work. Carry applicable constraints into their acceptance criteria.

If a conflict affects the plan and leaves the intended behavior ambiguous, show the specific OpenSpec requirement and BMAD statement, explain which decision changes the plan, and ask the user to resolve it. Hold the affected planning decision until answered. Route agreed changes to SPEC through bmad-spec and to PRD through bmad-prd using the owner's normal update workflow. Keep the product-level decision and references in BMAD and the detailed scenarios in OpenSpec.

# Language Guidelines

- Communicate with the user in Russian.
- Write all project documentation in English.

# OpenSpec Workflow

- Use an OpenSpec change for features and fixes that introduce or revise a requirement. Examples include changes to CLI output, exit codes, and story selection rules.
- Before editing code, check the current specs and active changes. Use an existing change if it covers the work. Otherwise, create a change and record the expected behavior, acceptance scenarios, and tasks.
- Implement against the change, verify the acceptance scenarios, and mark tasks complete as they pass. Keep proposed requirements in the change's delta spec until sync or archive.
- Direct edits are appropriate for typo fixes, formatting, behavior-preserving refactors, and small fixes that restore behavior already covered by the current spec.

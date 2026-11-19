# BMAD story dependencies example

The [sample backlog](epics.md) contains two stories and doubles as a fixture for the parser and end-to-end CLI tests. Its dependency fields use exact Russian phrases recognized by the parser. Once you connect the file as your backlog, run `mad-openspec dependencies extract --json` to inspect the graph and `mad-openspec change check --story 1.2 --json` to check readiness for Story 1.2.

## Expected graph

```json
{
  "1.1": [],
  "1.2": ["1.1"]
}
```

- Story 1.1 requires only the existing engine and interface. Its field explicitly excludes Story 1.2.
- Story 1.2 requires Story 1.1. The suffix meaning “no future stories” preserves that dependency.
- The parser ignores frontmatter, epic fields, implementation order, references in scope descriptions, and fenced code blocks.

## When can Story 1.2 start?

| State of Story 1.1 | Dependency check for Story 1.2 |
| --- | --- |
| BMAD `backlog`, `in-progress`, or `review` | `blocked`. Complete Story 1.1, “Show health during combat,” first. |
| BMAD `done`, with no linked MadOpenSpec change | `ready` |
| BMAD `done`, with a verified closed change | `ready` |
| Linked change still `active` or `archived` | Finish closing the change before starting Story 1.2. |

A `ready` result confirms the prerequisites. Apply checks the phase of Story 1.2, approval, and other implementation conditions separately.

## When dependencies are unknown

Replacing the dependency field of Story 1.1 with either of the following examples produces `unknown` and `dependsOn: null`:

```markdown
**Dependencies:** Story 1.2 is not required
```

Excluding a single story leaves other possible prerequisites unspecified.

```markdown
**Dependencies:** Story 1.2; possibly also authentication
```

The parser requires a complete match, so it discards the partial reference to Story 1.2. A missing, empty, or repeated field also produces `unknown`.

# Changelog

## [0.4.0] · 2026-11-26

- Upgrade to OpenSpec 2.1.1 and Node.js 22.20.0 or later. Run `mad-openspec update` to migrate project skills and existing connections.
- New installations use the BMAD planning profile by default. Use `--bmad-profile full` for all core and BMM skills, or preview an existing installation's migration with `mad-openspec setup --bmad-profile planning --dry-run`.

## [0.3.10] · 2026-11-20

- Setup and update connect BMAD requirements, sprint change proposals and story planning to accepted capability specifications, including changes made directly through OpenSpec.

## [0.3.9] · 2026-11-20

- The apply skill continues when only the implementation method changes. When acceptance criteria change, it pauses implementation, routes the affected documents to their BMAD owners and returns the same OpenSpec change for fresh approval.

## [0.3.8] · 2026-11-19

- The README uses a plain-text diagram of the BMAD, MadOpenSpec, and OpenSpec workflow so it is readable on npm as well as GitHub.

## [0.3.7] · 2026-11-19

- First public npm release. Install the CLI with `npm install -g mad-openspec`.
- Connect a BMAD backlog, prepare an OpenSpec change for a selected story, and mark the story done when the change is archived.

[0.4.0]: https://github.com/briginas/MadOpenSpec/releases/tag/v0.4.0
[0.3.10]: https://github.com/briginas/MadOpenSpec/releases/tag/v0.3.10
[0.3.9]: https://github.com/briginas/MadOpenSpec/releases/tag/v0.3.9
[0.3.8]: https://github.com/briginas/MadOpenSpec/releases/tag/v0.3.8
[0.3.7]: https://github.com/briginas/MadOpenSpec/releases/tag/v0.3.7

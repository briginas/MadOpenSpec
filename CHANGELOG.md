# Changelog

## [0.3.9] · 2026-11-20

- The apply skill continues when only the implementation method changes. When acceptance criteria change, it pauses implementation, routes the affected documents to their BMAD owners and returns the same OpenSpec change for fresh approval.
- Projects pinned to 0.3.8 can upgrade with `mad-openspec update` after installing 0.3.9.

## [0.3.8] · 2026-11-19

- The README uses a plain-text diagram of the BMAD, MadOpenSpec, and OpenSpec workflow so it is readable on npm as well as GitHub.
- Projects pinned to 0.3.7 can upgrade with `mad-openspec update` after installing 0.3.8.

## [0.3.7] · 2026-11-19

- First public npm release. Install the CLI with `npm install -g mad-openspec`.
- Connect a BMAD backlog, prepare an OpenSpec change for a selected story, and mark the story done when the change is archived.

[0.3.9]: https://github.com/briginas/MadOpenSpec/releases/tag/v0.3.9
[0.3.8]: https://github.com/briginas/MadOpenSpec/releases/tag/v0.3.8
[0.3.7]: https://github.com/briginas/MadOpenSpec/releases/tag/v0.3.7

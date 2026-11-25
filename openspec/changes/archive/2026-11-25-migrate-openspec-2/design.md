# Design

## Context

The npm package owns the executable used for structured OpenSpec operations. Project records independently pin MadOpenSpec and OpenSpec. The installer runs with a temporary home and stages project output before publishing it.

## Goals / Non-Goals

Support fresh and existing local projects, including installations where the OpenSpec root is nested. The existing BMAD version and story lifecycle remain the basis for the integration.

## Decisions

- Pass project scope explicitly during initialization. Use the six upstream Codex skills generated with the pinned version as the expected contents for setup and update.
- Plan writes to managed skill files before recording version changes. Recognize the shipped legacy files by content, accept already updated files on retry, and preserve unrelated files and existing OpenSpec configuration.
- Keep normal workflow checks strict. Accept legacy project pins on the explicit upgrade path and use the existing lock, dry run and atomic writes.
- Advance the MadOpenSpec minor version for the new Node.js minimum and add the previous release to the supported upgrade path.

## Risks / Trade-offs

Strict validation may expose old changes with invalid deltas. Migrating a project must not close or rewrite those changes. Projects with custom skill content need an explicit conflict diagnostic. The CLI and generated skills should be checked together through the normal packaging and smoke tests.

# Design

## Context

The four pinned BMAD skills load file references in workflow.persistent_facts on activation. Their team and personal TOML layers append array entries. Setup and update already plan writes before applying them under a project lock.

## Goals / Non-Goals

Make the same instructions available before requirements, sprint proposals and story decomposition. The skill interprets the product requirements. The CLI delivers its instructions.

## Decisions

- Install a shared Markdown resource and add its file reference to the team layer of each skill. This keeps upstream skill files and personal overrides under their existing owners.
- Inspect team and personal layers during preflight. Preserve unrelated settings and comments when inserting the reference. Report incompatible values and managed file conflicts before applying changes.
- Read the connected or setup OpenSpec root at planning time so projects can use a nested directory. Keep detailed scenarios and any previous comparison in their existing sources.

## Risks / Trade-offs

A CLI installation test can verify the effective inputs of each workflow. The yard scenario also requires a planning walkthrough to verify the interpretation and story boundary.

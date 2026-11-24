# Proposal

## Why

MadOpenSpec pins OpenSpec 1.16.0 in both its runtime and its project records. OpenSpec 2.1.1 checks for archive destination conflicts before changing main specs and ships skills with the CLI.

## What Changes

- **BREAKING** Raise the minimum Node.js version to 22.20.0 and pin OpenSpec to 2.1.1.
- Install the six core Codex skills locally. Upgrade previously connected and setup-only projects through the existing previewable update command.
- Preserve BMAD story links, active changes, archives, local customizations and project language settings.

## Capabilities

### New Capabilities

### Modified Capabilities

- `toolchain-setup` installs the new pinned project toolchain.
- `project-integration` verifies the new version and migrates existing projects.

## Impact

The installer, project configuration reader, setup receipts, packaged skills, CI and usage documentation change. BMAD stays at 6.12.4.

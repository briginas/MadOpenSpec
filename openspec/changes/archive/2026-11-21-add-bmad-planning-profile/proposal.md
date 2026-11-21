# Proposal

## Why

Projects using MadOpenSpec for implementation only need the BMAD planning workflows and their helpers in the Codex skill list.

## What Changes

- Use the planning profile by default on fresh setup and show the selection during preview.
- Remember the profile, verify its files on repeat runs and reuse existing full installations until a user explicitly selects planning.

## Capabilities

### Modified Capabilities

- `toolchain-setup` gains BMAD skill profile selection.

## Impact

The setup CLI, BMAD installation and verification, setup receipt, and usage guide change. Both profiles use the pinned BMAD installer.

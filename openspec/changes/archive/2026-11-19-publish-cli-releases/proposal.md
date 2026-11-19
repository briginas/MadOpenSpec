## Why

Users currently need a source checkout to follow the installation guide. Publishing the CLI on npm gives them a versioned installation command and a public source revision for each release.

## What Changes

- Publish the existing CLI as `mad-openspec` and document its installation.
- Build and test a tarball from the release tag, then link its npm version to a GitHub Release.

## Capabilities

### New Capabilities

- `cli-distribution` covers public installation and tagged releases.

### Modified Capabilities

## Impact

Package metadata, installation documentation and GitHub Actions.

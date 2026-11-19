# cli-distribution Specification

## Purpose
Provide a public npm installation of the CLI that can be traced to a tested revision of the source repository.

## Requirements

### Requirement: Public CLI installation

The npm package SHALL expose the `mad-openspec` command and the assets needed for project setup.

#### Scenario: Install a published version

- **WHEN** a user installs a released version in a clean directory
- **THEN** the executable reports that version and can plan project setup

### Requirement: Tagged CLI releases

A release SHALL publish the tested tarball from a matching version tag and announce it on GitHub only after successful npm publication.

#### Scenario: Publish a release

- **WHEN** a maintainer pushes a matching stable version tag and the project and tarball checks pass
- **THEN** the release process publishes the checked archive to npm and creates a GitHub Release for that tag

#### Scenario: Invalid release candidate

- **WHEN** the tag differs from the package version or any release check fails
- **THEN** publication stops before writing to npm or creating a GitHub Release

# Design

## Context

The repository already builds the distribution in `prepack` and exercises the packaged CLI in its smoke suite.

## Goals / Non-Goals

Ship the existing CLI and assets under their current name and version. CLI behavior stays within the existing specifications.

## Decisions

Use the Git tag to select a commit and require it to match the package version. Share the existing CI checks with the release workflow. Install the release tarball in an empty directory and check its executable before publishing that same file. Create the GitHub Release after npm confirms publication.

## Risks / Trade-offs

The first release needs an authenticated npm maintainer. Once the package exists, authorize the repository's release workflow through npm trusted publishing. If GitHub release creation fails after npm publication, verify the registry integrity and finish creating the release for the existing tag.

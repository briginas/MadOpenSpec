# Design

## Context

BMAD 6.12.4 selects modules and IDEs. Its Codex installer moves complete skill directories into the project and records their source paths in CSV manifests.

## Goals

Expose a reproducible subset for planning and preserve compatible installations across repeated setup runs.

## Decisions

- Select planning by default on fresh installs, accept an explicit full profile and adopt existing installations. Persist the selected profile in the setup receipt. Allow an explicit full-to-planning migration. Verify the removed directories against the pinned package, narrow the existing catalogs, and commit the receipt under the setup lock. Keep originals until verification succeeds and roll back on failure.
- Run the planning installer in a temporary directory with the target project's basename so BMAD derives the correct project name. Publish only selected skill directories and the corresponding BMAD runtime. Filter the skill, file and help catalogs in staging. Keep the generated agent descriptors used by party mode.
- Include the seven main planning workflows, brainstorming and UX, plus help, review, advanced elicitation and party mode. The latter four support completion, editorial review and the interactive epics workflow. Suggestions to start separate research or implementation workflows are outside the profile.
- Verify profile membership as well as individual installed files. Use the same checks during preview and repeat setup.

## Risks

BMAD may change its layout or dependencies in a future release. Test the profile with the actual pinned installer and confirm the installed skill set and catalogs agree.

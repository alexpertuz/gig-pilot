# Gig-Pilot Rename Design

## Goal

Rename the `gig-ops` repository and its project identity to `gig-pilot` without altering personal pipeline data or discarding existing uncommitted work.

## Scope

- Rename the repository directory from `gig-ops` to `gig-pilot`.
- Replace active product-name references in source code, package metadata, documentation, generated wrappers, and UI copy with `gig-pilot` or `Gig-Pilot`, preserving capitalization appropriate to each context.
- Update repository-local absolute or relative paths that encode the old directory name.
- Regenerate CLI-specific instruction wrappers if the repository provides the documented generator.
- Retain historical references only when they explicitly describe the former upstream/fork relationship or another historical fact.

## Explicit Non-Goals

- Do not modify the User Layer: `config/profile.yml`, `sources.yml`, `data/leads.md`, `data/pipeline.md`, or `reports/`.
- Do not change application behavior, data formats, commands, provider behavior, scoring, or runtime dependencies.
- Do not reset, stash, discard, or overwrite existing uncommitted changes.
- Do not add legacy aliases or compatibility shims for the old product name.

## Approach

Perform a repository-wide, case-aware search for the old name across tracked files and relevant untracked source files. Classify matches as active identity, historical documentation, generated output, or incidental data. Update only active identity and path references, then move the repository folder to `gig-pilot`. The filesystem move occurs after content edits so all project commands continue to run from a valid directory during the edit phase.

## Validation

After the move, verify that:

1. The repository is accessible at the new folder path.
2. Active source, metadata, and documentation contain no stale `gig-ops` references, excluding intentionally retained historical wording.
3. The existing test suite passes from the renamed directory.
4. `git status` shows the pre-existing work remains present, alongside only the intended rename changes.

## Risk Handling

The worktree is already dirty. All edits use targeted patches, and no broad formatting, clean, reset, checkout, stash, or restore operation is allowed. A folder rename may require access to the parent directory; request approval if the workspace sandbox blocks it.

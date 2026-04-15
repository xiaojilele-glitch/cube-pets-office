# Tasks

## Archive Scope

- [x] 1. Identify the six non-merge commits from `trae/solo-agent-ENNSlg`
- [x] 2. Map those commits onto the current executor/runtime code paths
- [x] 3. Record the local follow-up commits that changed `dev:all` fallback and shutdown behavior
- [x] 4. Distinguish local no-Docker behavior from GitHub Pages static deployment behavior
- [x] 5. Archive the current runtime matrix in `.kiro/specs`

## Recorded Implementation Sequence

- [x] 1. `189c7fb`
  - Lock dependency state for the branch

- [x] 2. `f740576`
  - Archive the design intent for sandbox-native executor compatibility

- [x] 3. `2b73e71`
  - Archive the implementation plan for native executor support

- [x] 4. `f44aa0f`
  - Land the executor-side native runtime and fallback implementation

- [x] 5. `ade2694`
  - Tune local dev startup for sandbox execution stability

- [x] 6. `9511dee`
  - Add execution flow diagram for documentation and onboarding

- [x] 7. `ad06e1e`
  - Improve local `dev:all` shutdown and Docker-unavailable startup handling

- [x] 8. `81a2a44`
  - Prefer `native` instead of `mock` when Docker is unavailable during local startup

## Current Behavioral Summary

- [x] 1. Local with Docker reachable → `real`
- [x] 2. Local without Docker but with Node runtime available → `native`
- [x] 3. Local explicit simulation request → `mock`
- [x] 4. GitHub Pages static deployment → browser runtime only (`frontend`)

## Notes

- This spec is an archive and behavior map, not a new implementation plan
- Merge commits are intentionally excluded from the historical sequence above

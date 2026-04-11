# Implementation Plan: scene-agent-interaction

## Overview

This spec upgrades the office scene from a visual backdrop into an interactive status entry point. Users should be able to click an Agent for context, read the office notice board at a glance, and understand task progress directly from the scene.

## Worktree Parallel Notes

- Prefer a dedicated owner for `Home / Scene3D / three/*`
- If another worktree is still changing `Home.tsx`, focus first on `PetWorkers`, drawer components, and scene configuration, then merge the wiring last
- Agent memory and report data should enter through stable selectors instead of binding directly to volatile panel implementations

## Tasks

- [x] 1. Define the Agent drawer data model
  - [x] 1.1 Inventory the fields needed for role, department, heartbeat, reputation, current task, memory, and reports
    - _Requirements: 1.1.2, 1.1.3_
  - [x] 1.2 Design drawer view states and empty states
    - _Requirements: 4.1.2, 4.1.3_

- [x] 2. Implement the Agent detail drawer
  - [x] 2.1 Add `AgentDetailDrawer` or an equivalent component
    - _Requirements: 1.1.1, 1.1.2_
  - [x] 2.2 Update `client/src/components/three/PetWorkers.tsx`
    - Clicking an Agent opens the drawer
    - _Requirements: 1.1.1_
  - [x] 2.3 Update `client/src/pages/Home.tsx`
    - Wire in the drawer container
    - _Requirements: 1.1.3_

- [x] 3. Implement the office notice board
  - [x] 3.1 Add a key-metrics summary component
    - Running task count
    - Blocked Agent count
    - Cost / token summary
    - _Requirements: 2.1.1, 2.1.2_
  - [x] 3.2 Provide entry points that jump to the related task or page
    - _Requirements: 2.1.3_

- [x] 4. Implement scene stage flowlines
  - [x] 4.1 Add stable stage-to-zone mapping configuration
    - _Requirements: 3.1.2_
  - [x] 4.2 Render scene task flowlines in `Scene3D.tsx` or `OfficeRoom.tsx`
    - _Requirements: 3.1.1, 3.1.3_

- [ ] 5. Demo mode and regression verification
  - [x] 5.1 Add explanatory copy for no-backend / demo mode
  - [x] 5.2 Add scene interaction tests
  - [ ] 5.3 Manually verify desktop / mobile drawer and notice board behavior

## Notes

- Make the Agent drawer useful before polishing extra scene effects
- Scene flowlines must depend on stable stage semantics instead of becoming one-off visual decoration
- Manual verification is still pending because the current environment does not have local frontend tooling installed

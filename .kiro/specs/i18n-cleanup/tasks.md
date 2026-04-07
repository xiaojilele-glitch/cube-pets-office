# Implementation Plan: i18n Cleanup

## Overview

Systematically migrate 14 files from hardcoded Chinese/English text to the existing `useI18n()` + `messages.ts` system. Work is organized by priority tier (high → medium → low), with message dictionary keys added alongside each component migration. Property tests validate dictionary completeness after all migrations.

## Tasks

- [ ] 1. Migrate high-priority pages (TasksPage + TaskDetailView)
  - [ ] 1.1 Add `tasks` section to `messages.ts` with all keys for TasksPage.tsx and TaskDetailView.tsx in both `zh-CN` and `en-US`
    - Extract every hardcoded string from TasksPage.tsx: "Mission Control", "Task Universe", "New Mission", "Refresh", "Mission Queue", "Search titles, stages, notes, departments...", "No missions yet", "warnings", "tasks", "messages", "attachments", etc.
    - Extract every hardcoded string from TaskDetailView.tsx: "Select a mission", "Mission Detail", "View Replay", "Source Directive", "Work Packages", "Timeline", "Execution lane", "Score", "Review", "Deliverable Preview", "Manager Signal", "Audit Signal", "Budget Usage", "Token Consumption by Agent", "Cost Accumulation Curve", "Total Cost", "Tokens In", "Tokens Out", "Budget Remaining", etc.
    - Add corresponding `zh-CN` and `en-US` entries
    - _Requirements: 1.1, 1.2, 4.1, 4.2, 4.3_
  - [ ] 1.2 Update `TasksPage.tsx` to use `useI18n()` and replace all hardcoded strings with `copy.tasks.*`
    - Import `useI18n` from `@/i18n`
    - Replace all string literals in JSX with copy references
    - _Requirements: 1.1_
  - [ ] 1.3 Update `TaskDetailView.tsx` to use `useI18n()` and replace all hardcoded strings with `copy.tasks.*`
    - Import `useI18n` in the main component and pass copy to sub-components or use the hook in each
    - Replace all string literals including MetricCard labels, ExcerptBlock titles, tab labels, empty states
    - _Requirements: 1.2_

- [ ] 2. Migrate high-priority dashboards (CostDashboard + TelemetryDashboard + WorkflowPanel)
  - [ ] 2.1 Add `costDashboard` and `telemetry` sections to `messages.ts` with all keys in both locales
    - CostDashboard keys: "No cost data available", "Token Consumption", "Cost", "Budget Remaining", "Agent Cost Breakdown", "Cost History (Last 10 Missions)", "Budget Settings", "Max Cost ($)", "Max Tokens", "Warning Threshold (%)", "Save Budget", "Downgrade Controls", "Switch Low-Cost Model", "Pause Non-Critical Agents", "Release Downgrade", "Collapse", "Soft downgrade", "Hard downgrade", "remaining", "No agent data", "No history yet", "Saving…", etc.
    - TelemetryDashboard keys: "Token & Cost", "Top Bottleneck Agents", "Stage Timing", "Active Agents", "History Trend", "Alerts", "Telemetry Dashboard", "No telemetry data yet", "No agent data yet", "Token budget exceeded 80% threshold", "RAG Pipeline", "Retrieval", "Hit Rate", "Tokens", "RAG metrics available when pipeline is enabled", "Duration", "Cost ($)", "Calls", etc.
    - _Requirements: 1.3, 1.4, 4.1, 4.2_
  - [ ] 2.2 Update `CostDashboard.tsx` to use `useI18n()` and replace all hardcoded strings
    - _Requirements: 1.3_
  - [ ] 2.3 Update `TelemetryDashboard.tsx` to use `useI18n()` and replace all hardcoded strings
    - _Requirements: 1.4_
  - [ ] 2.4 Audit `WorkflowPanel.tsx` for any remaining hardcoded text not covered by existing `workflow` keys, add missing keys and migrate
    - Check for hardcoded "浏览器预览", "执行终端" references that may exist outside the already-translated workflow section
    - _Requirements: 1.5_

- [ ] 3. Checkpoint — Verify high-priority migrations
  - Ensure all tests pass, ask the user if questions arise.
  - Verify TypeScript compiles without errors after message dictionary changes.

- [ ] 4. Migrate medium-priority permission components
  - [ ] 4.1 Add `permissions` section to `messages.ts` with all keys in both locales
    - PermissionPanel keys: "Agents", "Refresh", "agents", "No agent permission data", "Loading…", "Permissions", "Matrix", "Audit", "Role Assignment", "Custom Permissions", "No custom permissions", "Denied Permissions", "Select an agent to view permissions", "Expires"
    - PermissionMatrix keys: "Permission Matrix", "Allowed", "Denied", "No Rule", "Resource", "Loading…"
    - AuditTimeline keys: "Audit Timeline", "No audit entries", "Loading…", operation labels (Check, Grant, Revoke, Escalate, Policy Change)
    - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2_
  - [ ] 4.2 Update `PermissionPanel.tsx`: remove local `t()` helper, import `useI18n()`, replace all `t(locale, zh, en)` calls with `copy.permissions.*`, remove `locale` prop drilling to child components
    - _Requirements: 2.1_
  - [ ] 4.3 Update `PermissionMatrix.tsx`: remove local `t()` helper, import `useI18n()`, replace all `t()` calls with `copy.permissions.*`
    - _Requirements: 2.2_
  - [ ] 4.4 Update `AuditTimeline.tsx`: remove local `t()` helper, import `useI18n()`, replace all `t()` calls and `OP_LABELS` map with `copy.permissions.*`
    - _Requirements: 2.3_

- [ ] 5. Migrate low-priority component labels
  - [ ] 5.1 Add `sandbox`, `nlCommand`, and `reputation` sections to `messages.ts` with all keys in both locales
    - Sandbox keys: "暂无浏览器预览"/"No browser preview", "执行带页面的任务后，这里会显示截图"/"Screenshots appear here after running a page task", "浏览器预览"/"Browser Preview", "点击放大"/"Click to zoom", "点击放大截图"/"Click to zoom screenshot", "执行终端"/"Execution Terminal", "等待执行"/"Waiting for execution", "运行任务后，这里会显示实时日志"/"Live logs appear here after running a task", "退出全屏"/"Exit fullscreen", "全屏"/"Fullscreen"
    - NL Command keys: "Enter strategic command", "Sending...", "Send", placeholder text, "No alerts."
    - Reputation keys: "Trusted", "Standard", "Probation", "Quality", "Speed", "Efficiency", "Collaboration", "Reliability"
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2_
  - [ ] 5.2 Update `ScreenshotPreview.tsx` to use `useI18n()` and replace hardcoded Chinese strings
    - _Requirements: 3.1_
  - [ ] 5.3 Update `TerminalPreview.tsx` to use `useI18n()` and replace hardcoded Chinese strings
    - _Requirements: 3.2_
  - [ ] 5.4 Update `CommandInput.tsx` to use `useI18n()` and replace hardcoded English strings
    - _Requirements: 3.3_
  - [ ] 5.5 Update `AlertPanel.tsx` to use `useI18n()` and replace hardcoded English strings
    - _Requirements: 3.4_
  - [ ] 5.6 Update `ReputationBadge.tsx` to use `useI18n()` and replace hardcoded English strings
    - _Requirements: 3.5_
  - [ ] 5.7 Update `ReputationRadar.tsx` to use `useI18n()` and replace hardcoded English strings
    - _Requirements: 3.6_

- [ ] 6. Checkpoint — Verify all migrations compile
  - Ensure all tests pass, ask the user if questions arise.
  - Verify no TypeScript errors across all 14 migrated files and messages.ts.

- [ ] 7. Write property and unit tests
  - [ ]* 7.1 Write property test for message dictionary structural symmetry
    - **Property 1: Message dictionary structural symmetry**
    - Use `fast-check` to generate random key paths by walking the dictionary tree
    - Assert both locales have matching structure and all leaves are non-empty strings or functions
    - Minimum 100 iterations
    - **Validates: Requirements 1.1–3.6, 4.1, 4.2**
  - [ ]* 7.2 Write property test for locale round-trip consistency
    - **Property 2: Locale round-trip consistency**
    - For each locale, verify `getMessages(locale)` returns the exact corresponding dictionary entry
    - **Validates: Requirements 5.1, 7.1**
  - [ ]* 7.3 Write unit test for existing key preservation
    - Snapshot existing message keys before migration, verify they still exist unchanged
    - **Validates: Requirements 4.3, 7.1**
  - [ ]* 7.4 Write unit test for no hardcoded text in migrated files
    - Static analysis: grep migrated files for Chinese character ranges outside comments
    - **Validates: Requirements 5.2, 6.1**

- [ ] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The `messages.ts` file will grow significantly — keys are organized by section to keep it manageable
- Permission components lose their local `t()` helper and `locale` prop drilling in favor of the standard `useI18n()` pattern
- Technical terms (Docker, API, Token, JSON, RAG, etc.) remain untranslated in both locale dictionaries

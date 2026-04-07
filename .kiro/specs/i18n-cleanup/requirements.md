# Requirements Document

## Introduction

The project has an established i18n system (`client/src/i18n/messages.ts` + `useI18n()` hook) that powers locale switching between `zh-CN` and `en-US`. The Home page, ConfigPanel, ChatPanel, and WorkflowPanel already use this system. However, 14 other files contain hardcoded Chinese or English text that does not respond to locale switching. This spec covers the systematic migration of all hardcoded user-visible text in those files to the existing i18n system.

## Glossary

- **I18n_System**: The internationalization infrastructure consisting of `client/src/i18n/messages.ts` (translation dictionaries), `client/src/i18n/index.ts` (`useI18n` hook), and the Zustand-based locale state in `useAppStore`.
- **Message_Dictionary**: The `messages` object in `messages.ts` containing `zh-CN` and `en-US` translation entries, typed as `MessageDictionary`.
- **Copy_Object**: The locale-resolved translation object returned by `useI18n().copy`, used in components to access translated strings.
- **Locale_Toggle**: The language switch control on the Home page that sets the active locale in the Zustand store.
- **Hardcoded_Text**: Any user-visible string literal (Chinese or English) embedded directly in JSX or component logic rather than sourced from the Copy_Object.
- **Technical_Term**: Domain-specific terms (e.g., "Docker", "API", "Token", "JSON", "RAG", "SOUL.md") that remain untranslated across locales.

## Requirements

### Requirement 1: High-Priority Page Migration

**User Story:** As a user, I want all text on the Tasks, Cost Dashboard, Telemetry Dashboard, and Workflow Panel pages to reflect my chosen locale, so that I can use the application entirely in my preferred language.

#### Acceptance Criteria

1. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `TasksPage.tsx` in the active locale
2. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `TaskDetailView.tsx` in the active locale
3. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `CostDashboard.tsx` in the active locale
4. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `TelemetryDashboard.tsx` in the active locale
5. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `WorkflowPanel.tsx` in the active locale

### Requirement 2: Medium-Priority Admin Feature Migration

**User Story:** As an administrator, I want the permissions management UI to display text in my chosen locale, so that I can manage permissions without language barriers.

#### Acceptance Criteria

1. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `PermissionPanel.tsx` in the active locale
2. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `PermissionMatrix.tsx` in the active locale
3. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `AuditTimeline.tsx` in the active locale

### Requirement 3: Low-Priority Component Label Migration

**User Story:** As a user, I want all component labels across sandbox previews, command center, and reputation displays to reflect my chosen locale, so that the entire application is linguistically consistent.

#### Acceptance Criteria

1. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `ScreenshotPreview.tsx` in the active locale
2. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `TerminalPreview.tsx` in the active locale
3. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `CommandInput.tsx` in the active locale
4. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `AlertPanel.tsx` in the active locale
5. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `ReputationBadge.tsx` in the active locale
6. WHEN the locale is switched, THE I18n_System SHALL render all user-visible text in `ReputationRadar.tsx` in the active locale

### Requirement 4: Translation Key Completeness

**User Story:** As a developer, I want every new translation key to have both `zh-CN` and `en-US` entries, so that no locale falls back to missing text.

#### Acceptance Criteria

1. THE Message_Dictionary SHALL contain a `zh-CN` entry for every new translation key added during migration
2. THE Message_Dictionary SHALL contain an `en-US` entry for every new translation key added during migration
3. WHEN a new translation key is added, THE Message_Dictionary SHALL preserve all existing translation keys and values unchanged

### Requirement 5: Locale Propagation Consistency

**User Story:** As a user, I want the locale toggle on the Home page to affect all sub-pages and components uniformly, so that switching language is a single global action.

#### Acceptance Criteria

1. WHEN the Locale_Toggle changes the locale, THE I18n_System SHALL propagate the new locale to all migrated components without page reload
2. THE I18n_System SHALL use the `useI18n()` hook as the sole mechanism for accessing translated text in migrated components

### Requirement 6: Technical Term Exemption

**User Story:** As a developer, I want recognized technical terms to remain untranslated, so that domain-specific vocabulary stays consistent across locales.

#### Acceptance Criteria

1. THE I18n_System SHALL leave Technical_Terms (e.g., "Docker", "API", "Token", "JSON", "RAG", "SOUL.md", "IndexedDB", "Mission") untranslated in JSX output
2. WHEN a string contains a mix of translatable text and Technical_Terms, THE I18n_System SHALL translate only the non-technical portions

### Requirement 7: No Regression in Existing Translations

**User Story:** As a user, I want existing translated pages (Home, ConfigPanel, ChatPanel, WorkflowPanel tabs) to continue working correctly after the migration, so that the cleanup does not break what already works.

#### Acceptance Criteria

1. WHEN the migration is complete, THE I18n_System SHALL continue to render all previously translated components correctly in both locales
2. IF a migration change causes a type error in the Message_Dictionary, THEN THE I18n_System SHALL fail at compile time rather than at runtime

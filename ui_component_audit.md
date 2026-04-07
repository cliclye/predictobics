# UI Component Audit

## Current Architecture

- The app is route-driven, not component-driven.
- Most pages own their own data fetching, transient UI state, rendering, and small subcomponents in the same file.
- Styling is split across:
  - `frontend/src/index.css` for tokens/reset
  - `frontend/src/App.css` for shell/shared primitives
  - one large CSS file per page
- There is no shared `components/` or `hooks/` layer today.

## Component Hierarchy

- `App`
- `HomePage`
- `TeamPage`
- `EventSection`
- `MatchRow`
- `EventPage`
- `DoubleElimBracket`
- `EventPredictions`
- `PlayoffPredictions`
- `PredictPage`
- `TeamAutocompleteInput`
- `LocksPage`
- `LockPctCell`

## Component Catalog

| Component | File | Responsibility | State / Side Effects | Audit Notes |
| --- | --- | --- | --- | --- |
| `App` | `frontend/src/App.js` | Router shell, nav, footer | `useLocation` only | Thin shell; safe composition point for shared layout |
| `HomePage` | `frontend/src/pages/HomePage.js` | Event explorer, team search, filters, cards/table toggle | fetches events, debounced team search, filter state | Large page with duplicated autocomplete logic |
| `TeamPage` | `frontend/src/pages/TeamPage.js` | Team profile, season selector, live match predictions | fetches season bundle, 45s polling, disclosure state | Strong candidate for decomposition |
| `EventSection` | `frontend/src/pages/TeamPage.js` | Per-event metrics and match table for team page | derived-only | Pure presentation; extractable |
| `MatchRow` | `frontend/src/pages/TeamPage.js` | Match row + explain drawer | local expand/collapse | Explanation is misleading: per-team values are equal split, not actual EPA |
| `EventPage` | `frontend/src/pages/EventPage.js` | Event overview with tabs | multiple fetchers, 45s polling, tab state, sort state | Heaviest UI file and primary redesign target |
| `DoubleElimBracket` | `frontend/src/pages/EventPage.js` | Reusable bracket renderer for predicted/actual playoff views | derived-only | Good candidate for isolated shared component |
| `EventPredictions` | `frontend/src/pages/EventPage.js` | Predicted ranking/alliance/winner rendering | derived-only | Presentational but tied to current payload shape |
| `PlayoffPredictions` | `frontend/src/pages/EventPage.js` | Actual alliances + playoff bracket | derived-only | Closely coupled to playoff payload |
| `PredictPage` | `frontend/src/pages/PredictPage.js` | Manual match predictor form/result card | local form + submit state | Simple page but duplicates team search behavior |
| `TeamAutocompleteInput` | `frontend/src/pages/PredictPage.js` | Debounced team autocomplete | local dropdown + debounce | Should become shared UI infra |
| `LocksPage` | `frontend/src/pages/LocksPage.js` | District lock dashboard | district selection, load state, derived sorting | Separate data domain from EPA pages |
| `LockPctCell` | `frontend/src/pages/LocksPage.js` | Specialized lock display | none | Small, reusable within page only |

## CSS Surface Area

| File | Lines | Notes |
| --- | --- | --- |
| `frontend/src/App.css` | 314 | Shell + shared controls/tables/cards |
| `frontend/src/index.css` | 74 | Root palette/reset; hard-codes current dark GitHub-like theme |
| `frontend/src/pages/HomePage.css` | 452 | Event search/listing layout |
| `frontend/src/pages/EventPage.css` | 463 | Tabs, rankings, predictions, bracket styles |
| `frontend/src/pages/TeamPage.css` | 659 | Largest page stylesheet |
| `frontend/src/pages/PredictPage.css` | 212 | Predict form/results/autocomplete |
| `frontend/src/pages/LocksPage.css` | 179 | Locks-specific tables and legend |

## UI Pain Points

- Route pages are oversized:
  - `HomePage.js` 541 lines
  - `EventPage.js` 655 lines
  - `TeamPage.js` 452 lines
- Team autocomplete exists twice with separate implementations:
  - `HomePage.js:88-169`
  - `PredictPage.js:5-78`
- Polling logic is duplicated and page-local:
  - `TeamPage.js:102-105`
  - `EventPage.js:296-306`
- Inline styles are scattered through render trees, especially `EventPage.js` and `PredictPage.js`, which makes theme redesign harder.
- The design system is shallow:
  - palette and typography are mostly fixed in `index.css:9-37`
  - shell components live in `App.css:111-220`
  - page CSS then redefines many variants ad hoc
- `EventPage` mixes three product surfaces in one file: rankings, event predictions, and playoff predictions.
- `TeamPage`'s explain drawer shows equal per-team score slices instead of real team contributions (`TeamPage.js:330-418`), which is a UX trust issue.
- `LocksPage` is visually independent but currently inherits the same shell tokens; a redesign should keep its separate data semantics visible.

## Suggested Extraction Targets For Builder-1

- Shared `TeamAutocomplete` used by home and predict flows
- Shared `PageHero` / `SectionHeader`
- Shared `LoadingState`, `ErrorState`, and `EmptyState`
- Shared `PollingTimestamp` / refresh indicator
- Shared table primitives for rankings and metric cards
- A small bracket/prediction presentation layer extracted from `EventPage`

## Builder-1 Constraints

- Preserve API field names consumed in:
  - `frontend/src/pages/TeamPage.js`
  - `frontend/src/pages/EventPage.js`
  - `frontend/src/pages/PredictPage.js`
  - `frontend/src/pages/LocksPage.js`
- Current worktree is already dirty in:
  - `frontend/src/App.css`
  - `frontend/src/index.css`
  - `frontend/src/pages/HomePage.css`
  - `frontend/src/pages/HomePage.js`
  - `frontend/src/pages/PredictPage.css`
  - `frontend/src/pages/PredictPage.js`
- Builder-1 should assume those files are conflict-prone until the coordinator clarifies whether the existing changes are in-flight user edits or intended builder scope.

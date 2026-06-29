# Profile Visualizer Review Fixes Design

Date: 2026-06-29

## Context

The prior fix restored visible Profile Intelligence by replacing the null `ProfileVisualizer` placeholder and exposing a small `experiencePreview` from `ProfileOrchestrator.getProfileData()`.

A third-party review identified that the current fix still has product-verification gaps:

- The visualizer receives `identity` but does not display it.
- `experiencePreview` is truncated to 3 entries without telling the user that additional experience exists.
- Backend tests do not fully lock the profile data contract.
- Renderer-side typing is an inline loose shape inside `ProfileVisualizer.tsx`.
- Skills can render duplicated labels.
- True React rendering tests would be stronger, but this project currently avoids jsdom/React rendering test infrastructure.

The chosen test strategy is to avoid adding new dependencies. The fix should use existing Node test infrastructure, pure data-normalization tests, and lightweight source-contract tests.

## Goals

1. Make Profile identity visible inside `ProfileVisualizer` itself.
2. Keep the compact 3-item experience preview, but make truncation explicit in the UI.
3. Lock `getProfileData()` behavior with focused positive tests.
4. Move renderer-safe visualizer types out of the component into the renderer profile types file.
5. Deduplicate skills before rendering and before showing the skill count.
6. Improve visualizer tests without adding `react-test-renderer`, `@testing-library/react`, or jsdom.

## Non-Goals

- Do not redesign the Profile Intelligence settings page.
- Do not add a "view all experience" drawer, modal, or navigation flow.
- Do not change Profile ingestion, parsing prompts, or the `profile_master` schema.
- Do not change provider data-scope policy behavior.
- Do not add new test dependencies.
- Do not change dynamic action behavior.

## Recommended Approach

Use a renderer-local data boundary and a pure normalization layer.

The visualizer should stay simple:

- It receives `ProfileVisualizerData | null`.
- It normalizes optional and duplicate fields into a render-safe model.
- It renders identity, summary, metrics, up to 3 experience rows, hidden-experience copy, deduplicated skills, and optional JD context.

This keeps the component understandable, makes behavior testable without DOM infrastructure, and avoids importing Electron main-process types into renderer code.

## Data Contract

`ProfileOrchestrator.getProfileData()` remains the backend source for parsed profile data.

It should return:

- `identity.name`
- optional `identity.email`
- optional `summary`
- `experiencePreview`, containing the first 3 experience entries in original order
- `experienceCount`, containing the full experience count
- `projectCount`
- `nodeCount`
- `skills`
- optional active JD data

The backend test must cover:

- `summary` passes through unchanged.
- 10 input experience entries produce `experiencePreview.length === 3`.
- The preview preserves the first 3 entries in original order.
- `end` and `description` fields are preserved on preview entries.

## Renderer Types

Add renderer-safe visualizer types to `src/components/profile/types.ts`.

Suggested shape:

```ts
export interface ProfileVisualizerExperience {
  title?: string;
  organization?: string;
  start?: string;
  end?: string;
  description?: string;
}

export interface ProfileVisualizerData {
  identity?: {
    name?: string;
    email?: string;
  };
  summary?: string;
  experiencePreview?: ProfileVisualizerExperience[];
  experienceCount?: number;
  projectCount?: number;
  nodeCount?: number;
  skills?: string[];
  hasActiveJD?: boolean;
  activeJD?: {
    title?: string;
    company?: string;
    level?: string;
    technologies?: string[];
  };
}
```

`ProfileVisualizer.tsx` should import this renderer type instead of declaring the full prop shape inline. It should not import `electron/services/profile/types.ts`.

## Visual Behavior

### Null Profile

When `profileData === null`, show the existing empty state:

- Heading: `Profile 智能未激活`
- Body copy explaining that uploading or filling profile identity enables Profile clues.

### Empty Object Profile

When `profileData` is an empty object, render a stable empty skeleton:

- Heading: `Profile 智能`
- Identity fallback: `身份未命名`
- Counts default to 0.
- No experience rows.
- No skill tags.
- No hidden-experience message.

### Identity

For non-null profile data, `ProfileVisualizer` must display identity inside its own card:

- If `identity.name` exists, show it near the `Profile 智能` heading.
- If `identity.email` exists, show it as secondary text.
- If name is missing, show `身份未命名`.

This avoids relying on the parent settings header for identity ownership.

### Summary

Show `summary` as the descriptive text when present. If absent, use the existing default copy.

### Metrics

Render:

- full `experienceCount`
- full `projectCount`
- deduplicated skill count

Skill count should use the same normalized unique skill list that renders tags.

### Experience Preview

Render the supplied `experiencePreview` entries.

If `experienceCount > experiencePreview.length`, show explicit copy:

`另有 X 条经验未显示`

This keeps the compact preview while avoiding the impression that data was lost.

### Skills

Before rendering skills:

- remove empty strings
- trim whitespace
- deduplicate in first-seen order

Render at most 12 unique skill tags, keeping the existing compact UI.

## Pure Normalization Helpers

Add small exported helpers near the visualizer. They can live in `ProfileVisualizer.tsx` if they stay small, or in `ProfileVisualizerModel.ts` if the component starts feeling crowded.

Recommended helpers:

```ts
export function getUniqueSkills(skills?: string[]): string[]
export function getHiddenExperienceCount(profileData?: ProfileVisualizerData | null): number
export function normalizeProfileVisualizerData(profileData?: ProfileVisualizerData | null): NormalizedProfileVisualizerData
```

The normalized model should include:

- `isActive`
- `displayName`
- `email`
- `summary`
- `experienceCount`
- `projectCount`
- `nodeCount`
- `skills`
- `skillCount`
- `experiences`
- `hiddenExperienceCount`
- `activeJD`

This makes the behavior testable with Node tests and no DOM dependency.

## Tests

### Backend Contract Tests

Extend `electron/services/__tests__/ProfileOrchestrator.test.mjs`.

Add positive coverage for:

- summary passthrough
- 10 experience entries truncate to first 3
- order preservation
- `end` and `description` field preservation

### Visualizer Tests

Continue using `electron/services/__tests__/ProfileVisualizer.test.mjs`, but expand it beyond source-only assertions.

Because no new React rendering dependencies should be added, test exported pure helpers:

- `normalizeProfileVisualizerData(null)` marks inactive empty state.
- `normalizeProfileVisualizerData({})` returns an active empty skeleton with 0 counts and `身份未命名`.
- `normalizeProfileVisualizerData({ experiencePreview: [...] })` preserves N preview entries.
- `getHiddenExperienceCount()` returns the difference between full count and preview count.
- `getUniqueSkills(['a', 'b', 'a', ' '])` returns `['a', 'b']`.

Keep a small source-contract assertion that `ProfileVisualizer` is not a null placeholder and still contains the expected user-facing labels.

## Error Handling

No new error states are needed.

The visualizer should be defensive with optional fields:

- Missing `identity` should not crash.
- Missing or non-array `skills` should behave like an empty array.
- Missing or non-array `experiencePreview` should behave like an empty list.
- Inconsistent counts should not produce negative hidden counts. Use `Math.max(0, experienceCount - experiencePreview.length)`.

## Verification

After implementation, run:

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/ProfileOrchestrator.test.mjs electron/services/__tests__/ProfileVisualizer.test.mjs
npm run build
npm run build:electron
```

Expected result:

- All targeted tests pass.
- Production renderer build passes.
- Electron build artifacts are regenerated after `npm run build` cleans `dist-electron`.

## Acceptance Criteria

- Profile identity is visible inside `ProfileVisualizer`.
- Empty profile states are stable and do not crash.
- Users can see when additional experience entries exist beyond the preview.
- Duplicate skills do not inflate the displayed skill count or tag list.
- Backend profile data contract is covered by targeted positive tests.
- Renderer visualizer behavior is covered by pure helper tests without new test dependencies.
- No Electron main-process type is imported into renderer components.

# Daily Life v0.2.12

_1 October 2026_

## Bug fix: filter bar overflow

- The To do filter bar (All/Overdue/Today/Upcoming/Done) overflowed phone screen width after the "Overdue" pill was added in v0.2.11, requiring a horizontal scroll to reach "Done".
- Tightened pill padding and spacing; all 5 pills now fit on screen without scrolling on typical phone widths.
- Also benefits the Recipes screen's filter pills, which share the same styles.

## Notes

- No Airtable schema changes. `styles.css` only.

# Daily Life v0.2.11

_30 September 2026_

## New: Overdue tasks

- The To do screen now flags overdue tasks instead of mixing them silently into "Upcoming".
- New "Overdue" group, pinned above Today, red-accented — only tasks with a past due date and status ≠ Done.
- Due date reads "N day(s) overdue" in red for those tasks.
- New "Overdue" filter pill alongside All/Today/Upcoming/Done.
- A completed task is never flagged overdue, however late it was finished.

## Notes

- No Airtable schema changes. `worker.js` and `navigation.js` untouched.

# Daily Life v0.2.10

_28 September 2026_

## Changed: Home greeting

- The Home greeting and its icon now change with the time of day: "Good morning" (sunrise), "Good afternoon" (sun), "Good evening" (sunset), "Good night" (moon).
- Boundaries: morning 05:00, afternoon 12:00, evening 17:00, night 21:00 — a default, easy to adjust.

## Notes

- No Airtable schema changes. `worker.js` and `navigation.js` untouched.

# Daily Life v0.2.9

_28 September 2026_

## Changed: Icons

- Replaced all emoji/symbol glyphs across the app with real icons (Lucide, inline SVG) — navigation, header, Home cards, recipe detail, to-do screen, events screen, connection/token screens, and modals.
- New `icons.js` file (small inline SVG icon set + `icon(name)` helper); `index.html` now loads it before `app.js`.
- PWA home-screen icon not included in this pass.

## Notes

- No Airtable schema changes. `worker.js` and `navigation.js` untouched.

# Daily Life v0.2.8

_27 September 2026_

## Performance

- Added edge caching (Cloudflare Cache API) in the Worker for Airtable-backed read endpoints, to stay within Airtable's free-plan limit of 1,000 API calls/month.
- Recipes and meal plan cached 10 minutes; to-do options (Category/Status choices) cached 1 hour.
- To-dos cached 45 seconds, and the cache is purged immediately on any create/update/delete so changes still show up promptly everywhere.
- Prompted by hitting 80% of the monthly Airtable API cap during development alone — every page reload had been re-fetching recipes/to-dos/meal-plan fresh, since the client-side cache resets on reload.

## Changed

- No Airtable schema changes. No frontend changes — `worker.js` only.

# Daily Life v0.2.7

_27 September 2026_

## New: Events module

- Google Calendar surfaced on Home (replacing the Shopping tile) and a new dedicated Events screen.
- New "Events" tab in the bottom navigation.
- Reads the family's shared calendar directly via its private ICS feed — no Airtable involved, no write access from the app.
- Events screen shows the next 14 days, grouped by day; the Home tile shows a live count for the next 7 days.
- "Add event" opens Google Calendar in a new tab rather than creating events in-app.

## User action

- Add `CALENDAR_ICS_URL` as a new Worker secret (Google Calendar → calendar settings → "Secret address in iCal format").

## Known limitation

- The ICS/RRULE parser is hand-written to stay dependency-free. It covers common recurring-event patterns (daily/weekly/monthly/yearly, with count/until/exceptions) but not the full iCalendar spec — worth testing against the real calendar's recurring events.

# Daily Life v0.2.6

_27 September 2026_

## Changed: Home page layout

- Reworked the Home module grid into larger 2×2 cards, each with a title, subtitle and chevron.
- Same four modules, same colours, icons and greeting copy as before — visual/layout change only.

---

# Daily Life v0.2.4

## Performance / responsiveness

- Added in-memory client-side caching for recipes, To-do items, meal plan and To-do options.
- Normal navigation now renders from cached state instead of refetching from the Worker on every tap.
- Removed the full-screen Loading transition from normal navigation.
- Added stale-while-revalidate background refresh with a 60-second freshness window.
- Prevented duplicate concurrent requests for the same data set.
- Recipe detail reuses cached recipe data where detail fields are already present.
- To-do status changes update the UI immediately and persist in the background, with rollback on failure.
- To-do edits update local state immediately; the server is only awaited after the UI has changed.
- To-do deletion updates local cache after server confirmation instead of reloading the screen.
- Initial app load still uses a loading state because the first data fetch must complete.
- No Worker changes required.

# Daily Life v0.2.2

## Stability fix

- The To-do screen no longer fails completely if `/api/todo-options` is unavailable (for example, when the currently deployed Worker has not yet been updated, or the Airtable token cannot read schema metadata).
- In that situation the app falls back to categories already used by existing tasks and the standard To do / In progress / Done statuses.
- Recipes, meal plan and the core To-do API continue to use the normal connection/error handling.

---

# Daily Life v0.2.1

## To-do module

- Fixed long UK date display: `Thursday, 17 September 2026`.
- Category options are loaded from the Airtable **Category** single-select field via the Airtable metadata API.
- Status options are loaded from the Airtable **Status** single-select field when available.
- Added **In progress** as a surfaced task state.
- Quick status control cycles **To do → In progress → Done → To do**.
- Done tasks use a solid green circle with no tick.
- Added status selection to the task form.
- Added due-date sorting with **Newest first** as the default and a toggle to **Oldest first**.
- Existing All / Today / Upcoming / Done filters remain in place.

## Scope

Only the To-do frontend and the Worker API endpoint required for Airtable field options were changed. Authentication and other modules were left unchanged.

## Airtable requirement

The app reads single-select choices from Airtable's base schema. The Airtable token used by the Worker must have permission to read base schema metadata. If schema metadata is unavailable, the frontend falls back to categories already present in the loaded tasks and standard statuses.

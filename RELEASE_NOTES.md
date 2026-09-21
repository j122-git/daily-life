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

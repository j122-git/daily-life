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

# Daily Life v0.2.3 — Android Back Navigation

This is a small navigation patch for the existing Daily Life web app.

## Install

In `index.html`, load the navigation script immediately after the existing app JavaScript:

```html
<script src="Daily-Life-app.js"></script>
<script src="navigation.js"></script>
```

No other app logic needs to change.

## What it does

The existing `show(page, id)` navigation is wrapped so that screens create
browser history entries:

- `#/home`
- `#/recipes`
- `#/recipe/<recipe-id>`
- `#/todo`

Android's system Back button will therefore navigate through the app's
previous screens instead of leaving the website.

The hash-based routes are deliberate because the app is hosted on GitHub Pages
and do not require server-side routing configuration.

## Test

1. Open Home.
2. Tap Recipes.
3. Open a recipe.
4. Press the Android system Back button.
5. You should return to Recipes.
6. Press Back again.
7. You should return to Home.
8. Refresh while on Recipes or a recipe — that route should remain in the URL.

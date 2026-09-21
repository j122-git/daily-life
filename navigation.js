/*
 * Daily Life — browser history navigation
 * v0.2.4
 *
 * Drop this file AFTER the existing Daily-Life app JavaScript in index.html:
 *
 *   <script src="Daily-Life-app.js"></script>
 *   <script src="navigation.js"></script>
 *
 * This keeps the existing app architecture but makes each app screen a
 * browser-history entry. Android's system Back button can therefore move
 * between screens instead of closing/reloading the site.
 *
 * Routes:
 *   #/home
 *   #/recipes
 *   #/recipe/<recipe-id>
 *   #/todo
 */

(() => {
  "use strict";

  const ROUTER_KEY = "daily-life-route-v1";
  let handlingPopState = false;

  function routeFor(page, id) {
    if (page === "recipe" && id) {
      return `#/recipe/${encodeURIComponent(id)}`;
    }
    return `#/${encodeURIComponent(page || "home")}`;
  }

  function routeFromLocation() {
    const hash = window.location.hash.replace(/^#\/?/, "");
    if (!hash || hash === "home") return { page: "home" };

    const parts = hash.split("/").map(decodeURIComponent);

    if (parts[0] === "recipe") {
      return {
        page: "recipe",
        id: parts[1] || undefined
      };
    }

    return { page: parts[0] || "home" };
  }

  function routeKey(route) {
    return `${route.page}:${route.id || ""}`;
  }

  const originalShow = window.show;

  if (typeof originalShow !== "function") {
    console.warn("Daily Life navigation: window.show() was not found.");
    return;
  }

  async function navigate(page, id, options = {}) {
    const route = { page: page || "home", id: id || undefined };
    const url = routeFor(route.page, route.id);

    if (!options.fromHistory && window.location.hash !== url) {
      window.history.pushState(
        { dailyLife: true, page: route.page, id: route.id || null },
        "",
        url
      );
    }

    sessionStorage.setItem(ROUTER_KEY, routeKey(route));

    handlingPopState = !!options.fromHistory;

    try {
      await originalShow(route.page, route.id);
    } finally {
      handlingPopState = false;
    }
  }

  // Replace the global show() used by the existing app's inline handlers.
  window.show = function(page, id) {
    return navigate(page, id);
  };

  window.addEventListener("popstate", () => {
    const route = routeFromLocation();
    navigate(route.page, route.id, { fromHistory: true });
  });

  // Hash navigation is useful on GitHub Pages and also survives a refresh.
  window.addEventListener("hashchange", () => {
    if (handlingPopState) return;

    const route = routeFromLocation();
    const current = sessionStorage.getItem(ROUTER_KEY);

    if (current !== routeKey(route)) {
      navigate(route.page, route.id, { fromHistory: true });
    }
  });

  // If the app is opened directly at a route, honour it.
  const initial = routeFromLocation();

  if (window.location.hash) {
    navigate(initial.page, initial.id, { fromHistory: true });
  } else {
    // Give the initial Home screen a real history entry.
    window.history.replaceState(
      { dailyLife: true, page: "home", id: null },
      "",
      routeFor("home")
    );
    sessionStorage.setItem(ROUTER_KEY, "home:");
  }

  console.info("Daily Life navigation enabled:", routeFor(initial.page, initial.id));
})();

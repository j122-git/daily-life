// Self-check for the tablet helpers in app.js. Run: node app.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = {
  window: { location: { hash: "#/x" } }, console, scrollTo() {}, sessionStorage: {}, fetch: async () => ({}),
  localStorage: { getItem: () => "tok", setItem() {}, removeItem() {} },
  matchMedia: () => ({ matches: true, addEventListener() {} }),
  navigator: {}, setInterval() {}, AudioContext: undefined,
  document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] }
};
ctx.window.localStorage = ctx.localStorage;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("icons.js", "utf8") + fs.readFileSync("app.js", "utf8") + "\nglobalThis.t={stepDurations,ingredientText,timerClock,cookData,cookServings,state,monthGrid,weekLabel};", ctx);
const { stepDurations, ingredientText, timerClock, cookData, cookServings, state, monthGrid, weekLabel } = ctx.t;

// timers found in method steps
assert.deepEqual([...stepDurations("Simmer for 20 minutes.")], [20]);
assert.deepEqual([...stepDurations("Brown for 5 mins, then simmer for 20 minutes")], [5, 20]);
assert.deepEqual([...stepDurations("Rest for 1 hour")], [60]);
assert.deepEqual([...stepDurations("Bake 10-15 minutes")], [10]);
assert.deepEqual([...stepDurations("Stir in the cream")], []);
assert.deepEqual([...stepDurations("Cook 5 min, rest 5 min")], [5]);

// servings scaling
const x = { quantity: 600, unit: "g", name: "chicken thighs", preparation: "diced", optional: false, text: "600g chicken thighs, diced" };
assert.equal(ingredientText(x, 1), "600g chicken thighs, diced");
assert.equal(ingredientText(x, 1.25), "750g chicken thighs, diced");
assert.equal(ingredientText({ quantity: 2, unit: "tbsp", name: "paste", text: "" }, 1.25), "2.5 tbsp paste");
assert.equal(ingredientText({ quantity: null, name: "salt", text: "salt" }, 2), "salt");

// timer clock
assert.equal(timerClock({ left: 59000, done: false }), "0:59");
assert.equal(timerClock({ left: 20 * 60000, done: false }), "20:00");
assert.equal(timerClock({ left: 3725000, done: false }), "1:02:05");
assert.equal(timerClock({ left: 0, done: true }), "Done");

// factor comes from the chosen servings
state.recipes = [{ id: "r1", servings: 4, recipeText: "A\nB", ingredients: [] }];
cookServings.r1 = 6;
assert.equal(cookData(state.recipes[0]).f, 1.5);
// calendar grid: weeks start on Monday and the grid has only the rows the month needs
assert.deepEqual({ ...monthGrid("2026-10") }, { start: "2026-09-28", weeks: 5 });
assert.deepEqual({ ...monthGrid("2026-02") }, { start: "2026-01-26", weeks: 5 });
assert.deepEqual({ ...monthGrid("2026-11") }, { start: "2026-10-26", weeks: 6 });
assert.equal(weekLabel("2026-10-19"), "19 – 25 Oct 2026");
assert.equal(weekLabel("2026-10-26"), "26 Oct – 1 Nov 2026");
console.log("app.test.mjs: ok");

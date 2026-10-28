"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/selection-utils.js"), "utf8"), context);
const G = context.SelectDictSelection;
const view = {left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800};
const rect = (left, top, width = 120, height = 24) => ({left, top, width, height, right: left + width, bottom: top + height});
test("empty, nonfinite and offscreen trailing rectangles cannot pull a bubble to the origin", () => {
  const anchor = G.anchorRectangle([rect(610, 350), rect(0, 0, 0, 18), rect(NaN, 0), rect(0, 1500)], view);
  assert.equal(anchor.left, 610); assert.equal(anchor.top, 350);
});
test("a backwards drag uses the line nearest the release point", () => {
  const anchor = G.anchorRectangle([rect(450, 300), rect(450, 340), rect(450, 380)], view, {x: 475, y: 303});
  assert.equal(anchor.top, 300);
});
test("keyboard selections use the visible end in the selection direction", () => {
  const values = [rect(450, 300), rect(450, 340), rect(450, 900)];
  assert.equal(G.anchorRectangle(values, view).top, 340);
  assert.equal(G.anchorRectangle(values, view, null, true).top, 300);
});
test("missing geometry uses a real pointer or the viewport centre rather than a fictitious corner", () => {
  assert.equal(G.fallbackAnchor(view, {x: 720, y: 410}).left, 720);
  const fallback = G.fallbackAnchor(view, {x: NaN, y: 20});
  assert.equal(fallback.left, 640); assert.equal(fallback.top, 400);
});
test("a long result fits in the space below its selection and remains next to it", () => {
  const placement = G.placeBubble(rect(600, 260), {width: 390, height: 560}, view);
  assert.equal(placement.x, 600); assert.equal(placement.y, 293);
  assert.equal(placement.maxHeight, 495);
});
test("a result near the bottom opens above and stays within the viewport", () => {
  const p = G.placeBubble(rect(1170, 730), {width: 390, height: 220}, view);
  assert.equal(p.x, 878); assert.equal(p.y, 501);
  assert.ok(p.y >= 12 && p.y + 220 <= 788);
});
test("a zoomed visual viewport uses its offsets instead of layout-viewport origin", () => {
  const zoomed = {left: 300, top: 180, width: 500, height: 400, right: 800, bottom: 580};
  const p = G.placeBubble(rect(690, 500), {width: 390, height: 160}, zoomed);
  assert.equal(p.x, 398); assert.equal(p.y, 331);
  const clipped = G.anchorRectangle([rect(20, 20), rect(680, 490)], zoomed);
  assert.equal(clipped.left, 680);
});

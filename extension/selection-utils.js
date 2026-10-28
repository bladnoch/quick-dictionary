/* Geometry only. Client rectangles and pointer coordinates use the same CSS-pixel viewport. */
(function (root) {
  "use strict";
  function rectangle(value) {
    if (!value) return null;
    const left = value.left, top = value.top;
    const right = Number.isFinite(value.right) ? value.right : left + value.width;
    const bottom = Number.isFinite(value.bottom) ? value.bottom : top + value.height;
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
    return {left, top, right, bottom, width: right - left, height: bottom - top};
  }
  function visibleRectangle(value, viewport) {
    const r = rectangle(value);
    if (!r) return null;
    return rectangle({left: Math.max(r.left, viewport.left), top: Math.max(r.top, viewport.top),
      right: Math.min(r.right, viewport.right), bottom: Math.min(r.bottom, viewport.bottom)});
  }
  function visiblePoint(point, viewport) {
    return Boolean(point && [point.x, point.y].every(Number.isFinite) && point.x >= viewport.left &&
      point.x <= viewport.right && point.y >= viewport.top && point.y <= viewport.bottom);
  }
  function anchorRectangle(values, viewport, point, backward = false) {
    const rectangles = values.map(value => visibleRectangle(value, viewport)).filter(Boolean);
    if (!rectangles.length) return null;
    if (!visiblePoint(point, viewport)) return backward ? rectangles[0] : rectangles.at(-1);
    const distance = r => Math.max(r.left - point.x, 0, point.x - r.right) ** 2 +
      Math.max(r.top - point.y, 0, point.y - r.bottom) ** 2;
    return rectangles.reduce((nearest, candidate) => distance(candidate) < distance(nearest) ? candidate : nearest);
  }
  function fallbackAnchor(viewport, point) {
    const p = visiblePoint(point, viewport) ? point : {x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2};
    return {left: p.x, right: p.x, top: p.y, bottom: p.y, width: 0, height: 0};
  }
  function placeBubble(anchor, size, viewport) {
    const margin = 12, gap = 9;
    const below = Math.max(0, viewport.bottom - margin - anchor.bottom - gap);
    const above = Math.max(0, anchor.top - gap - viewport.top - margin);
    const useBelow = size.height <= below || below >= above;
    // Limit a long result to available space instead of clamping its full height to the top edge.
    const room = Math.min(Math.max(1, viewport.height - 2 * margin), Math.max(above, below) >= 96 ? (useBelow ? below : above) : viewport.height - 2 * margin);
    const height = Math.min(size.height, room);
    const clamp = (n, min, max) => Math.max(min, Math.min(n, Math.max(min, max)));
    return {
      x: clamp(anchor.left, viewport.left + margin, viewport.right - size.width - margin),
      y: clamp(useBelow ? anchor.bottom + gap : anchor.top - gap - height, viewport.top + margin, viewport.bottom - height - margin),
      maxHeight: room
    };
  }
  root.SelectDictSelection = Object.freeze({rectangle, visibleRectangle, visiblePoint, anchorRectangle, fallbackAnchor, placeBubble});
})(globalThis);

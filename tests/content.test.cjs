"use strict";
/* Event-driven content-script integration tests with a small DOM test double.
 * This is not a real Chrome rendering or extension-installation test. */
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const base = path.join(__dirname, "../extension");

class Element extends EventTarget {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.nodeType = 1; this.children = []; this.className = ""; this.attributes = {}; this.style = {values: {}, setProperty(key, value) {this.values[key] = value;}, getPropertyValue(key) {return this.values[key] || "";}}; this._text = ""; this.parentElement = null; }
  set textContent(value) {this._text = String(value); this.children = [];}
  get textContent() {return this._text + this.children.map(child => child.textContent).join("");}
  append(...children) {for (const child of children) {child.remove(); child.parentElement = this; this.children.push(child);}}
  remove() {if (this.parentElement) {this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null;}}
  setAttribute(key, value) {this.attributes[key] = value;}
  getAttribute(key) {return this.attributes[key] ?? null;}
  removeAttribute(key) {delete this.attributes[key];}
  focus() {this.focusCalls = (this.focusCalls || 0) + 1; this.getRootNode().activeElement = this;}
  attachShadow() {this.shadowRoot = new Element("shadow-root"); this.shadowRoot.host = this; return this.shadowRoot;}
  get isConnected() {return this.tagName === "HTML" || Boolean(this.parentElement?.isConnected);}
  getBoundingClientRect() {return this.bounds || {left: 10, top: 10, bottom: 210, width: 372, height: 200};}
  contains(value) {return this === value || this.children.some(child => child.contains(value));}
  getRootNode() {return this.parentElement ? this.parentElement.getRootNode() : this;}
  matches(selector) {return this.tagName === "INPUT" && ((this.type === "password" && selector.includes("password")) || (this.autocomplete && selector.includes('autocomplete="' + this.autocomplete + '"')));}
  closest(selector) {
    if (this.matches(selector) || (selector.includes("contenteditable") && this.isContentEditable) || (selector.includes("textarea") && this.tagName === "TEXTAREA")) return this;
    return this.parentElement?.closest(selector) || null;
  }
  querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
  querySelectorAll(selector) {
    const matches = element => selector.startsWith(".") ? element.className.split(" ").includes(selector.slice(1)) : element.tagName.toLowerCase() === selector.toLowerCase();
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}
const settle = async () => {await new Promise(setImmediate); await new Promise(setImmediate);};
async function harness(options = {}) {
  const config = {settingsVersion: 2, enabled: true, selectionMode: "button", fallbackToWindow: true, ...options};
  const messages = [], listeners = {}, timers = new Map(); let nextTimer = 0, now = 0, text = "";
  let rectangles = [{left: 55, top: 110, bottom: 135, width: 100, height: 25}], anchor, focus, selectionOverride;
  const document = new EventTarget();
  document.documentElement = new Element("html"); document.documentElement.clientWidth = 1280; document.documentElement.clientHeight = 800;
  const body = new Element("body"), paragraph = new Element("p"); body.append(paragraph); document.documentElement.append(body);
  anchor = paragraph; focus = paragraph;
  class NativeElement extends Element {
    get popover() {return this.getAttribute("popover");}
    showPopover() {if (options.popoverFailure) throw new Error("Unavailable"); this.isPopoverOpen = true;}
    hidePopover() {this.isPopoverOpen = false;}
  }
  const ElementType = options.nativePopover ? NativeElement : Element;
  document.activeElement = body;
  document.createElement = tag => {
    const element = new ElementType(tag);
    if (options.constructedStyles) element.attachShadow = function () {const result = Element.prototype.attachShadow.call(this); result.adoptedStyleSheets = []; return result;};
    return element;
  };
  document.hasFocus = () => true;
  const window = new EventTarget(); window.innerWidth = 1280; window.innerHeight = 800;
  let reloads = 0; window.location = {reload() {reloads++;}};
  if (options.visualViewport) window.visualViewport = Object.assign(new EventTarget(), options.visualViewport);
  window.getSelection = () => ({isCollapsed: !text, rangeCount: text ? 1 : 0, anchorNode: anchor, focusNode: focus, toString: () => text,
    getRangeAt: () => {if (options.rangeFailure) throw new Error("Detached selection"); return {getClientRects: () => rectangles, getBoundingClientRect: () => options.rangeBounds || rectangles[0]};}, ...selectionOverride});
  let handler = async message => ({ok: true, result: message.provider === "naver" ? {provider: "naver", query: message.text, entries: [{headword: message.text, pronunciation: "", source: "Test fixture", meanings: [{partOfSpeech: "명사", value: "테스트 뜻"}]}]} : {provider: "google", query: message.text, translated: "테스트 번역"}});
  const chrome = {
    runtime: {id: "extension-id", sendMessage: async message => {
      messages.push(message);
      if (message.type === "GET_SETTINGS") return {ok: true, settings: config};
      if (message.type === "OPEN_PROVIDER" || message.type === "OPEN_SETTINGS") return {ok: true};
      return handler(message);
    }, onMessage: {addListener(fn) {listeners.message = fn;}}},
    storage: {onChanged: {addListener(fn) {listeners.storage = fn;}}}
  };
  const sandbox = {chrome, document, window, HTMLElement: ElementType, CSSStyleSheet: options.constructedStyles ? class {replaceSync(css) {this.css = css;}} : undefined,
    location: {hostname: "example.com"}, navigator: {clipboard: {writeText: async () => {}}}, Node: {ELEMENT_NODE: 1}, URLSearchParams, console,
    setTimeout(fn, delay) {const id = ++nextTimer; timers.set(id, {fn, at: now + delay}); return id;}, clearTimeout(id) {timers.delete(id);}};
  const context = vm.createContext(sandbox);
  for (const file of ["shared.js", "selection-utils.js", "messaging.js", "bubble-styles.js", "content.js"]) vm.runInContext(fs.readFileSync(path.join(base, file), "utf8"), context);
  await settle();
  function fire(type, details = {}) {
    const event = new Event(type, {cancelable: true});
    const properties = {button: 0, clientX: 60, clientY: 130, ...details};
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, {value});
    event.composedPath = () => details.path || [details.target || document];
    document.dispatchEvent(event);
  }
  async function advance(ms = 300) {
    now += ms;
    for (const [id, timer] of Array.from(timers)) if (timer.at <= now) {timers.delete(id); timer.fn();}
    await settle();
  }
  const ui = () => document.documentElement.querySelector("select-dictionary-popup")?.shadowRoot;
  return {messages, listeners, document, window, fire, advance, ui,
    invalidate() {chrome.runtime.id = undefined;},
    reloads: () => reloads,
    select: (value, details = {}) => {
      fire("pointerdown", {...details, clientX: (details.clientX ?? 60) - 20});
      text = value; fire("selectionchange"); fire("pointerup", details);
    },
    selectText: value => {text = value;},
    setRectangles: value => {rectangles = value;},
    setSelection: value => {selectionOverride = value;},
    edit(tag = "div") {
      const editor = document.createElement(tag); editor.isContentEditable = tag === "div";
      body.append(editor); document.activeElement = editor; anchor = editor; focus = editor;
      return editor;
    },
    coordinates() {const host = document.documentElement.querySelector("select-dictionary-popup"); return {x: parseFloat(host?.style.getPropertyValue("--sd-left")), y: parseFloat(host?.style.getPropertyValue("--sd-top")), room: parseFloat(host?.style.getPropertyValue("--sd-room"))};},
    setHandler: value => {handler = value;},
    lookups: () => messages.filter(message => message.type === "LOOKUP"),
    opens: () => messages.filter(message => message.type === "OPEN_PROVIDER")};
}
test("button mode displays a prompt and makes zero provider requests until clicked", async () => {
  const h = await harness(); h.select("warehouse"); await h.advance();
  assert.equal(h.lookups().length, 0); assert.match(h.ui().textContent, /사전 찾기/);
  h.ui().querySelector(".ask").dispatchEvent(new Event("click", {cancelable: true})); await settle();
  assert.equal(h.lookups().length, 1); assert.equal(h.lookups()[0].provider, "naver"); assert.match(h.ui().textContent, /테스트 뜻/);
});
test("automatic mode immediately requests a word from Naver after the configured delay", async () => {
  const h = await harness({selectionMode: "auto"}); h.select("warehouse");
  assert.equal(h.lookups().length, 0); await h.advance(300);
  assert.equal(h.lookups().length, 1); assert.equal(h.lookups()[0].provider, "naver");
});
test("automatic mode routes a sentence to Google and shows its translation", async () => {
  const h = await harness({selectionMode: "auto"}); h.select("The warehouse is ready."); await h.advance();
  assert.equal(h.lookups()[0].provider, "google"); assert.match(h.ui().textContent, /테스트 번역/);
});
test("a sentence in button mode shows translate prompt without querying", async () => {
  const h = await harness(); h.select("The warehouse is ready."); await h.advance();
  assert.equal(h.lookups().length, 0); assert.match(h.ui().textContent, /번역하기/);
});
test("keyboard selection follows the same prompt mode", async () => {
  const h = await harness(); h.selectText("warehouse"); h.fire("keyup", {key: "ArrowRight", shiftKey: true}); await h.advance();
  assert.match(h.ui().textContent, /사전 찾기/); assert.equal(h.lookups().length, 0);
});
test("disabled extension, excluded domain and numeric-only selections do not query", async () => {
  for (const config of [{enabled: false}, {excludedDomains: ["example.com"]}, {}]) {
    const h = await harness({selectionMode: "auto", ...config}); h.select(Object.keys(config).length ? "warehouse" : "1234"); await h.advance();
    assert.equal(h.lookups().length, 0); assert.equal(h.ui(), undefined);
  }
});
test("password fields never send selected input", async () => {
  const h = await harness({selectionMode: "auto", ignoreEditable: false});
  const input = new Element("input"); input.type = "password"; input.value = "private"; input.selectionStart = 0; input.selectionEnd = 7;
  h.document.activeElement = input; h.select("private"); await h.advance();
  assert.equal(h.lookups().length, 0);
});
test("Escape removes the visible popup", async () => {
  const h = await harness(); h.select("warehouse"); await h.advance(); assert.ok(h.ui());
  h.fire("keydown", {key: "Escape"}); assert.equal(h.ui(), undefined);
});
test("a newer selection cancels the earlier pending selection timer", async () => {
  const h = await harness({selectionMode: "auto"}); h.select("first"); h.select("second"); await h.advance();
  assert.equal(h.lookups().length, 1); assert.equal(h.lookups()[0].text, "second");
});
test("a late failed request cannot overwrite the new result or open a fallback popup", async () => {
  const h = await harness({selectionMode: "auto"}); let firstComplete;
  h.setHandler(message => message.text === "first" ? new Promise(resolve => {firstComplete = resolve;}) : Promise.resolve({ok: true, result: {provider: "google", translated: "새로운 결과"}}));
  h.select("first"); await h.advance();
  h.select("a new sentence"); await h.advance();
  firstComplete({ok: false, message: "late failure", canFallback: true}); await settle();
  assert.match(h.ui().textContent, /새로운 결과/); assert.doesNotMatch(h.ui().textContent, /late failure/); assert.equal(h.opens().length, 0);
});
test("a current failed request stays in the bubble even if a response requests legacy fallback", async () => {
  const h = await harness({selectionMode: "auto"});
  h.setHandler(async () => ({ok: false, message: "rate limited", canFallback: true}));
  h.select("a full sentence"); await h.advance();
  assert.equal(h.opens().length, 0);
  assert.match(h.ui().textContent, /rate limited/);
  assert.match(h.ui().textContent, /다시 시도/);
  assert.match(h.ui().textContent, /새 창은 자동으로 열지 않습니다/);
});
test("settings changes take effect without reloading the page", async () => {
  const h = await harness();
  h.listeners.storage({settings: {newValue: {selectionMode: "auto"}}}, "local");
  h.select("warehouse"); await h.advance(); assert.equal(h.lookups().length, 1);
});
test("context menu can explicitly override the sentence routing", async () => {
  const h = await harness(); let response;
  h.listeners.message({type: "SHOW_LOOKUP", text: "ice cream", provider: "naver"}, {}, value => {response = value;}); await settle();
  assert.equal(response.handled, true); assert.equal(h.lookups()[0].provider, "naver");
});
test("native popover promotes the bubble to the top layer and closes on Escape", async () => {
  const h = await harness({nativePopover: true}); h.select("warehouse"); await h.advance();
  const host = h.document.documentElement.querySelector("select-dictionary-popup");
  assert.equal(host.getAttribute("popover"), "manual"); assert.equal(host.isPopoverOpen, true);
  h.fire("keydown", {key: "Escape"}); assert.equal(host.isPopoverOpen, false); assert.equal(h.ui(), undefined);
});
test("unsupported or failing popovers still leave a functioning fixed-position bubble", async () => {
  for (const options of [{}, {nativePopover: true, popoverFailure: true}]) {
    const h = await harness(options); h.select("warehouse"); await h.advance();
    assert.match(h.ui().textContent, /사전 찾기/);
    const host = h.document.documentElement.querySelector("select-dictionary-popup");
    assert.equal(host.getAttribute("popover"), null);
    h.ui().querySelector(".ask").dispatchEvent(new Event("click", {cancelable: true})); await settle();
    assert.match(h.ui().textContent, /테스트 뜻/);
  }
});
test("constructable stylesheets are used when available, with no inline style element", async () => {
  const h = await harness({constructedStyles: true}); h.select("warehouse"); await h.advance();
  assert.equal(h.ui().adoptedStyleSheets.length, 1);
  assert.match(h.ui().adoptedStyleSheets[0].css, /prefers-color-scheme/);
  assert.equal(h.ui().querySelector("style"), null);
});
test("explicit keyboard lookup can receive focus and restore it on Escape", async () => {
  const h = await harness({nativePopover: true}); h.selectText("warehouse");
  const previous = h.document.activeElement;
  h.listeners.message({type: "LOOKUP_SELECTION"}, {}, () => {}); await settle();
  const card = h.ui().querySelector(".card"); assert.ok(card.focusCalls > 0);
  h.fire("keydown", {key: "Escape"}); assert.ok(previous.focusCalls > 0);
});

test("Notion-style contenteditable selections work in button and automatic modes", async () => {
  for (const selectionMode of ["button", "auto"]) {
    const h = await harness({selectionMode}); h.edit();
    h.select("warehouse"); await h.advance();
    assert.ok(h.ui());
    if (selectionMode === "button") {
      assert.equal(h.lookups().length, 0);
      h.ui().querySelector(".ask").dispatchEvent(new Event("click", {cancelable: true})); await settle();
    }
    assert.equal(h.lookups()[0].text, "warehouse"); assert.match(h.ui().textContent, /테스트 뜻/);
  }
});
test("textarea selection is read from character offsets rather than document selection", async () => {
  const h = await harness({selectionMode: "auto"}); const input = h.edit("textarea");
  input.value = "Write a sentence here."; input.selectionStart = 0; input.selectionEnd = input.value.length;
  input.bounds = {left: 480, top: 280, width: 500, height: 240, bottom: 520};
  h.fire("select", {target: input}); await h.advance();
  assert.equal(h.lookups()[0].text, input.value); assert.equal(h.lookups()[0].provider, "google");
  assert.ok(h.coordinates().x > 400);
});
test("selectionchange catches editors that do not deliver pointerup or keyboard events", async () => {
  const h = await harness({selectionMode: "auto"}); h.edit();
  h.selectText("The warehouse is ready."); h.fire("selectionchange"); await h.advance();
  assert.equal(h.lookups().length, 1); assert.equal(h.lookups()[0].provider, "google");
});
test("an editor replacing selection after pointerup does not lose the captured text", async () => {
  const h = await harness({selectionMode: "auto"}); h.edit(); h.select("warehouse");
  h.selectText(""); h.fire("selectionchange"); await h.advance();
  assert.equal(h.lookups()[0].text, "warehouse"); assert.match(h.ui().textContent, /테스트 뜻/);
});
test("typing and IME composition cancel a pending editor lookup", async () => {
  for (const event of ["beforeinput", "input", "compositionstart"]) {
    const h = await harness({selectionMode: "auto"}); const editor = h.edit(); h.select("warehouse");
    h.selectText(""); h.fire(event, {target: editor}); await h.advance();
    assert.equal(h.lookups().length, 0); assert.equal(h.ui(), undefined);
  }
});
test("an explicit editor opt-out stops automatic lookup but preserves the keyboard command", async () => {
  const h = await harness({ignoreEditable: true, selectionMode: "auto"}); h.edit();
  h.select("warehouse"); await h.advance(); assert.equal(h.lookups().length, 0);
  h.listeners.message({type: "LOOKUP_SELECTION"}, {}, () => {}); await settle();
  assert.equal(h.lookups().length, 1);
});
test("one-time-code inputs remain excluded from selectionchange lookup", async () => {
  const h = await harness({selectionMode: "auto"}); const input = h.edit("input");
  input.autocomplete = "one-time-code"; input.value = "secretcode"; input.selectionStart = 0; input.selectionEnd = 10;
  h.fire("select", {target: input}); await h.advance(); assert.equal(h.lookups().length, 0);
});
test("selectionchange during a drag does not query until the user releases the pointer", async () => {
  const h = await harness({selectionMode: "auto"}); h.fire("pointerdown"); h.selectText("warehouse");
  h.fire("selectionchange"); await h.advance(); assert.equal(h.lookups().length, 0);
  h.fire("pointerup"); await h.advance(); assert.equal(h.lookups().length, 1);
});
test("a trailing zero-width origin rect does not move the bubble away from selected text", async () => {
  const h = await harness();
  h.setRectangles([{left: 600, top: 340, width: 150, height: 24, bottom: 364}, {left: 0, top: 0, width: 0, height: 18, bottom: 18}]);
  h.select("warehouse", {clientX: 700, clientY: 352}); await h.advance();
  assert.equal(h.coordinates().x, 600); assert.equal(h.coordinates().y, 373);
});
test("invalid or inaccessible range geometry falls back to the release point", async () => {
  for (const options of [{}, {rangeFailure: true}]) {
    const h = await harness(options);
    h.setRectangles([{left: NaN, top: 0, width: 0, height: 0}]);
    h.select("warehouse", {clientX: 720, clientY: 370}); await h.advance();
    assert.equal(h.coordinates().x, 720); assert.equal(h.coordinates().y, 379);
  }
});
test("repeated selectionchange does not repeat a finished request or reopen a dismissed bubble", async () => {
  const h = await harness({selectionMode: "auto"}); h.select("warehouse"); await h.advance();
  h.fire("selectionchange"); await h.advance(); assert.equal(h.lookups().length, 1);
  h.fire("keydown", {key: "Escape"}); h.fire("selectionchange"); await h.advance();
  assert.equal(h.ui(), undefined); assert.equal(h.lookups().length, 1);
});
test("scroll reanchors an existing result instead of removing it", async () => {
  const h = await harness({selectionMode: "auto"}); h.select("warehouse"); await h.advance();
  h.setRectangles([{left: 500, top: 300, width: 150, height: 24, bottom: 324}]);
  h.fire("scroll"); assert.ok(h.ui()); assert.equal(h.coordinates().x, 500); assert.equal(h.lookups().length, 1);
});
test("bubble coordinates stay within a zoomed visual viewport", async () => {
  const h = await harness({visualViewport: {offsetLeft: 300, offsetTop: 180, width: 500, height: 400}});
  h.setRectangles([{left: 650, top: 450, width: 100, height: 24, bottom: 474}]);
  h.select("warehouse", {clientX: 700, clientY: 460}); await h.advance();
  const p = h.coordinates(); assert.ok(p.x >= 312 && p.x + 372 <= 788); assert.ok(p.y >= 192);
});

test("a shadow editor uses composed selection geometry instead of its host's origin rectangle", async () => {
  const h = await harness(); const outer = h.edit(); const root = outer.attachShadow();
  const inner = h.document.createElement("div"); inner.isContentEditable = true; root.append(inner); root.activeElement = inner;
  h.document.createRange = () => ({setStart() {}, setEnd() {}, getClientRects: () => [{left: 630, top: 350, width: 120, height: 24, bottom: 374}]});
  h.setSelection({anchorNode: inner, focusNode: inner, getRangeAt: () => ({getClientRects: () => [{left: 0, top: 0, width: 1280, height: 800, bottom: 800}]}),
    getComposedRanges(options) {
      assert.ok(options.shadowRoots.includes(root));
      return [{startContainer: inner, endContainer: inner, startOffset: 0, endOffset: 1}];
    }});
  h.select("warehouse", {clientX: 700, clientY: 360}); await h.advance();
  assert.equal(h.coordinates().x, 630); assert.equal(h.coordinates().y, 383);
});
test("explicit context lookup in a password field cannot trigger a provider request or navigation", async () => {
  const h = await harness(); const field = h.edit("input"); field.type = "password";
  let response;
  h.listeners.message({type: "SHOW_LOOKUP", text: "private"}, {}, value => {response = value;}); await settle();
  assert.equal(response.handled, true); assert.equal(h.lookups().length, 0); assert.equal(h.opens().length, 0);
});

test("Escape cancels a delayed selection even if a queued selectionchange arrives afterwards", async () => {
  const h = await harness({selectionMode: "auto"}); h.select("warehouse");
  h.fire("keydown", {key: "Escape"}); h.fire("selectionchange"); await h.advance();
  assert.equal(h.lookups().length, 0); assert.equal(h.ui(), undefined);
});
test("losing focus during keyboard selection cannot disable the next mouse lookup", async () => {
  const h = await harness({selectionMode: "auto"}); h.fire("keydown", {key: "Shift"});
  h.window.dispatchEvent(new Event("blur")); h.select("warehouse"); await h.advance();
  assert.equal(h.lookups().length, 1); assert.ok(h.ui());
});
test("geometry is refreshed when the editor scrolls between release and delayed display", async () => {
  const h = await harness(); h.select("warehouse");
  h.setRectangles([{left: 620, top: 330, width: 120, height: 24, bottom: 354}]);
  await h.advance(); assert.equal(h.coordinates().x, 620); assert.equal(h.coordinates().y, 363);
});

test("an expired extension offers a user-triggered reload and never retries a dead context", async () => {
  const h = await harness({selectionMode: "auto"}); h.edit(); h.invalidate(); h.select("extension"); await h.advance();
  assert.equal(h.lookups().length, 0); assert.equal(h.opens().length, 0); assert.equal(h.reloads(), 0);
  assert.match(h.ui().textContent, /CONTEXT_INVALIDATED/); assert.match(h.ui().textContent, /저장됐는지/);
  const buttons = h.ui().querySelectorAll("button");
  assert.equal(buttons.some(button => button.textContent === "다시 시도"), false);
  assert.equal(buttons.some(button => button.textContent === "작은 창"), false);
  buttons.find(button => button.textContent === "이 페이지 새로고침").dispatchEvent(new Event("click", {cancelable: true}));
  assert.equal(h.reloads(), 1);
});
test("a temporarily missing receiver recovers inside the bubble without navigation", async () => {
  const h = await harness({selectionMode: "auto"}); let attempt = 0;
  h.setHandler(async () => {if (++attempt === 1) throw new Error("Could not establish connection. Receiving end does not exist."); return {ok: true, result: {provider: "google", translated: "연결 복구 성공"}};});
  h.select("A full sentence."); await h.advance(); await h.advance(150);
  assert.equal(h.lookups().length, 2); assert.match(h.ui().textContent, /연결 복구 성공/);
  assert.equal(h.opens().length, 0); assert.equal(h.reloads(), 0);
});
test("unknown messaging errors show diagnostic details and remain manually retryable", async () => {
  const h = await harness({selectionMode: "auto"});
  h.setHandler(async () => {throw new Error("An unexpected listener error");});
  h.select("extension"); await h.advance();
  assert.match(h.ui().textContent, /MESSAGE_REJECTED/); assert.match(h.ui().textContent, /An unexpected listener error/);
  assert.match(h.ui().textContent, /다시 시도/); assert.equal(h.reloads(), 0);
});

test("an outside click dismisses the prompt without reopening a retained selection", async () => {
  const h = await harness(); h.select("warehouse"); await h.advance(); assert.ok(h.ui());
  h.fire("pointerdown", {clientX: 800, clientY: 500}); assert.equal(h.ui(), undefined);
  h.fire("pointerup", {clientX: 800, clientY: 500});
  h.fire("selectionchange"); await h.advance();
  assert.equal(h.ui(), undefined); assert.equal(h.lookups().length, 0);
});
test("an outside click cannot repeat a finished automatic lookup", async () => {
  const h = await harness({selectionMode: "auto"}); h.select("warehouse"); await h.advance();
  const count = h.lookups().length; assert.equal(count, 1);
  h.fire("pointerdown", {clientX: 800, clientY: 500}); h.fire("pointerup", {clientX: 800, clientY: 500});
  h.fire("selectionchange"); await h.advance();
  assert.equal(h.ui(), undefined); assert.equal(h.lookups().length, count);
});
test("a selection cleared after pointerup cannot reopen a dismissed bubble from a cached snapshot", async () => {
  const h = await harness(); h.select("warehouse"); await h.advance();
  h.fire("pointerdown", {clientX: 800, clientY: 500}); h.fire("pointerup", {clientX: 800, clientY: 500});
  h.selectText(""); h.fire("selectionchange"); await h.advance();
  assert.equal(h.ui(), undefined);
});

test("a fresh drag of the same word is allowed after an outside-click dismissal", async () => {
  for (const selectionMode of ["button", "auto"]) {
    const h = await harness({selectionMode}); h.select("warehouse"); await h.advance();
    h.fire("pointerdown", {clientX: 800, clientY: 500}); h.fire("pointerup", {clientX: 800, clientY: 500}); await h.advance();
    assert.equal(h.ui(), undefined);
    h.select("warehouse"); await h.advance(); assert.ok(h.ui());
    assert.equal(h.lookups().length, selectionMode === "auto" ? 2 : 0);
  }
});
test("dragging a different word directly from a visible popup still opens the new result", async () => {
  const h = await harness({selectionMode: "auto"}); h.select("first"); await h.advance();
  h.select("second"); await h.advance();
  assert.equal(h.lookups().length, 2); assert.equal(h.lookups()[1].text, "second"); assert.ok(h.ui());
});
test("an outside click during the display delay cancels the selection without sending a lookup", async () => {
  const h = await harness({selectionMode: "auto"}); h.select("warehouse");
  h.fire("pointerdown", {clientX: 800, clientY: 500}); h.fire("pointerup", {clientX: 800, clientY: 500});
  h.fire("selectionchange"); await h.advance();
  assert.equal(h.lookups().length, 0); assert.equal(h.ui(), undefined);
});
test("a late lookup completion cannot resurrect a popup dismissed by an outside click", async () => {
  const h = await harness({selectionMode: "auto"}); let complete;
  h.setHandler(() => new Promise(resolve => {complete = resolve;}));
  h.select("warehouse"); await h.advance(); assert.ok(h.ui());
  h.fire("pointerdown", {clientX: 800, clientY: 500}); h.fire("pointerup", {clientX: 800, clientY: 500});
  complete({ok: true, result: {provider: "google", translated: "late result"}}); await settle(); await h.advance();
  assert.equal(h.ui(), undefined); assert.equal(h.lookups().length, 1);
});
test("a different occurrence of identical text is not blocked by a prior dismissal", async () => {
  const h = await harness(); h.setSelection({anchorOffset: 0, focusOffset: 9});
  h.select("warehouse"); await h.advance();
  h.fire("pointerdown", {clientX: 800, clientY: 500}); h.fire("pointerup", {clientX: 800, clientY: 500}); await h.advance();
  assert.equal(h.ui(), undefined);
  h.setSelection({anchorOffset: 20, focusOffset: 29}); h.fire("selectionchange"); await h.advance(); assert.ok(h.ui());
});
test("outside-click dismissal preserves an editable selection without reopening its popup", async () => {
  const h = await harness(); const input = h.edit("textarea");
  input.value = "warehouse"; input.selectionStart = 0; input.selectionEnd = 9;
  h.fire("select", {target: input}); await h.advance(); assert.ok(h.ui());
  h.fire("pointerdown", {clientX: 800, clientY: 500}); h.fire("pointerup", {clientX: 800, clientY: 500});
  h.fire("select", {target: input}); await h.advance();
  assert.equal(h.ui(), undefined); assert.equal(input.selectionStart, 0); assert.equal(input.selectionEnd, 9);
});

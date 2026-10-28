(function () {
  "use strict";
  const C = globalThis.SelectDictCore;
  const S = globalThis.SelectDictSelection;
  if (!C || !S || !globalThis.SelectDictMessaging || globalThis.__selectDictLoaded) return;
  globalThis.__selectDictLoaded = true;
  let config = C.sanitizeSettings();
  let host = null, shadow = null, current = null, timer = null, requestId = 0, ready = false;
  let lastPointer = null, selectionTarget = null, pendingSnapshot = null, dismissedSelection = null, pointerStart = null;
  let pointerSelecting = false, keyboardSelecting = false, composing = false;
  let popoverOpen = false, adoptedSheet = null;
  const styleText = globalThis.SelectDictBubbleStyles;
  const connection = globalThis.SelectDictMessaging.createClient();
  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value != null) element.textContent = value;
    return element;
  }
  function send(message) { return connection.send(message); }
  function close(restoreFocus = false) {
    clearTimeout(timer);
    if (restoreFocus) dismissedSelection = current || pendingSnapshot || dismissedSelection;
    pendingSnapshot = null;
    requestId++;
    const returnFocus = restoreFocus && shadow?.activeElement ? current?.returnFocus : null;
    if (popoverOpen) { try { host?.hidePopover(); } catch { /* Removal still closes the overlay. */ } }
    host?.remove(); host = null; shadow = null; current = null;
    popoverOpen = false;
    if (returnFocus?.isConnected) returnFocus.focus?.({preventScroll: true});
  }
  function ownEvent(event) { return Boolean(host && event.composedPath().includes(host)); }
  function ensureUI() {
    if (host?.isConnected) return;
    host = document.createElement("select-dictionary-popup");
    host.setAttribute("data-select-dictionary", "");
    host.setAttribute("translate", "no");
    host.setAttribute("lang", "ko");
    // Native top-layer rendering avoids clipping by the host page. Chrome 109 falls back to fixed positioning.
    if (typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype && typeof host.showPopover === "function") host.setAttribute("popover", "manual");
    shadow = host.attachShadow({mode: "open"});
    let styled = false;
    if (typeof CSSStyleSheet !== "undefined" && "adoptedStyleSheets" in shadow) {
      try {
        if (!adoptedSheet) { adoptedSheet = new CSSStyleSheet(); adoptedSheet.replaceSync(styleText); }
        shadow.adoptedStyleSheets = [adoptedSheet]; styled = true;
      } catch { /* Plain bundled styles remain available in older browsers. */ }
    }
    if (!styled) { const style = node("style"); style.textContent = styleText; shadow.append(style); }
    // Keep the original page selection while clicking controls.
    shadow.addEventListener("mousedown", event => { if (event.target.closest("button,a")) event.preventDefault(); });
    document.documentElement.append(host);
  }
  function replaceUI(element) {
    const focusResult = Boolean(shadow?.activeElement || current?.focusResult);
    ensureUI();
    for (const child of Array.from(shadow.children)) if (child.tagName !== "STYLE") child.remove();
    shadow.append(element);
    if (host.getAttribute("popover") === "manual" && !popoverOpen) {
      try { host.showPopover(); popoverOpen = true; }
      catch { host.removeAttribute("popover"); }
    }
    position();
    if (focusResult) { element.tabIndex = -1; element.focus?.({preventScroll: true}); }
  }
  function position() {
    if (!host || !current) return;
    const view = viewport();
    host.style.setProperty("--sd-viewport-width", view.width + "px", "important");
    host.style.setProperty("--sd-viewport-height", view.height + "px", "important");
    host.style.setProperty("--sd-room", Math.max(1, view.height - 24) + "px", "important");
    const bounds = host.getBoundingClientRect();
    const placed = S.placeBubble(current.rect, bounds, view);
    host.style.setProperty("--sd-room", placed.maxHeight + "px", "important");
    // Feed coordinates into the shadow rule without competing with its important inset reset.
    host.style.setProperty("--sd-left", placed.x + "px", "important");
    host.style.setProperty("--sd-top", placed.y + "px", "important");
  }
  function viewport() {
    const visual = window.visualViewport;
    const left = Number.isFinite(visual?.offsetLeft) ? visual.offsetLeft : 0;
    const top = Number.isFinite(visual?.offsetTop) ? visual.offsetTop : 0;
    const width = visual?.width > 0 ? visual.width : document.documentElement.clientWidth || window.innerWidth;
    const height = visual?.height > 0 ? visual.height : document.documentElement.clientHeight || window.innerHeight;
    return {left, top, width, height, right: left + width, bottom: top + height};
  }
  function button(label, className, action) {
    const element = node("button", className, label); element.type = "button";
    element.addEventListener("click", event => { event.preventDefault(); action(); });
    return element;
  }
  function layout(provider) {
    const card = node("section", "card" + (provider === "google" ? " google" : ""));
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", provider === "naver" ? "네이버 영어사전 검색 결과" : "Google 번역 결과");
    const header = node("header", "header");
    header.append(node("span", "badge", provider === "naver" ? "N" : "G"), node("span", "brand", provider === "naver" ? "네이버 영어사전" : "Google 번역"));
    const dismiss = button("×", "close", () => close(true)); dismiss.setAttribute("aria-label", "닫기"); dismiss.title = "닫기 (Esc)";
    header.append(dismiss);
    const body = node("div", "body"); body.setAttribute("aria-live", "polite"); body.setAttribute("aria-atomic", "true");
    card.append(header, body);
    return {card, body};
  }
  function appendFooter(card, provider, copyText, runtimeAvailable = true) {
    const footer = node("footer", "footer");
    const original = {text: current.text, provider};
    const link = node("a", "tool primary", provider === "naver" ? "네이버에서 열기 ↗" : "Google에서 열기 ↗");
    link.href = C.providerURL(provider, current.text, config.targetLanguage); link.target = "_blank"; link.rel = "noopener noreferrer";
    footer.append(link);
    if (runtimeAvailable) {
      footer.append(button("작은 창", "tool", () => openWindow(original)));
      const other = provider === "naver" ? "google" : "naver";
      footer.append(button(provider === "naver" ? "문장 번역" : "사전 찾기", "tool", () => lookup(other)));
    }
    if (copyText) {
      const copy = button("복사", "tool", async () => {
        try { await navigator.clipboard.writeText(copyText); copy.textContent = "복사됨"; }
        catch { copy.textContent = "직접 선택해 복사"; }
      });
      footer.append(copy);
    }
    if (runtimeAvailable) footer.append(button("설정", "tool wide", () => send({type: "OPEN_SETTINGS"})));
    card.append(footer, node("div", "hint", "Esc로 닫기 · 선택한 내용만 조회합니다"));
  }
  async function openWindow(snapshot) {
    const result = await send({type: "OPEN_PROVIDER", text: snapshot.text, provider: snapshot.provider});
    if (!result.ok && current && current.text === snapshot.text) showError(snapshot.provider, result.message, result.code, result);
    return result;
  }
  function showAsk() {
    const provider = current.route.provider;
    const ask = button("", "ask" + (provider === "google" ? " google" : ""), () => lookup(provider));
    ask.append(node("span", "badge", provider === "naver" ? "N" : "G"), node("span", "", provider === "naver" ? "사전 찾기" : "번역하기"));
    ask.title = provider === "naver" ? "네이버 영어사전에서 선택한 단어 찾기" : "Google 번역으로 선택한 문장 번역";
    replaceUI(ask);
  }
  function showError(provider, message, code = "", error = {}) {
    const {card, body} = layout(provider);
    body.append(node("div", "query" + (provider === "google" ? " sentence" : ""), current.text), node("div", "error", message));
    body.append(node("p", "note", "새 창은 자동으로 열지 않습니다." + (code ? " · 오류: " + code : "")));
    if (error.detail) {
      const details = node("details", "diagnostics");
      details.append(node("summary", "", "오류 상세"), node("p", "", error.detail)); body.append(details);
    }
    if (error.reloadRequired) {
      if (current.returnFocus?.isContentEditable || ["INPUT", "TEXTAREA"].includes(current.returnFocus?.tagName)) body.append(node("p", "note", "작성 중인 내용이 저장됐는지 확인한 후 새로고침해 주세요."));
      body.append(button("이 페이지 새로고침", "tool primary", () => window.location.reload()));
    } else body.append(button("다시 시도", "tool", () => lookup(provider)));
    appendFooter(card, provider, null, !error.reloadRequired); replaceUI(card);
  }
  function renderResult(result) {
    const {card, body} = layout(result.provider);
    let copyText;
    if (result.provider === "naver") {
      const copy = [];
      for (const entry of result.entries) {
        const block = node("article", "entry"); block.append(node("h3", "", entry.headword));
        if (entry.pronunciation) block.append(node("p", "phonetic", entry.pronunciation));
        copy.push(entry.headword);
        for (const meaning of entry.meanings) {
          const row = node("div", "meaning");
          if (meaning.partOfSpeech) row.append(node("span", "pos", meaning.partOfSpeech));
          row.append(node("span", "meaning-text", meaning.value)); block.append(row);
          copy.push((meaning.partOfSpeech ? "[" + meaning.partOfSpeech + "] " : "") + meaning.value);
        }
        block.append(node("p", "source", entry.source)); body.append(block);
      }
      if (result.summary) body.append(node("p", "note", "네이버 사전 요약입니다. 상세 조회 연결이 제한되어 요약 경로로 표시했습니다."));
      copyText = copy.join("\n");
    } else {
      body.append(node("div", "query sentence", current.text), node("p", "translation", result.translated), node("p", "note", "언어 자동 감지 → " + C.LANGUAGES[config.targetLanguage]));
      copyText = result.translated;
    }
    appendFooter(card, result.provider, copyText); replaceUI(card);
  }
  async function lookup(provider) {
    if (!current) return;
    const snapshot = {...current, provider: provider || current.route.provider};
    const id = ++requestId;
    const {card, body} = layout(snapshot.provider);
    body.setAttribute("aria-busy", "true");
    body.append(node("div", "query" + (snapshot.provider === "google" ? " sentence" : ""), snapshot.text));
    const status = node("div", "status"); status.append(node("span", "spinner"), node("span", "", "결과를 불러오는 중…"));
    body.append(status); replaceUI(card);
    const response = await send({type: "LOOKUP", text: snapshot.text, provider: snapshot.provider});
    if (id !== requestId || !current || snapshot.text !== current.text) return;
    if (response.ok && response.result) { renderResult(response.result); return; }
    showError(snapshot.provider, response.message || "결과를 불러오지 못했습니다.", response.code, response);
  }
  function deepestActiveElement() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }
  function elementFor(value) {
    return value?.nodeType === Node.ELEMENT_NODE ? value : value?.parentElement;
  }
  function sameSelection(left, right) {
    if (!left || !right || left.text !== right.text) return false;
    const a = left.identity, b = right.identity;
    if (!a || !b) return true;
    return a.anchor === b.anchor && a.anchorOffset === b.anchorOffset && a.focus === b.focus && a.focusOffset === b.focusOffset;
  }
  function isSensitive(element) {
    const selector = 'input[type="password"],input[autocomplete="current-password"],input[autocomplete="new-password"],input[autocomplete="one-time-code"]';
    return Boolean(element?.matches?.(selector) || element?.closest?.(selector));
  }
  function selectionRange(selection, active) {
    // getRangeAt can expose the shadow host's rectangle instead of the selected text.
    const roots = new Set();
    for (const value of [selection.anchorNode, selection.focusNode, active, selectionTarget]) {
      let root = value?.getRootNode?.();
      while (root?.host && root !== shadow) { roots.add(root); root = root.host.getRootNode?.(); }
    }
    if (roots.size && typeof selection.getComposedRanges === "function") {
      try {
        const [snapshot] = selection.getComposedRanges({shadowRoots: [...roots]});
        if (snapshot) {
          const range = document.createRange();
          range.setStart(snapshot.startContainer, snapshot.startOffset);
          range.setEnd(snapshot.endContainer, snapshot.endOffset);
          return range;
        }
      } catch { /* Older browsers can still supply an ordinary range or pointer anchor. */ }
    }
    try { return selection.rangeCount ? selection.getRangeAt(0) : null; } catch { return null; }
  }
  function selectionSnapshot(manual = false) {
    const active = deepestActiveElement();
    if (active?.tagName === "IFRAME") return null;
    if (isSensitive(active) || active?.getRootNode?.() === shadow) return null;
    const editable = active?.isContentEditable || ["INPUT", "TEXTAREA"].includes(active?.tagName);
    if (!manual && config.ignoreEditable && editable) return null;
    const view = viewport();
    let text = "", rect, identity;
    if (["INPUT", "TEXTAREA"].includes(active?.tagName)) {
      try {
        if (!Number.isInteger(active.selectionStart) || !Number.isInteger(active.selectionEnd) || active.selectionEnd <= active.selectionStart) return null;
        text = active.value.slice(active.selectionStart, active.selectionEnd);
        identity = {anchor: active, anchorOffset: active.selectionStart, focus: active, focusOffset: active.selectionEnd};
        rect = S.visibleRectangle(active.getBoundingClientRect(), view);
        if (rect && lastPointer && lastPointer.x >= rect.left && lastPointer.x <= rect.right && lastPointer.y >= rect.top && lastPointer.y <= rect.bottom) rect = S.fallbackAnchor(view, lastPointer);
      } catch { return null; }
    } else {
      let selection;
      try {
        const root = active?.getRootNode?.();
        selection = root !== shadow && root?.getSelection?.();
        if (!selection || selection.isCollapsed) selection = window.getSelection();
      } catch { return null; }
      if (!selection || selection.isCollapsed) return null;
      if (host?.contains(selection.anchorNode) || selection.anchorNode?.getRootNode() === shadow) return null;
      const anchor = elementFor(selection.anchorNode), focus = elementFor(selection.focusNode);
      if (isSensitive(anchor) || isSensitive(focus)) return null;
      if (!manual && config.ignoreEditable && [anchor, focus].some(element => element?.isContentEditable || element?.closest?.('[contenteditable]:not([contenteditable="false"]),input,textarea'))) return null;
      text = selection.toString();
      identity = {anchor: selection.anchorNode, anchorOffset: selection.anchorOffset, focus: selection.focusNode, focusOffset: selection.focusOffset};
      const range = selectionRange(selection, active);
      try {
        if (!text) text = range?.toString() || "";
        rect = S.anchorRectangle(Array.from(range?.getClientRects() || []), view, lastPointer, selection.direction === "backward");
        if (!rect) rect = S.visibleRectangle(range?.getBoundingClientRect?.(), view);
      } catch { /* An editor may replace the selected nodes during its pointer-up handler. */ }
      if (!rect && !S.visiblePoint(lastPointer, view)) {
        for (const element of [focus, anchor, active]) {
          if (!element || ["BODY", "HTML"].includes(element.tagName)) continue;
          try { rect = S.visibleRectangle(element.getBoundingClientRect(), view); } catch { /* Detached node. */ }
          if (rect) break;
        }
      }
    }
    text = C.normalizeText(text);
    if (!text) return null;
    return {text, rect: rect || S.fallbackAnchor(view, lastPointer), identity};
  }
  function capture(manual = false, forced = null) {
    if (!ready) return false;
    if (!manual && (!config.enabled || C.isExcluded(location.hostname, config.excludedDomains))) { close(); return false; }
    const snapshot = forced || selectionSnapshot(manual);
    if (!snapshot) { if (!manual) close(); return false; }
    if (!manual && sameSelection(snapshot, dismissedSelection)) return false;
    const route = C.classify(snapshot.text, config);
    if (!route.provider) { close(); return false; }
    if (!manual && current?.text === snapshot.text) { current.rect = snapshot.rect; position(); return true; }
    close();
    dismissedSelection = null;
    current = {...snapshot, route, focusResult: manual, returnFocus: deepestActiveElement()};
    if (manual || config.selectionMode === "auto") lookup(snapshot.provider || route.provider);
    else showAsk();
    return true;
  }
  function schedule(snapshot = selectionSnapshot()) {
    if (sameSelection(snapshot, dismissedSelection)) return;
    clearTimeout(timer);
    if (snapshot) pendingSnapshot = snapshot;
    timer = setTimeout(() => {
      const selected = selectionSnapshot() || pendingSnapshot;
      pendingSnapshot = null;
      if (!composing && !pointerSelecting && !keyboardSelecting) capture(false, selected);
    }, config.autoDelay);
  }
  function rememberPointer(event) {
    if ([event.clientX, event.clientY].every(Number.isFinite)) lastPointer = {x: event.clientX, y: event.clientY};
    selectionTarget = event.composedPath()[0];
  }
  document.addEventListener("pointerdown", event => {
    if (ownEvent(event) || event.button !== 0) return;
    pointerStart = {selection: selectionSnapshot(), x: event.clientX, y: event.clientY};
    if (current || pendingSnapshot) dismissedSelection = current || pendingSnapshot;
    close(); keyboardSelecting = false; pointerSelecting = true; rememberPointer(event);
  }, true);
  document.addEventListener("pointerup", event => {
    if (ownEvent(event) || event.button !== 0) return;
    const start = pointerStart; pointerStart = null;
    pointerSelecting = false; keyboardSelecting = false; rememberPointer(event);
    const selected = selectionSnapshot();
    if (sameSelection(selected, dismissedSelection)) {
      const changed = start && !sameSelection(start.selection, selected);
      const dragged = start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4;
      // The release that dismisses an existing bubble is not a new text selection.
      if (!changed && !dragged) return;
    }
    if (selected) { dismissedSelection = null; schedule(selected); }
  }, true);
  document.addEventListener("pointercancel", () => { pointerSelecting = false; pointerStart = null; close(); }, true);
  document.addEventListener("contextmenu", event => { if (!ownEvent(event)) rememberPointer(event); }, true);
  function selectionChanged(event) {
    if (ownEvent(event) || pointerSelecting || keyboardSelecting || composing || !ready) return;
    const selected = selectionSnapshot();
    if (selected && !sameSelection(selected, dismissedSelection)) schedule(selected);
  }
  document.addEventListener("selectionchange", selectionChanged, true);
  document.addEventListener("select", selectionChanged, true);
  function selectionKey(event) {
    return event.key === "Shift" || (event.shiftKey && /^(Arrow|Home|End|Page)/.test(event.key)) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a");
  }
  document.addEventListener("keyup", event => {
    if (ownEvent(event)) return;
    if (event.key === "Escape") { close(true); return; }
    if (selectionKey(event)) { keyboardSelecting = false; lastPointer = null; if (event.key !== "Shift") dismissedSelection = null; schedule(); }
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && (host || pendingSnapshot)) { close(true); event.stopPropagation(); return; }
    if (!ownEvent(event) && selectionKey(event)) { keyboardSelecting = true; lastPointer = null; if (event.key !== "Shift") dismissedSelection = null; clearTimeout(timer); }
  }, true);
  document.addEventListener("beforeinput", event => { if (!ownEvent(event)) close(); }, true);
  document.addEventListener("input", event => { if (!ownEvent(event)) close(); }, true);
  document.addEventListener("compositionstart", event => { if (!ownEvent(event)) { composing = true; close(); } }, true);
  document.addEventListener("compositionend", () => { composing = false; }, true);
  function reposition() {
    if (!current) return;
    const selected = selectionSnapshot(true);
    if (selected?.text === current.text) { current.rect = selected.rect; position(); } else close();
  }
  document.addEventListener("scroll", event => { if (host && !ownEvent(event)) reposition(); }, true);
  window.addEventListener("resize", reposition);
  window.addEventListener("blur", () => {
    if (pointerSelecting || keyboardSelecting) { pointerSelecting = false; keyboardSelecting = false; pointerStart = null; close(); }
  });
  window.visualViewport?.addEventListener("resize", reposition);
  window.visualViewport?.addEventListener("scroll", reposition);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) { config = C.sanitizeSettings(changes.settings.newValue); close(); }
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "SHOW_LOOKUP") {
      if (isSensitive(deepestActiveElement())) { respond({handled: true}); return; }
      const snapshot = selectionSnapshot(true);
      const handled = capture(true, {text: C.normalizeText(message.text), provider: message.provider, rect: snapshot?.rect || S.fallbackAnchor(viewport(), lastPointer)});
      respond({handled});
    } else if (message.type === "LOOKUP_SELECTION" && document.hasFocus()) {
      const snapshot = selectionSnapshot(true);
      if (snapshot) respond({handled: capture(true, snapshot)});
    }
  });
  (async () => {
    const response = await send({type: "GET_SETTINGS"});
    if (response.ok) config = C.sanitizeSettings(response.settings);
    ready = true;
  })();
})();

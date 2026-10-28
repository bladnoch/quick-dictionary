/* Bundled locally: no external fonts, styles or runtime libraries. */
globalThis.SelectDictBubbleStyles = `
  :host {
    all: initial !important;
    position: fixed !important; inset: auto !important; margin: 0 !important;
    left: var(--sd-left, 10px) !important; top: var(--sd-top, 10px) !important;
    transform: none !important; translate: none !important; rotate: none !important; scale: none !important;
    padding: 0 !important; border: 0 !important; background: transparent !important;
    display: block !important; visibility: visible !important; overflow: visible !important;
    inline-size: max-content !important; block-size: max-content !important;
    z-index: 2147483647 !important; color-scheme: light dark !important;
    font-family: system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif !important;
    font-size: medium !important; line-height: 1.6 !important;
    letter-spacing: normal !important; direction: ltr !important; text-align: start !important;
    --sd-surface: #fff; --sd-header: #f7faf8; --sd-text: #18342a;
    --sd-muted: #52665d; --sd-border: #d4e2da; --sd-accent: #0b6b46;
    --sd-soft: #edf7f1; --sd-on-accent: #fff; --sd-blue: #245cb4;
    --sd-blue-soft: #edf3ff; --sd-error-bg: #fff5e6; --sd-error: #7a430e;
    --sd-focus: #246cbe; --sd-shadow: 0 12px 40px #12312430;
  }
  * { box-sizing: border-box; }
  button, a { font: inherit; }
  button { cursor: pointer; }
  button:focus-visible, a:focus-visible, summary:focus-visible, .card:focus-visible {
    outline: 3px solid var(--sd-focus); outline-offset: 3px;
  }
  .ask {
    display: flex; align-items: center; gap: 9px; min-block-size: 42px;
    max-inline-size: calc(var(--sd-viewport-width, 100vw) - 24px); padding: 8px 12px;
    background: var(--sd-surface); color: var(--sd-text);
    border: 1px solid var(--sd-border); border-radius: 12px;
    box-shadow: var(--sd-shadow); font-size: .875em; white-space: nowrap;
  }
  .ask:hover, .tool:hover, .close:hover { background: var(--sd-soft); }
  .badge {
    display: inline-grid; place-items: center; inline-size: 25px; block-size: 25px;
    flex: 0 0 auto; border-radius: 7px; background: var(--sd-soft);
    color: var(--sd-accent); font-size: .8em; font-weight: 800;
  }
  .google .badge { color: var(--sd-blue); background: var(--sd-blue-soft); }
  .card {
    inline-size: min(390px, calc(var(--sd-viewport-width, 100vw) - 24px));
    max-block-size: min(560px, calc(var(--sd-viewport-height, 100vh) - 24px), var(--sd-room, 560px));
    overflow: auto; overscroll-behavior: contain;
    background: var(--sd-surface); color: var(--sd-text);
    border: 1px solid var(--sd-border); border-radius: 16px;
    box-shadow: var(--sd-shadow); font-size: .875em; line-height: 1.65;
  }
  .header {
    display: flex; align-items: center; gap: 9px; padding: 11px 14px;
    border-block-end: 1px solid var(--sd-border); background: var(--sd-header);
    position: sticky; inset-block-start: 0; z-index: 1;
  }
  .brand { flex: 1; font-size: .9em; font-weight: 700; }
  .close {
    min-inline-size: 32px; min-block-size: 32px; padding: 2px;
    border: 0; border-radius: 7px; background: transparent;
    color: var(--sd-muted); font-size: 23px; line-height: 1;
  }
  .body { padding: 16px 18px; }
  .query { margin: 0 0 10px; font-size: 1.35em; line-height: 1.45; font-weight: 700; overflow-wrap: anywhere; }
  .query.sentence {
    max-block-size: 110px; overflow: auto; padding-inline-start: 10px;
    border-inline-start: 2px solid var(--sd-border); color: var(--sd-muted);
    font-size: .95em; font-weight: 400;
  }
  .phonetic { margin: 0 0 9px; font-size: .9em; color: var(--sd-muted); }
  .entry + .entry { margin-block-start: 14px; padding-block-start: 14px; border-block-start: 1px solid var(--sd-border); }
  .entry h3 { margin: 0 0 8px; font-size: 1.15em; }
  .meaning { display: flex; align-items: flex-start; gap: 9px; margin: 7px 0; }
  .pos { padding: 2px 6px; margin-block-start: 1px; border-radius: 5px; background: var(--sd-soft); color: var(--sd-accent); font-size: .8em; white-space: nowrap; }
  .meaning-text { overflow-wrap: anywhere; }
  .source, .note, .hint { color: var(--sd-muted); font-size: .85em; }
  .source { margin: 10px 0 0; }
  .note { margin: 8px 0; overflow-wrap: anywhere; }
  .translation { margin: 12px 0; font-size: 1.15em; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
  .error { margin: 10px 0; padding: 12px; border-radius: 9px; background: var(--sd-error-bg); color: var(--sd-error); overflow-wrap: anywhere; }
  .diagnostics { margin: 10px 0; font-size: .85em; color: var(--sd-muted); }
  .diagnostics summary { cursor: pointer; min-block-size: 32px; }
  .diagnostics p { overflow-wrap: anywhere; white-space: pre-wrap; }
  .status { display: flex; align-items: center; gap: 10px; padding: 12px 0; color: var(--sd-muted); }
  .spinner { inline-size: 16px; block-size: 16px; flex: 0 0 auto; border: 2px solid var(--sd-border); border-block-start-color: var(--sd-accent); border-radius: 50%; animation: sd-spin .8s linear infinite; }
  @keyframes sd-spin { to { transform: rotate(360deg); } }
  .footer { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 12px 14px; border-block-start: 1px solid var(--sd-border); }
  .tool { display: inline-flex; align-items: center; justify-content: center; min-block-size: 32px; min-inline-size: 32px; padding: 5px 9px; border: 1px solid var(--sd-border); border-radius: 8px; background: var(--sd-surface); color: var(--sd-accent); text-decoration: none; font-size: .85em; line-height: 1.5; }
  .primary { background: var(--sd-accent); color: var(--sd-on-accent); border-color: var(--sd-accent); }
  .primary:hover { background: var(--sd-accent); filter: brightness(.92); }
  .wide { margin-inline-start: auto; }
  .hint { padding: 0 18px 11px; }
  @media (prefers-color-scheme: dark) {
    :host { --sd-surface: #17231d; --sd-header: #1d2c24; --sd-text: #eef5f0;
      --sd-muted: #b3c3ba; --sd-border: #40574a; --sd-accent: #98ddb6;
      --sd-soft: #273f31; --sd-on-accent: #10291c; --sd-blue: #b0ceff;
      --sd-blue-soft: #273953; --sd-error-bg: #3d3020; --sd-error: #ffdcaa;
      --sd-focus: #98bfff; --sd-shadow: 0 12px 40px #0006; }
  }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  @media (pointer: coarse) { .tool, .close { min-block-size: 44px; min-inline-size: 44px; } }
  @media (forced-colors: active) {
    .card, .ask, .header, .tool, .close { background: Canvas; color: CanvasText; border-color: CanvasText; box-shadow: none; }
    .pos, .badge { background: Canvas; color: CanvasText; border: 1px solid CanvasText; }
    .primary { background: Highlight; color: HighlightText; }
    button:focus-visible, a:focus-visible, summary:focus-visible, .card:focus-visible { outline-color: Highlight; }
  }
`;

/* Local extension messaging. No page bridge, network request, or automatic navigation. */
(function (root) {
  "use strict";
  const READ_ONLY = new Set(["GET_SETTINGS", "LOOKUP", "PING"]);
  const TRANSIENT = new Set(["NO_RECEIVER", "CHANNEL_CLOSED", "EMPTY_RESPONSE"]);
  function failure(error, contextMissing = false) {
    const detail = String(error?.message || error || "응답 없음").slice(0, 300);
    let code = "MESSAGE_REJECTED";
    if (contextMissing || /extension context invalidated|context has been invalidated/i.test(detail)) code = "CONTEXT_INVALIDATED";
    else if (/receiving end does not exist|could not establish connection/i.test(detail)) code = "NO_RECEIVER";
    else if (/message (?:port|channel).*closed|channel closed|channel is closed|listener indicated an asynchronous response/i.test(detail)) code = "CHANNEL_CLOSED";
    else if (detail === "EMPTY_RESPONSE") code = "EMPTY_RESPONSE";
    const reloadRequired = code === "CONTEXT_INVALIDATED";
    return {ok: false, connectionError: true, code, detail, reloadRequired,
      message: reloadRequired
        ? "이 페이지에서 사용하던 확장 프로그램 연결이 만료되었습니다. 확장이 켜져 있는지 확인한 뒤 이 페이지를 새로고침해 주세요."
        : "확장 프로그램이 정상적으로 응답하지 않았습니다. 확장 아이콘의 ‘연결 확인’에서 상태를 확인하거나 다시 시도해 주세요."};
  }
  function createClient(options = {}) {
    const getRuntime = options.getRuntime || (() => root.chrome?.runtime);
    const delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    function available() {
      try { const runtime = getRuntime(); return Boolean(runtime?.id && typeof runtime.sendMessage === "function"); } catch { return false; }
    }
    async function send(message) {
      const attempts = READ_ONLY.has(message.type) ? 2 : 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        let result;
        if (!available()) return failure("Extension context invalidated", true);
        try {
          const response = await getRuntime().sendMessage(message);
          if (response && typeof response === "object" && typeof response.ok === "boolean") return response;
          result = failure("EMPTY_RESPONSE");
        } catch (error) { result = failure(error, !available()); }
        if (attempt + 1 >= attempts || !TRANSIENT.has(result.code)) return result;
        // Retry only read-only requests. An explicit open must never create duplicate windows.
        await delay(150);
      }
    }
    return Object.freeze({send});
  }
  root.SelectDictMessaging = Object.freeze({createClient, failure});
})(globalThis);

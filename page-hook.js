(function () {
  const TARGET_FRAGMENT = "mwebapi.phtml?SERVER_GET_ENCOUNTERS";
  const EVENT_NAME = "bumble-encounters-response";

  const notify = (payload) => {
    window.dispatchEvent(
      new CustomEvent(EVENT_NAME, {
        detail: payload
      })
    );
  };

  const parseJsonText = (text) => {
    if (typeof text !== "string" || !text.trim()) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  };

  const handlePayload = (url, rawText) => {
    if (!url || !url.includes(TARGET_FRAGMENT)) {
      return;
    }

    const parsed = parseJsonText(rawText);
    if (!parsed) {
      return;
    }

    notify({
      url,
      payload: parsed,
      capturedAt: Date.now()
    });
  };

  const getRequestUrl = (input) => {
    if (typeof input === "string") {
      return input;
    }

    if (input && typeof input.url === "string") {
      return input.url;
    }

    return "";
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const url = getRequestUrl(args[0]);

      try {
        const cloned = response.clone();
        const text = await cloned.text();
        handlePayload(url, text);
      } catch (error) {
        // Ignore unreadable responses.
      }

      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__bumbleUrl = typeof url === "string" ? url : "";
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        handlePayload(this.__bumbleUrl, this.responseText);
      } catch (error) {
        // Ignore unreadable responses.
      }
    });

    return originalSend.apply(this, args);
  };
})();

(function () {
  "use strict";

  const ext = typeof browser !== "undefined" ? browser : chrome;

  const DEFAULT_CONFIG = { proxyBaseUrl: "http://127.0.0.1:8787", confidenceThreshold: 0.6 };
  const sessionStore = new Map();

  function clamp(value, min, max) {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return min;
    }
    return Math.max(min, Math.min(max, numeric));
  }

  function normalizeProxyBaseUrl(value) {
    const base = String(value || "").trim() || DEFAULT_CONFIG.proxyBaseUrl;
    return base.replace(/\/$/, "");
  }

  async function getConfig() {
    try {
      const s = await ext.storage.local.get("config");
      const raw = { ...DEFAULT_CONFIG, ...(s.config || {}) };
      return {
        proxyBaseUrl: normalizeProxyBaseUrl(raw.proxyBaseUrl),
        confidenceThreshold: clamp(raw.confidenceThreshold, 0.1, 1),
      };
    } catch { return DEFAULT_CONFIG; }
  }

  async function saveConfig(config) {
    const next = {
      proxyBaseUrl: normalizeProxyBaseUrl(config && config.proxyBaseUrl),
      confidenceThreshold: clamp(config && config.confidenceThreshold, 0.1, 1),
    };

    await ext.storage.local.set({ config: next });
    return next;
  }

  async function getActiveTab() {
    const tabs = await ext.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function callProxy(endpoint, payload, method = "POST") {
    const cfg = await getConfig();
    const requestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };

    if (method !== "GET") {
      requestInit.body = JSON.stringify(payload || {});
    }

    const res = await fetch(cfg.proxyBaseUrl + endpoint, requestInit);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  async function resolveFields(preScannedFields) {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("No tab");

    let scan;
    if (Array.isArray(preScannedFields)) {
      scan = { ok: true, fields: preScannedFields };
    } else {
      try { scan = await ext.tabs.sendMessage(tab.id, { type: "extractFields" }); }
      catch { throw new Error("Cannot scan page"); }
    }

    if (!scan?.ok || !scan.fields) throw new Error("No fields");

    const cfg = await getConfig();

    let result;
    try {
      result = await callProxy("/v1/resolve-form", {
        url: tab.url,
        fields: scan.fields,
        confidenceThreshold: clamp(cfg.confidenceThreshold, 0.1, 1),
      });
    } catch (e) {
      result = { suggestions: scan.fields.map((f) => ({ fieldId: f.id, value: null, confidence: 0 })) };
    }

    const session = { tabId: tab.id, fields: scan.fields, suggestions: result.suggestions || [] };
    sessionStore.set(tab.id, session);
    return session;
  }

  async function rememberAnswers(approvals) {
    const payload = {
      approvals: Array.isArray(approvals)
        ? approvals
            .map((entry) => ({
              fingerprint: String(entry && entry.fingerprint ? entry.fingerprint : "").trim(),
              value: entry ? entry.value : null,
            }))
            .filter((entry) => entry.fingerprint)
        : [],
    };

    if (!payload.approvals.length) {
      return { remembered: 0 };
    }

    const result = await callProxy("/remember", payload);
    return {
      remembered: Number(result && result.remembered ? result.remembered : 0),
      memorySize: Number(result && result.memorySize ? result.memorySize : 0),
    };
  }

  async function applyAll() {
    const tab = await getActiveTab();
    const session = sessionStore.get(tab?.id);
    if (!session) throw new Error("Run scan first");

    const items = session.suggestions
      .filter((s) => {
        if (!s || !s.suggested) return false;
        if (typeof s.value === "boolean") return true;
        if (typeof s.value === "number") return true;
        if (s.value === null || typeof s.value === "undefined") return false;
        return String(s.value).trim().length > 0;
      })
      .map((s) => ({ fieldId: s.fieldId, value: s.value }));

    if (!items.length) return { appliedCount: 0 };

    const res = await ext.tabs.sendMessage(tab.id, { type: "applyAll", items });
    return { appliedCount: res?.appliedCount || 0 };
  }

  // Message handler
  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "scanAndResolve") {
      resolveFields(msg.fields).then((s) => sendResponse({ ok: true, session: s }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    if (msg.type === "applyAll") {
      applyAll().then((r) => sendResponse({ ok: true, result: r }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    if (msg.type === "getConfig") {
      getConfig().then((c) => sendResponse({ ok: true, config: c }));
      return true;
    }

    if (msg.type === "saveConfig") {
      saveConfig(msg.config || {}).then((config) => sendResponse({ ok: true, config }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    if (msg.type === "reloadProfile") {
      callProxy("/reload-profile", {}).then((r) => sendResponse({ ok: true, payload: r }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    if (msg.type === "rememberAnswers") {
      rememberAnswers(msg.approvals).then((payload) => sendResponse({ ok: true, payload }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    if (msg.type === "proxyHealth") {
      callProxy("/health", null, "GET").then((r) => sendResponse({ ok: true, payload: r }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    return false;
  });

  // Toolbar click
  ext.action.onClicked.addListener((tab) => {
    if (tab?.id) ext.tabs.sendMessage(tab.id, { type: "showOverlay" }).catch(() => {});
  });

})();

(function () {
  "use strict";
  console.log("[JAP] Background loading...");

  const ext = typeof browser !== "undefined" ? browser : chrome;

  const DEFAULT_CONFIG = { proxyBaseUrl: "http://127.0.0.1:8787", confidenceThreshold: 0.6 };
  const sessionStore = new Map();

  async function getConfig() {
    try {
      const s = await ext.storage.local.get("config");
      return { ...DEFAULT_CONFIG, ...(s.config || {}) };
    } catch { return DEFAULT_CONFIG; }
  }

  async function getActiveTab() {
    const tabs = await ext.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function callProxy(endpoint, payload) {
    const cfg = await getConfig();
    const res = await fetch(cfg.proxyBaseUrl + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  async function resolveFields() {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("No tab");

    let scan;
    try { scan = await ext.tabs.sendMessage(tab.id, { type: "extractFields" }); }
    catch { throw new Error("Cannot scan page"); }

    if (!scan?.ok || !scan.fields) throw new Error("No fields");

    let result;
    try {
      result = await callProxy("/v1/resolve-form", {
        url: tab.url,
        fields: scan.fields,
        confidenceThreshold: 0.3,
      });
    } catch (e) {
      result = { suggestions: scan.fields.map(f => ({ fieldId: f.id, value: null, confidence: 0 })) };
    }

    const session = { tabId: tab.id, fields: scan.fields, suggestions: result.suggestions || [] };
    sessionStore.set(tab.id, session);
    return session;
  }

  async function applyAll() {
    const tab = await getActiveTab();
    const session = sessionStore.get(tab?.id);
    if (!session) throw new Error("Run scan first");

    const items = session.suggestions
      .filter(s => s.suggested && s.value)
      .map(s => ({ fieldId: s.fieldId, value: s.value }));

    if (!items.length) return { appliedCount: 0 };

    const res = await ext.tabs.sendMessage(tab.id, { type: "applyAll", items });
    return { appliedCount: res?.appliedCount || 0 };
  }

  // Message handler
  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("[JAP] Message:", msg.type);

    if (msg.type === "scanAndResolve") {
      resolveFields().then(s => sendResponse({ ok: true, session: s }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    if (msg.type === "applyAll") {
      applyAll().then(r => sendResponse({ ok: true, result: r }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    if (msg.type === "getConfig") {
      getConfig().then(c => sendResponse({ ok: true, config: c }));
      return true;
    }

    if (msg.type === "saveConfig") {
      ext.storage.local.set({ config: msg.config || {} }).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (msg.type === "proxyHealth") {
      callProxy("/health", {}).then(r => sendResponse({ ok: true, payload: r }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    return false;
  });

  // Toolbar click
  ext.action.onClicked.addListener((tab) => {
    if (tab?.id) ext.tabs.sendMessage(tab.id, { type: "showOverlay" }).catch(() => {});
  });

  console.log("[JAP] Ready");
})();
(function () {
  "use strict";

  const ext = typeof browser !== "undefined" ? browser : chrome;

  const elements = {
    proxyUrlInput: document.getElementById("proxyUrlInput"),
    confidenceInput: document.getElementById("confidenceInput"),
    saveBtn: document.getElementById("saveBtn"),
    healthBtn: document.getElementById("healthBtn"),
    reloadProfileBtn: document.getElementById("reloadProfileBtn"),
    statusOutput: document.getElementById("statusOutput"),
  };

  function clamp(value, min, max) {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return min;
    }
    return Math.max(min, Math.min(max, numeric));
  }

  function pretty(value) {
    return JSON.stringify(value, null, 2);
  }

  function summarizeHealth(payload) {
    if (!payload || typeof payload !== "object") {
      return payload;
    }

    const profile = payload.profile || {};
    const models = payload.models || {};

    return {
      ok: payload.ok,
      service: payload.service,
      host: payload.host,
      port: payload.port,
      profile: {
        loadedAt: profile.loadedAt,
        fileCount: profile.fileCount,
        chunkCount: profile.chunkCount,
        answerBankCount: profile.answerBankCount,
      },
      models: {
        preferred: models.preferred,
        catalogSize: models.catalogSize,
        warning: models.warning || null,
      },
      memorySize: payload.memorySize,
    };
  }

  function setStatus(value) {
    elements.statusOutput.textContent =
      typeof value === "string" ? value : pretty(value);
  }

  async function sendMessage(payload) {
    const response = await ext.runtime.sendMessage(payload);
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Unknown extension error");
    }
    return response;
  }

  async function loadConfig() {
    const response = await sendMessage({ type: "getConfig" });
    const config = response.config || {};

    elements.proxyUrlInput.value = config.proxyBaseUrl || "http://127.0.0.1:8787";
    elements.confidenceInput.value = String(
      clamp(config.confidenceThreshold, 0.1, 1),
    );
  }

  async function saveConfig() {
    const payload = {
      proxyBaseUrl: elements.proxyUrlInput.value,
      confidenceThreshold: clamp(elements.confidenceInput.value, 0.1, 1),
    };

    const response = await sendMessage({
      type: "saveConfig",
      config: payload,
    });

    setStatus({
      message: "Settings saved",
      config: response.config,
    });
  }

  async function checkHealth() {
    setStatus("Checking localhost proxy...");
    const response = await sendMessage({ type: "proxyHealth" });
    setStatus(summarizeHealth(response.payload || { ok: true }));
  }

  async function reloadProfile() {
    setStatus("Reloading profile files...");
    const response = await sendMessage({ type: "reloadProfile" });
    setStatus(response.payload || { ok: true });
  }

  function wireEvents() {
    elements.saveBtn.addEventListener("click", async () => {
      try {
        await saveConfig();
      } catch (error) {
        setStatus({ error: String(error.message || error) });
      }
    });

    elements.healthBtn.addEventListener("click", async () => {
      try {
        await checkHealth();
      } catch (error) {
        setStatus({ error: String(error.message || error) });
      }
    });

    elements.reloadProfileBtn.addEventListener("click", async () => {
      try {
        await reloadProfile();
      } catch (error) {
        setStatus({ error: String(error.message || error) });
      }
    });
  }

  async function boot() {
    wireEvents();

    try {
      await loadConfig();
      await checkHealth();
    } catch (error) {
      setStatus({ error: String(error.message || error) });
    }
  }

  boot();
})();

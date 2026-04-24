(function () {
  "use strict";

  if (window.top !== window.self) {
    return;
  }

  const ext = typeof browser !== "undefined" ? browser : chrome;

  const STATE = {
    booted: false,
    adapter: null,
    fieldRegistry: new Map(),
    lastFields: [],
    lastSuggestions: [],
  };

  const GREENHOUSE_ADAPTER = {
    id: "greenhouse",
    matches(hostname) {
      const value = normalizeText(hostname);
      return value.includes("greenhouse.io") || value.includes("boards.greenhouse.io");
    },
    collectCandidateElements() {
      const set = new Set();

      const add = (el) => {
        const normalized = normalizeCandidateElement(el);
        if (normalized) {
          set.add(normalized);
        }
      };

      queryAll('input:not([type="hidden"]), textarea, select').forEach(add);
      queryAll('[role="combobox"]').forEach(add);

      return Array.from(set);
    },
    getFileInput(kind) {
      const candidates = queryAll('input[type="file"]')
        .filter((entry) => entry instanceof HTMLInputElement);

      if (!candidates.length) {
        return null;
      }

      const keywords = kind === "resume" ? ["resume", "cv"] : ["cover", "letter"];

      let best = candidates[0];
      let bestScore = scoreFileInput(candidates[0], keywords);

      for (const candidate of candidates.slice(1)) {
        const score = scoreFileInput(candidate, keywords);
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }

      return best;
    },
  };

  const ADAPTERS = [GREENHOUSE_ADAPTER];

  function query(selector, root = document) {
    return root.querySelector(selector);
  }

  function queryAll(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function clamp(value, min, max) {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return min;
    }
    return Math.max(min, Math.min(max, numeric));
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
  }

  function toBoolean(value) {
    if (typeof value === "boolean") {
      return value;
    }

    const normalized = normalizeText(value);
    if (!normalized) {
      return null;
    }

    const truthy = new Set(["true", "yes", "1", "y", "checked", "confirm", "accept"]);
    const falsy = new Set(["false", "no", "0", "n", "unchecked"]);

    if (truthy.has(normalized)) {
      return true;
    }
    if (falsy.has(normalized)) {
      return false;
    }

    return null;
  }

  function isVisible(el) {
    if (!(el instanceof Element)) {
      return false;
    }

    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      if (Number(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function nodeText(node) {
    return cleanText(node && node.textContent ? node.textContent : "");
  }

  function normalizeCandidateElement(el) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      return el;
    }

    if (el instanceof HTMLElement) {
      const nested = el.querySelector("input, textarea, select");
      if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement || nested instanceof HTMLSelectElement) {
        return nested;
      }
    }

    return null;
  }

  function isComboboxElement(el) {
    if (!(el instanceof HTMLElement)) {
      return false;
    }

    const role = normalizeText(el.getAttribute("role"));
    if (role === "combobox") {
      return true;
    }

    const className = normalizeText(el.className || "");
    if (className.includes("react-select") || className.includes("select__input")) {
      return true;
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const ariaAutoComplete = normalizeText(el.getAttribute("aria-autocomplete"));
      if (ariaAutoComplete === "list") {
        return true;
      }
    }

    return false;
  }

  function getLabelByFor(el) {
    const id = String(el.getAttribute("id") || "").trim();
    if (!id) {
      return "";
    }

    return nodeText(query(`label[for="${cssEscape(id)}"]`));
  }

  function getLabelByAria(el) {
    const ariaLabel = cleanText(el.getAttribute("aria-label"));
    if (ariaLabel) {
      return ariaLabel;
    }

    const ids = String(el.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (!ids.length) {
      return "";
    }

    return cleanText(
      ids
        .map((id) => nodeText(document.getElementById(id)))
        .filter(Boolean)
        .join(" "),
    );
  }

  function getLabelByContainer(el) {
    let parent = el.parentElement;
    let depth = 0;

    while (parent && depth < 6) {
      const label =
        parent.querySelector("label") ||
        parent.querySelector(".label") ||
        parent.querySelector("[class*='upload-label']") ||
        parent.querySelector("[data-testid*='label']");

      const text = nodeText(label);
      if (text) {
        return text;
      }

      parent = parent.parentElement;
      depth += 1;
    }

    return "";
  }

  function getFieldLabel(el) {
    const fieldset = el.closest("fieldset");
    const legendText = fieldset ? nodeText(fieldset.querySelector("legend")) : "";

    const candidates = [
      getLabelByFor(el),
      getLabelByAria(el),
      legendText,
      getLabelByContainer(el),
      cleanText(el.getAttribute("placeholder")),
      cleanText(el.getAttribute("name")),
      cleanText(el.getAttribute("id")),
    ];

    return candidates.find(Boolean) || "";
  }

  function getFieldDescription(el) {
    const describedBy = String(el.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (!describedBy.length) {
      return "";
    }

    return cleanText(
      describedBy
        .map((id) => nodeText(document.getElementById(id)))
        .filter(Boolean)
        .join(" "),
    );
  }

  function getAssociatedLabel(input) {
    if (!(input instanceof HTMLInputElement)) {
      return "";
    }
    return getLabelByFor(input) || getLabelByContainer(input);
  }

  function scoreFileInput(input, keywords) {
    const key = normalizeText(`${input.id} ${input.name} ${getAssociatedLabel(input)}`);
    let score = 0;

    for (const keyword of keywords) {
      if (key.includes(keyword)) {
        score += 2;
      }
    }

    if (isVisible(input)) {
      score += 1;
    }
    if (input.classList.contains("visually-hidden")) {
      score += 1;
    }

    return score;
  }

  function shouldIncludeFileInput(input) {
    if (!(input instanceof HTMLInputElement)) {
      return false;
    }

    if (isVisible(input)) {
      return true;
    }

    if (input.classList.contains("visually-hidden")) {
      return true;
    }

    if (getAssociatedLabel(input)) {
      return true;
    }

    let parent = input.parentElement;
    let depth = 0;

    while (parent && depth < 4) {
      if (normalizeText(parent.className).includes("file-upload")) {
        return true;
      }
      parent = parent.parentElement;
      depth += 1;
    }

    return false;
  }

  function fieldTypeForElement(el) {
    if (el instanceof HTMLSelectElement) {
      return "select";
    }
    if (el instanceof HTMLTextAreaElement) {
      return "textarea";
    }

    if (el instanceof HTMLInputElement) {
      const type = normalizeText(el.type || "text");
      if (!type) {
        return "text";
      }
      if (type === "select-one" || type === "select-multiple") {
        return "select";
      }
      if (isComboboxElement(el)) {
        return "select";
      }
      return type;
    }

    if (isComboboxElement(el)) {
      return "select";
    }

    return "text";
  }

  function parseFieldId(fieldId) {
    if (typeof fieldId !== "string") {
      return { kind: "unknown", value: "" };
    }

    if (fieldId.startsWith("id:")) {
      return { kind: "id", value: fieldId.slice(3) };
    }
    if (fieldId.startsWith("name:")) {
      return { kind: "name", value: fieldId.slice(5) };
    }
    if (fieldId.startsWith("radio:")) {
      return { kind: "radio", value: fieldId.slice(6) };
    }

    return { kind: "unknown", value: fieldId };
  }

  function extractSelectOptions(selectElement) {
    if (!(selectElement instanceof HTMLSelectElement)) {
      return [];
    }

    return Array.from(selectElement.options)
      .map((option) => {
        const label = cleanText(option.textContent || option.label || option.value);
        const value = String(option.value || label).trim();
        return { label, value };
      })
      .filter((option) => option.label || option.value);
  }

  function extractRadioOptions(name) {
    if (!name) {
      return [];
    }

    const radios = queryAll(`input[type="radio"][name="${cssEscape(name)}"]`);
    return radios
      .map((radio) => {
        if (!(radio instanceof HTMLInputElement)) {
          return null;
        }
        const label = cleanText(getAssociatedLabel(radio) || radio.value);
        const value = String(radio.value || label).trim();
        return { label, value };
      })
      .filter(Boolean);
  }

  function createFieldId(meta, index) {
    if (meta.type === "radio" && meta.name) {
      return `radio:${meta.name}`;
    }
    if (meta.idAttr) {
      return `id:${meta.idAttr}`;
    }
    if (meta.name) {
      return `name:${meta.name}`;
    }
    return `field:${index}`;
  }

  function getActiveAdapter() {
    if (STATE.adapter && STATE.adapter.matches(window.location.hostname)) {
      return STATE.adapter;
    }

    STATE.adapter = ADAPTERS.find((adapter) => adapter.matches(window.location.hostname)) || null;
    return STATE.adapter;
  }

  function extractFields() {
    const adapter = getActiveAdapter();
    if (!adapter) {
      return [];
    }

    STATE.fieldRegistry.clear();

    const fields = [];
    const seenIds = new Set();
    const seenRadioGroups = new Set();
    const candidates = adapter.collectCandidateElements();

    for (let index = 0; index < candidates.length; index += 1) {
      const el = candidates[index];
      const type = fieldTypeForElement(el);
      const isFile = type === "file";

      if (el.disabled) {
        continue;
      }

      if (!isFile && "readOnly" in el && el.readOnly) {
        continue;
      }

      if (!isFile && !isVisible(el)) {
        continue;
      }

      if (isFile && !shouldIncludeFileInput(el)) {
        continue;
      }

      const idAttr = String(el.getAttribute("id") || "").trim();
      const name = String(el.getAttribute("name") || "").trim();

      if (type === "radio" && name) {
        if (seenRadioGroups.has(name)) {
          continue;
        }
        seenRadioGroups.add(name);
      }

      const fieldId = createFieldId({ type, idAttr, name }, index);
      if (seenIds.has(fieldId)) {
        continue;
      }
      seenIds.add(fieldId);

      let label = getFieldLabel(el);
      const labelKey = normalizeText(`${idAttr} ${name} ${label}`);
      if (isFile) {
        if (labelKey.includes("resume") || labelKey.includes("cv")) {
          label = "Resume/CV";
        } else if (labelKey.includes("cover")) {
          label = "Cover Letter";
        } else if (!label) {
          label = "File Upload";
        }
      }

      const options = type === "select" && el instanceof HTMLSelectElement
        ? extractSelectOptions(el)
        : type === "radio"
          ? extractRadioOptions(name)
          : [];

      const field = {
        id: fieldId,
        name,
        label,
        type,
        required: Boolean(el.required || el.getAttribute("aria-required") === "true"),
        options,
        placeholder: cleanText(el.getAttribute("placeholder")),
        description: getFieldDescription(el),
        isFile,
      };

      fields.push(field);
      STATE.fieldRegistry.set(fieldId, {
        id: fieldId,
        idAttr,
        name,
        label,
        type,
        isFile,
      });
    }

    STATE.lastFields = fields;
    return fields;
  }

  function firstVisible(elements) {
    for (const el of elements) {
      if (el instanceof HTMLElement && isVisible(el)) {
        return el;
      }
    }

    for (const el of elements) {
      if (el instanceof HTMLElement) {
        return el;
      }
    }

    return null;
  }

  function findFieldByLabel(labelText, expectedTag) {
    if (!labelText) {
      return null;
    }

    const target = normalizeText(labelText);
    if (!target) {
      return null;
    }

    const labels = queryAll("label");
    for (const label of labels) {
      const text = normalizeText(nodeText(label));
      if (!text) {
        continue;
      }

      if (!text.includes(target) && !target.includes(text)) {
        continue;
      }

      const htmlFor = label.getAttribute("for");
      if (htmlFor) {
        const direct = normalizeCandidateElement(document.getElementById(htmlFor));
        if (direct && (!expectedTag || direct.tagName.toLowerCase() === expectedTag)) {
          return direct;
        }
      }

      const nested = normalizeCandidateElement(label);
      if (nested && (!expectedTag || nested.tagName.toLowerCase() === expectedTag)) {
        return nested;
      }

      const sibling = normalizeCandidateElement(label.nextElementSibling);
      if (sibling && (!expectedTag || sibling.tagName.toLowerCase() === expectedTag)) {
        return sibling;
      }
    }

    return null;
  }

  function findElementForField(fieldId) {
    const parsed = parseFieldId(fieldId);
    const meta = STATE.fieldRegistry.get(fieldId);

    if (parsed.kind === "id" && parsed.value) {
      const byId = normalizeCandidateElement(document.getElementById(parsed.value));
      if (byId) {
        return byId;
      }
    }

    if (parsed.kind === "name" && parsed.value) {
      const byName = firstVisible(Array.from(document.getElementsByName(parsed.value)));
      const normalized = normalizeCandidateElement(byName);
      if (normalized) {
        return normalized;
      }
    }

    if (!meta) {
      return null;
    }

    if (meta.idAttr) {
      const byMetaId = normalizeCandidateElement(document.getElementById(meta.idAttr));
      if (byMetaId) {
        return byMetaId;
      }
    }

    if (meta.name) {
      const byMetaName = firstVisible(Array.from(document.getElementsByName(meta.name)));
      const normalized = normalizeCandidateElement(byMetaName);
      if (normalized) {
        return normalized;
      }
    }

    const expectedTag = meta.type === "textarea" ? "textarea" : meta.type === "select" ? "select" : undefined;
    return findFieldByLabel(meta.label, expectedTag);
  }

  function setNativeValue(el, value) {
    if (el instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(el, value);
      } else {
        el.value = value;
      }
      return;
    }

    if (el instanceof HTMLTextAreaElement) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(el, value);
      } else {
        el.value = value;
      }
      return;
    }

    if (el instanceof HTMLSelectElement) {
      el.value = value;
    }
  }

  function dispatchInputEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function fillSelect(selectElement, value) {
    if (!(selectElement instanceof HTMLSelectElement)) {
      return false;
    }

    const target = normalizeText(value);
    if (!target) {
      return false;
    }

    let matched = null;

    for (const option of Array.from(selectElement.options)) {
      if (normalizeText(option.value) === target) {
        matched = option;
        break;
      }
    }

    if (!matched) {
      for (const option of Array.from(selectElement.options)) {
        const label = normalizeText(option.textContent || option.label || "");
        if (label === target || label.includes(target) || target.includes(label)) {
          matched = option;
          break;
        }
      }
    }

    if (!matched) {
      return false;
    }

    selectElement.value = matched.value;
    dispatchInputEvents(selectElement);
    return true;
  }

  function fillRadioGroup(groupName, value) {
    if (!groupName) {
      return false;
    }

    const radios = queryAll(`input[type="radio"][name="${cssEscape(groupName)}"]`)
      .filter((entry) => entry instanceof HTMLInputElement);

    if (!radios.length) {
      return false;
    }

    const target = normalizeText(value);
    let matched = null;

    for (const radio of radios) {
      if (normalizeText(radio.value) === target) {
        matched = radio;
        break;
      }
    }

    if (!matched) {
      for (const radio of radios) {
        const label = normalizeText(getAssociatedLabel(radio));
        if (label && (label.includes(target) || target.includes(label))) {
          matched = radio;
          break;
        }
      }
    }

    if (!matched) {
      return false;
    }

    matched.checked = true;
    dispatchInputEvents(matched);
    return true;
  }

  function fillCombobox(el, value) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      return false;
    }

    const text = String(value || "").trim();
    if (!text) {
      return false;
    }

    el.focus();
    el.click();
    setNativeValue(el, text);
    dispatchInputEvents(el);
    el.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
    }));

    return true;
  }

  function applyItem(item, allowRescan = true) {
    if (!item || !item.fieldId) {
      return false;
    }

    const fieldId = String(item.fieldId);
    const parsed = parseFieldId(fieldId);
    const meta = STATE.fieldRegistry.get(fieldId);

    if (meta && meta.isFile) {
      return false;
    }

    if (parsed.kind === "radio" || (meta && meta.type === "radio")) {
      const groupName = parsed.kind === "radio" ? parsed.value : meta.name;
      return fillRadioGroup(groupName, item.value);
    }

    let element = findElementForField(fieldId);
    if (!element && allowRescan) {
      extractFields();
      element = findElementForField(fieldId);
    }

    if (!element) {
      return false;
    }

    const fieldType = meta ? meta.type : fieldTypeForElement(element);

    if (fieldType === "checkbox" && element instanceof HTMLInputElement) {
      const boolValue = toBoolean(item.value);
      if (boolValue === null) {
        return false;
      }
      element.checked = boolValue;
      dispatchInputEvents(element);
      return true;
    }

    if (fieldType === "select") {
      if (element instanceof HTMLSelectElement) {
        return fillSelect(element, item.value);
      }
      return fillCombobox(element, item.value);
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      setNativeValue(element, item.value == null ? "" : String(item.value));
      dispatchInputEvents(element);
      return true;
    }

    return false;
  }

  function applyBatch(items) {
    let appliedCount = 0;
    let skippedCount = 0;

    items.forEach((item) => {
      if (applyItem(item)) {
        appliedCount += 1;
      } else {
        skippedCount += 1;
      }
    });

    return { appliedCount, skippedCount };
  }

  function setStatus(text) {
    const statusNode = query("#jap-status");
    if (statusNode) {
      statusNode.textContent = String(text || "");
    }
  }

  function suggestionValueToText(value) {
    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }
    if (value === null || typeof value === "undefined") {
      return "";
    }
    return String(value);
  }

  function renderFields(fields, suggestions) {
    const container = query("#jap-fields");
    if (!container) {
      return;
    }

    container.innerHTML = "";

    if (!fields.length) {
      const empty = document.createElement("div");
      empty.className = "jap-empty";
      empty.textContent = "No fillable fields found on this page.";
      container.appendChild(empty);
      return;
    }

    const suggestionMap = new Map();
    (suggestions || []).forEach((entry) => {
      if (entry && entry.fieldId) {
        suggestionMap.set(entry.fieldId, entry);
      }
    });

    for (const field of fields) {
      if (field.isFile) {
        continue;
      }

      const suggestion = suggestionMap.get(field.id) || null;
      const row = document.createElement("div");
      row.className = "jap-field";

      const labelNode = document.createElement("div");
      labelNode.className = "jap-field-label";

      const confidenceText = suggestion && typeof suggestion.confidence === "number"
        ? ` (${Math.round(clamp(suggestion.confidence, 0, 1) * 100)}%)`
        : "";

      labelNode.textContent = `${field.label || field.id}${field.required ? " *" : ""}${confidenceText}`;

      const input = document.createElement("input");
      input.className = "jap-field-input";
      input.dataset.id = field.id;
      input.value = suggestionValueToText(suggestion && suggestion.value);

      const reasonNode = document.createElement("div");
      reasonNode.className = "jap-field-reason";
      reasonNode.textContent = suggestion && suggestion.reason
        ? String(suggestion.reason)
        : "No model reason available.";

      row.appendChild(labelNode);
      row.appendChild(input);
      row.appendChild(reasonNode);
      container.appendChild(row);
    }
  }

  function showOverlay() {
    if (!getActiveAdapter()) {
      return null;
    }

    let overlay = query("#jap-overlay");
    if (overlay) {
      overlay.classList.remove("hidden");
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = "jap-overlay";
    overlay.className = "jap-overlay";
    overlay.innerHTML = [
      '<div class="jap-header">',
      '  <span class="jap-title">Job Autofill Pro</span>',
      '  <div class="jap-btns">',
      '    <button id="jap-scan" class="jap-btn jap-btn-primary">Scan</button>',
      '    <button id="jap-fill" class="jap-btn jap-btn-success">Apply</button>',
      '    <button id="jap-resume" class="jap-btn jap-btn-resume">Resume</button>',
      '    <button id="jap-cover" class="jap-btn jap-btn-resume">Cover</button>',
      '    <button id="jap-close" class="jap-btn jap-btn-ghost">✕</button>',
      "  </div>",
      "</div>",
      '<div class="jap-body">',
      '  <div id="jap-status" class="jap-status">Click Scan to fetch suggestions.</div>',
      '  <div id="jap-fields" class="jap-fields"></div>',
      "</div>",
    ].join("\n");

    document.body.appendChild(overlay);

    query("#jap-scan", overlay).onclick = runScan;
    query("#jap-fill", overlay).onclick = runApply;
    query("#jap-resume", overlay).onclick = () => triggerFilePicker("resume");
    query("#jap-cover", overlay).onclick = () => triggerFilePicker("cover");
    query("#jap-close", overlay).onclick = () => overlay.classList.add("hidden");

    return overlay;
  }

  async function runScan() {
    if (!getActiveAdapter()) {
      setStatus("This page is not a supported Greenhouse application form.");
      return;
    }

    setStatus("Scanning fields and requesting suggestions...");

    try {
      const fields = extractFields();
      if (!fields.length) {
        renderFields([], []);
        setStatus("No fillable fields detected.");
        return;
      }

      const response = await ext.runtime.sendMessage({ type: "scanAndResolve", fields });
      if (!response || !response.ok) {
        renderFields(fields, []);
        setStatus(`Proxy error: ${(response && response.error) || "unknown error"}`);
        return;
      }

      const suggestions = response.session && Array.isArray(response.session.suggestions)
        ? response.session.suggestions
        : [];

      STATE.lastSuggestions = suggestions;
      renderFields(fields, suggestions);

      const suggestedCount = suggestions.filter((entry) => entry && entry.suggested).length;
      setStatus(`Found ${fields.length} fields. Suggested ${suggestedCount}. Review and click Apply.`);
    } catch (error) {
      renderFields(extractFields(), []);
      setStatus(`Scan failed: ${error && error.message ? error.message : String(error)}`);
    }
  }

  function collectOverlayItems() {
    const container = query("#jap-fields");
    if (!container) {
      return [];
    }

    const items = [];
    queryAll(".jap-field-input", container).forEach((entry) => {
      if (!(entry instanceof HTMLInputElement)) {
        return;
      }

      const fieldId = String(entry.dataset.id || "").trim();
      if (!fieldId) {
        return;
      }

      const value = String(entry.value || "").trim();
      if (!value) {
        return;
      }

      items.push({ fieldId, value });
    });

    return items;
  }

  function buildApprovalPayload(items) {
    const suggestionMap = new Map();
    STATE.lastSuggestions.forEach((entry) => {
      if (entry && entry.fieldId && entry.fingerprint) {
        suggestionMap.set(entry.fieldId, entry);
      }
    });

    const approvals = [];
    for (const item of items) {
      const suggestion = suggestionMap.get(item.fieldId);
      if (!suggestion || !suggestion.fingerprint) {
        continue;
      }

      approvals.push({
        fingerprint: suggestion.fingerprint,
        value: item.value,
      });
    }

    return approvals;
  }

  async function runApply() {
    const items = collectOverlayItems();
    if (!items.length) {
      setStatus("No values to apply.");
      return;
    }

    const result = applyBatch(items);
    setStatus(`Applied ${result.appliedCount} fields. Skipped ${result.skippedCount}.`);

    const approvals = buildApprovalPayload(items);
    if (approvals.length) {
      ext.runtime.sendMessage({ type: "rememberAnswers", approvals }).catch(() => {});
    }
  }

  function triggerFilePicker(kind) {
    const adapter = getActiveAdapter();
    if (!adapter) {
      setStatus("Unsupported page.");
      return;
    }

    const input = adapter.getFileInput(kind);
    if (!input) {
      setStatus(`No ${kind} upload field found.`);
      return;
    }

    const label = input.id ? query(`label[for="${cssEscape(input.id)}"]`) : null;
    if (label instanceof HTMLElement) {
      label.click();
    } else {
      input.click();
    }

    setStatus(`Select your ${kind} file from the file picker.`);
  }

  function boot() {
    if (STATE.booted) {
      return;
    }
    STATE.booted = true;

    if (!getActiveAdapter()) {
      return;
    }

    showOverlay();
    setTimeout(runScan, 450);
  }

  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "extractFields") {
      sendResponse({ ok: true, fields: getActiveAdapter() ? extractFields() : [] });
      return true;
    }

    if (msg.type === "applyAll" && Array.isArray(msg.items)) {
      sendResponse({ ok: true, ...applyBatch(msg.items) });
      return true;
    }

    if (msg.type === "showOverlay" || msg.type === "toggleOverlay") {
      if (!getActiveAdapter()) {
        sendResponse({ ok: false, error: "Unsupported page." });
        return true;
      }
      showOverlay();
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  boot();
})();

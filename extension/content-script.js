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
    alreadyApplied: null,
    lastScanUrl: "",
    bypassDuplicateCheckOnce: false,
    isBusy: false,
    pendingRecord: null,
    recordingInFlight: false,
    recordHooksAttached: false,
  };

  const APPLICATION_CONTEXT_HINTS = {
    titleSelectors: [
      "meta[property='og:title']",
      "meta[name='twitter:title']",
      "h1",
      "[data-qa='job-title']",
      "[data-automation-id='jobPostingHeader']",
      "[class*='job-title']",
      "[class*='posting-title']",
    ],
    companySelectors: [
      "meta[property='og:site_name']",
      "[data-qa='company-name']",
      "[class*='company']",
      "[class*='employer']",
    ],
  };

  const LEVER_ADAPTER = {
    id: "lever",
    matches(hostname) {
      const value = normalizeText(hostname);
      return hostIs(value, "lever.co");
    },
    collectCandidateElements() {
      const set = new Set();

      const add = (el) => {
        const normalized = normalizeCandidateElement(el);
        if (normalized) {
          set.add(normalized);
        }
      };

      queryAll('input:not([type="hidden"]):not([type="file"]), textarea, select').forEach(add);
      queryAll('[role="combobox"]').forEach(add);
      queryAll('.form-input, .input').forEach(add);
      queryAll('input[type="radio"]').forEach(add);

      return Array.from(set);
    },
  };

  const GREENHOUSE_ADAPTER = {
    id: "greenhouse",
    matches(hostname) {
      const value = normalizeText(hostname);
      return hostIs(value, "greenhouse.io");
    },
    collectCandidateElements() {
      const set = new Set();

      const add = (el) => {
        const normalized = normalizeCandidateElement(el);
        if (normalized) {
          set.add(normalized);
        }
      };

      queryAll('input:not([type="hidden"]):not([type="file"]), textarea, select').forEach(add);
      queryAll('[role="combobox"]').forEach(add);
      queryAll('.gh-select, .select-container input').forEach(add);
      queryAll('input[type="radio"]').forEach(add);

      return Array.from(set);
    },
  };

  const ASHBY_ADAPTER = {
    id: "ashby",
    matches(hostname) {
      const value = normalizeText(hostname);
      return hostIs(value, "ashbyhq.com");
    },
    collectCandidateElements() {
      const set = new Set();

      const add = (el) => {
        const normalized = normalizeCandidateElement(el);
        if (normalized) {
          set.add(normalized);
        }
      };

      queryAll('input:not([type="hidden"]):not([type="file"]), textarea, select').forEach(add);
      queryAll('[role="combobox"]').forEach(add);
      queryAll('[class*="select-shell"], [class*="ashby-select"]').forEach(add);
      queryAll('input[type="radio"]').forEach(add);

      return Array.from(set);
    },
  };

  const WORKDAY_ADAPTER = {
    id: "workday",
    matches(hostname) {
      const value = normalizeText(hostname);
      return (
        hostIs(value, "myworkday.com") ||
        hostIs(value, "myworkdayjobs.com") ||
        hostIs(value, "workday.com")
      );
    },
    collectCandidateElements() {
      const set = new Set();
      const candidates = queryAll('input:not([type="hidden"]):not([type="file"]), textarea, select, [data-automation-id*="text"], [data-automation-id="promptInput"], [data-automation-id^="input_"]');

      candidates.forEach((el) => {
        if (!(el instanceof HTMLElement) || !isVisible(el)) {
          return;
        }

        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          set.add(el);
          return;
        }

        const nested = findWorkdayInput(el);
        if (nested) {
          set.add(nested);
        }
      });

      return Array.from(set);
    },
  };

  const ADAPTERS = [GREENHOUSE_ADAPTER, LEVER_ADAPTER, ASHBY_ADAPTER, WORKDAY_ADAPTER];

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

  function normalizedHostname() {
    return normalizeText(String(window.location.hostname || "").replace(/^www\./, ""));
  }

  function hostIs(hostname, suffix) {
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeContextText(value) {
    return cleanText(value)
      .replace(/\s*[\|\-\u2013\u2014]\s*.*$/, "")
      .replace(/^apply\s+(for\s+)?/i, "")
      .trim();
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

  function hasMeaningfulValue(value) {
    if (typeof value === "boolean") {
      return true;
    }
    if (typeof value === "number") {
      return Number.isFinite(value);
    }
    if (value === null || typeof value === "undefined") {
      return false;
    }
    return String(value).trim().length > 0;
  }

  function tokenSet(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return new Set();
    }

    return new Set(normalized.split(" ").filter(Boolean));
  }

  function labelsEquivalent(left, right) {
    const leftText = normalizeText(left);
    const rightText = normalizeText(right);

    if (!leftText || !rightText) {
      return false;
    }

    if (leftText === rightText) {
      return true;
    }

    if (
      leftText.length >= 10 &&
      rightText.length >= 10 &&
      (leftText.includes(rightText) || rightText.includes(leftText))
    ) {
      return true;
    }

    const leftTokens = tokenSet(leftText);
    const rightTokens = tokenSet(rightText);
    if (!leftTokens.size || !rightTokens.size) {
      return false;
    }

    let overlap = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) {
        overlap += 1;
      }
    }

    return overlap / Math.max(leftTokens.size, rightTokens.size) >= 0.75;
  }

  function compactIdSegment(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);
  }

  function elementContextSignature(el) {
    if (!(el instanceof HTMLElement)) {
      return "";
    }

    const parts = [];
    let node = el;
    let depth = 0;

    while (node && depth < 4) {
      const tag = String(node.tagName || "").toLowerCase();
      if (!tag) {
        break;
      }

      const idPart = compactIdSegment(node.id || "");
      const namePart = compactIdSegment(node.getAttribute("name") || "");
      const testIdPart = compactIdSegment(node.getAttribute("data-testid") || "");
      const classPart = compactIdSegment(
        String(node.className || "")
          .split(/\s+/)
          .slice(0, 2)
          .join("_"),
      );

      parts.push([tag, idPart, namePart, testIdPart, classPart].filter(Boolean).join("-"));

      if (tag === "form" || idPart) {
        break;
      }

      node = node.parentElement;
      depth += 1;
    }

    return parts.join("__");
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
    
    const parentLabel = el.closest("label");
    if (parentLabel) {
      const text = nodeText(parentLabel);
      if (text) return text;
    }

    
    let sibling = el.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === "LABEL" || sibling.classList.contains("label")) {
        const text = nodeText(sibling);
        if (text) return text;
      }
      sibling = sibling.previousElementSibling;
    }

    
    let parent = el.parentElement;
    let depth = 0;
    while (parent && depth < 3) { 
      const label = parent.querySelector(`label, .label, [data-testid*="label"]`);
      if (label && (label.contains(el) || label.nextElementSibling === el || el.previousElementSibling === label)) {
        const text = nodeText(label);
        if (text) return text;
      }
      parent = parent.parentElement;
      depth += 1;
    }

    return "";
  }

  function getLabelByProximity(el) {
    
    let sibling = el.previousElementSibling;
    let depth = 0;
    while (sibling && depth < 5) {
      const text = nodeText(sibling);
      if (text && text.length > 10) {
        return text;
      }
      sibling = sibling.previousElementSibling;
      depth += 1;
    }

    
    let parent = el.parentElement;
    let pDepth = 0;
    while (parent && pDepth < 3) {
      let ps = parent.previousElementSibling;
      if (ps) {
        const text = nodeText(ps);
        if (text && text.length > 10) return text;
      }
      parent = parent.parentElement;
      pDepth += 1;
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
      getLabelByProximity(el),
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

  function extractTextFromSelector(selector) {
    const node = query(selector);
    if (!node) {
      return "";
    }

    if (node instanceof HTMLMetaElement) {
      return cleanText(node.getAttribute("content"));
    }

    return nodeText(node);
  }

  function firstNonEmptyText(selectors) {
    for (const selector of selectors) {
      const text = normalizeContextText(extractTextFromSelector(selector));
      if (text) {
        return text;
      }
    }
    return "";
  }

  function inferCompanyFromHost() {
    const host = normalizedHostname();
    const path = window.location.pathname;
    
    if (!host) return "";

    if (host.includes("lever.co")) {
      const parts = path.split("/").filter(Boolean);
      if (parts.length > 0 && parts[0] !== "apply") {
        return parts[0];
      }
    }

    if (host.includes("greenhouse.io")) {
      const parts = path.split("/").filter(Boolean);
      if (parts.length > 0) {
        const possibleCompany = parts[0];
        if (possibleCompany !== "jobs" && possibleCompany !== "boards") {
          return possibleCompany;
        }
        if (parts.length > 1) return parts[1];
      }
      return host.replace(/\.greenhouse\.io$/, "").replace(/^boards\./, "");
    }

    if (host.includes("ashbyhq.com")) {
      const parts = path.split("/").filter(Boolean);
      if (parts.length > 0) return parts[0];
    }

    return host.split(".")[0];
  }

  function buildApplicationContext() {
    const title = firstNonEmptyText(APPLICATION_CONTEXT_HINTS.titleSelectors);
    const company =
      firstNonEmptyText(APPLICATION_CONTEXT_HINTS.companySelectors) ||
      normalizeContextText(inferCompanyFromHost());

    const context = {};
    if (title) context.title = title;
    if (company) context.company = company;
    context.url = window.location.href;
    return context;
  }

  function isCustomSelectElement(el) {
    if (!(el instanceof HTMLElement)) {
      return false;
    }

    const className = normalizeText(el.className || "");
    const role = normalizeText(el.getAttribute("role"));
    const dataTestId = normalizeText(el.getAttribute("data-testid") || "");

    if (role === "combobox") {
      return true;
    }

    if (className.includes("react-select") || className.includes("select__control") || className.includes("select__input")) {
      return true;
    }

    if (dataTestId.includes("select")) {
      return true;
    }

    const parent = el.closest('[class*="select"], [role="combobox"]');
    if (parent) {
      return true;
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

      return type;
    }

    if (isComboboxElement(el) || isCustomSelectElement(el)) {
      return "select";
    }

    if (isWorkdayInput(el)) {
      const role = normalizeText(el.getAttribute("role"));
      if (role === "combobox") {
        return "select";
      }
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

  function extractCustomSelectOptions(el) {
    const options = [];

    const className = normalizeText(el.className || "");
    const role = normalizeText(el.getAttribute("role"));

    if (className.includes("react-select") || className.includes("select__control")) {
      const menu = el.querySelector('[class*="menu"], [class*="__menu"], [role="listbox"]');
      if (menu) {
        const items = menu.querySelectorAll('[class*="option"], [class*="item"], div[role="option"]');
        items.forEach((item) => {
          const label = cleanText(item.textContent || "");
          if (label) {
            options.push({ label, value: label });
          }
        });
        return options;
      }
    }

    if (role === "combobox") {
      const listboxId = el.getAttribute("aria-controls") || el.getAttribute("data-listbox-id");
      let listbox = null;
      
      if (listboxId) {
        listbox = document.getElementById(listboxId);
      } else {
        listbox = el.nextElementSibling;
        while (listbox && !listbox.matches('[role="listbox"], .select-options, .dropdown-menu')) {
          listbox = listbox.nextElementSibling;
        }
      }

      if (listbox) {
        const items = listbox.querySelectorAll('[role="option"], .option, .select-option, li');
        items.forEach((item) => {
          const label = cleanText(item.textContent || "");
          const value = item.getAttribute("data-value") || item.getAttribute("value") || label;
          if (label) {
            options.push({ label, value });
          }
        });
      }
    }

    return options;
  }

  function extractGreenhouseSelectOptions(container) {
    const options = [];
    
    if (!container) {
      return options;
    }

    const dropdown = container.querySelector('[class*="menu"], [role="listbox"]');
    if (!dropdown) {
      return options;
    }

    const items = dropdown.querySelectorAll('[class*="option"], div[role="option"]');
    items.forEach((item) => {
      const label = cleanText(item.textContent || "");
      let value = item.getAttribute("data-value");
      
      if (!value) {
        const textValue = item.textContent || "";
        if (normalizeText(textValue) === "yes") {
          value = "1";
        } else if (normalizeText(textValue) === "no") {
          value = "0";
        } else {
          value = label;
        }
      }
      
      if (label) {
        const numeric = /^-?\d+$/.test(String(value || "").trim())
          ? parseInt(String(value).trim(), 10)
          : String(value || "").trim();
        options.push({ label, value: numeric });
      }
    });

    if (!options.length) {
      const hiddenInput = container.querySelector('input[aria-hidden="true"]');
      if (hiddenInput) {
        const initialValue = hiddenInput.defaultValue;
        if (initialValue) {
          options.push({ label: "Yes", value: "1" });
          options.push({ label: "No", value: "0" });
        }
      }
    }

    return options;
  }

  function createFieldId(meta, el) {
    if (meta.type === "radio" && meta.name) {
      return `radio:${meta.name}`;
    }
    if (meta.idAttr) {
      return `id:${meta.idAttr}`;
    }
    if (meta.name) {
      return `name:${meta.name}`;
    }

    const anonymousSignature = compactIdSegment(
      [
        meta.type,
        meta.label,
        meta.placeholder,
        elementContextSignature(el),
      ].join("::"),
    );

    if (anonymousSignature) {
      return `anon:${anonymousSignature}`;
    }

    return `anon:${String(el && el.tagName ? el.tagName : "field").toLowerCase()}`;
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

      if (el.disabled) {
        continue;
      }

      if ("readOnly" in el && el.readOnly) {
        continue;
      }

      if (!isVisible(el)) {
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

      const label = getFieldLabel(el);
      const placeholder = cleanText(el.getAttribute("placeholder"));

      const fieldId = createFieldId({ type, idAttr, name, label, placeholder }, el);
      if (seenIds.has(fieldId)) {
        continue;
      }
      seenIds.add(fieldId);

      const options = type === "select" && el instanceof HTMLSelectElement
        ? extractSelectOptions(el)
        : type === "select" && isGreenhouseSelect(el)
          ? extractGreenhouseSelectOptions(findGreenhouseSelectContainer(el))
          : type === "select" && (isCustomSelectElement(el) || isComboboxElement(el))
            ? extractCustomSelectOptions(el)
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
        placeholder,
        description: getFieldDescription(el),
      };

      fields.push(field);
      STATE.fieldRegistry.set(fieldId, {
        id: fieldId,
        idAttr,
        name,
        label,
        type,
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

      if (!labelsEquivalent(text, target)) {
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
    el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true, cancelable: true }));
  }

  function syncNativeInputValue(el, value) {
    try {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value")?.set;
      const nativeInputValueGetter = Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value")?.get;
      
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, value);
      } else {
        el.value = value;
      }
    } catch (e) {
      el.value = value;
    }
    
    const event = new Event("input", { bubbles: true, cancelable: true });
    event.simulated = true;
    el.dispatchEvent(event);
  }

  function isGreenhouseSelect(el) {
    return isAshbyOrGreenhouseSelect(el);
  }

  function isAshbyOrGreenhouseSelect(el) {
    if (!(el instanceof HTMLElement)) {
      return false;
    }

    const className = normalizeText(el.className || "");
    const parent = el.closest('.select-shell, [class*="select__control"]');
    
    if (className.includes("select__input") || parent) {
      return true;
    }

    if (el.getAttribute('aria-expanded') !== null) {
      return true;
    }

    return false;
  }

  function isAshbySelect(el) {
    return isAshbyOrGreenhouseSelect(el);
  }

  function isWorkdayInput(el) {
    if (!(el instanceof HTMLElement)) {
      return false;
    }

    const dataId = normalizeText(el.getAttribute("data-automation-id") || "");
    const role = normalizeText(el.getAttribute("role") || "");
    const type = normalizeText(el.getAttribute("type") || "");
    
    if (role === "combobox" || role === "listbox") {
      return true;
    }

    if (dataId === "promptinput" || dataId.startsWith("input_") || dataId.includes("dropdown") || dataId.includes("select")) {
      return true;
    }

    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && (dataId.includes("text") || type === "text" || type === "email" || type === "tel")) {
      return true;
    }

    return false;
  }

  function findWorkdayInput(el) {
    if (!el) return null;
    
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      return el;
    }

    const input = el.querySelector('input:not([type="hidden"]), textarea, select');
    if (input) return input;

    return null;
  }

  function fillWorkdaySelect(el, value) {
    const target = normalizeText(value);
    if (!target) {
      return false;
    }

    const options = document.querySelectorAll('[data-automation-id="promptOption"]');
    for (const option of options) {
      const optionLabel = normalizeText(option.textContent || option.getAttribute("data-automation-label") || "");
      if (optionLabel === target || target.includes(optionLabel) || optionLabel.includes(target)) {
        const roleOption = option.closest('[role="option"]');
        if (roleOption) {
          roleOption.click();
          return true;
        }
        option.click();
        return true;
      }
    }

    const roleOptions = document.querySelectorAll('[role="option"]');
    for (const option of roleOptions) {
      const optionLabel = normalizeText(option.textContent || "");
      if (optionLabel === target || target.includes(optionLabel) || optionLabel.includes(target)) {
        option.click();
        return true;
      }
    }

    const promptInput = el.querySelector('[data-automation-id="promptInput"]');
    if (promptInput) {
      syncNativeInputValue(promptInput, value);
      dispatchInputEvents(promptInput);
      return true;
    }

    return false;
  }

  function findGreenhouseSelectContainer(el) {
    let current = el;
    let depth = 0;
    
    while (current && depth < 10) {
      const className = normalizeText(current.className || "");
      if (className.includes("select-shell") || className.includes("select__control")) {
        return current;
      }
      current = current.parentElement;
      depth += 1;
    }
    
    return null;
  }

  function findGreenhouseHiddenInput(container) {
    if (!container) {
      return null;
    }
    
    const hidden = container.querySelector('input[aria-hidden="true"], input[tabindex="-1"]');
    return hidden instanceof HTMLInputElement ? hidden : null;
  }

  function fillGreenhouseSelect(inputEl, displayValue, numericValue) {
    if (!inputEl) {
      return false;
    }

    const container = findGreenhouseSelectContainer(inputEl);
    if (!container) {
      return false;
    }

    let targetDisplay = normalizeText(displayValue);
    let targetValue;
    
    if (numericValue !== undefined) {
      targetValue = String(numericValue);
    } else {
      if (targetDisplay === "yes" || targetDisplay === "true") {
        targetValue = "1";
      } else if (targetDisplay === "no" || targetDisplay === "false") {
        targetValue = "0";
      } else {
        targetValue = targetDisplay;
      }
    }
    
    const visibleInput = container.querySelector('.select__input');
    if (visibleInput) {
      visibleInput.focus();
      syncNativeInputValue(visibleInput, targetDisplay);
    }

    const hiddenInput = findGreenhouseHiddenInput(container);
    if (hiddenInput) {
      syncNativeInputValue(hiddenInput, targetValue);
    }

    container.dispatchEvent(new Event("focus", { bubbles: true, cancelable: true }));
    container.dispatchEvent(new Event("blur", { bubbles: true, cancelable: true }));
    
    const form = container.closest("form");
    if (form) {
      form.dispatchEvent(new Event("change", { bubbles: true }));
    }

    return true;
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

  function isReactSelectComponent(el) {
    if (!(el instanceof HTMLElement)) {
      return false;
    }

    const className = normalizeText(el.className || "");
    const role = normalizeText(el.getAttribute("role"));
    
    if (className.includes("react-select") || className.includes("select__control") || role === "combobox") {
      return true;
    }

    const parent = el.closest(".react-select, .select__control, [class*='react-select']");
    if (parent) {
      return true;
    }

    return false;
  }

  function findReactSelectControl(el) {
    let current = el;
    let depth = 0;
    
    while (current && depth < 10) {
      const className = normalizeText(current.className || "");
      if (className.includes("react-select") || className.includes("select__control")) {
        return current;
      }
      current = current.parentElement;
      depth += 1;
    }
    
    return null;
  }

  function fillReactSelect(el, value) {
    const control = findReactSelectControl(el);
    if (!control) {
      return false;
    }

    const target = String(value || "").trim();
    if (!target) {
      return false;
    }

    control.focus();
    control.click();

    const input = control.querySelector('input, [class*="input"]');
    if (input) {
      syncNativeInputValue(input, target);
    }

    dispatchInputEvents(input || control);

    return true;
  }

  function fillCustomSelect(el, value) {
    if (isGreenhouseSelect(el) || isAshbySelect(el)) {
      const container = findGreenhouseSelectContainer(el);
      if (container) {
        const options = extractGreenhouseSelectOptions(container);
        const target = normalizeText(value);
        
        for (const opt of options) {
          if (normalizeText(opt.label) === target || target.includes(normalizeText(opt.label)) || normalizeText(opt.label).includes(target)) {
            return fillGreenhouseSelect(el, opt.label, opt.value);
          }
        }
        
        return fillGreenhouseSelect(el, value, undefined);
      }
    }

    if (isReactSelectComponent(el)) {
      return fillReactSelect(el, value);
    }

    const role = normalizeText(el.getAttribute("role"));
    if (role === "combobox") {
      return fillCombobox(el, value);
    }

    const className = normalizeText(el.className || "");
    if (className.includes("select") || el.tagName === "SELECT") {
      return fillSelect(el, value);
    }

    if (isWorkdayInput(el)) {
      return fillWorkdaySelect(el, value);
    }

    return fillCombobox(el, value);
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
    let mappedValue = target;
    
    if (target === "yes" || target === "true") {
      mappedValue = "1";
    } else if (target === "no" || target === "false") {
      mappedValue = "0";
    }
    
    let matched = null;

    for (const radio of radios) {
      if (normalizeText(radio.value) === target || normalizeText(radio.value) === mappedValue) {
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

      if (!matched) {
        for (const radio of radios) {
          const labelText = normalizeText(nodeText(radio.nextElementSibling) || "");
          if (labelText && (labelText.includes(target) || target.includes(labelText))) {
            matched = radio;
            break;
          }
        }
      }

      if (!matched) {
        for (const radio of radios) {
          const parent = radio.parentElement;
          if (parent) {
            const labelText = normalizeText(nodeText(parent) || "");
            if (labelText && (labelText.includes(target) || target.includes(labelText))) {
              matched = radio;
              break;
            }
          }
        }
      }
    }

    if (!matched) {
      return false;
    }

    matched.focus();
    matched.click();
    matched.checked = true;
    
    matched.dispatchEvent(new Event("focus", { bubbles: true, cancelable: true }));
    matched.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    matched.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    matched.dispatchEvent(new Event("blur", { bubbles: true, cancelable: true }));

    const form = matched.closest("form");
    if (form) {
      const event = new Event("change", { bubbles: true });
      form.dispatchEvent(event);
    }

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
    let element = findElementForField(fieldId);

    if (!element && allowRescan) {
      extractFields();
      element = findElementForField(fieldId);
      
      // If still not found by ID, try a more aggressive search using the metadata we have
      if (!element) {
        const meta = STATE.fieldRegistry.get(fieldId);
        if (meta && meta.label) {
          element = findFieldByLabel(meta.label);
        }
      }
    }

    if (!element) {
      return false;
    }

    const meta = STATE.fieldRegistry.get(fieldId);
    const parsed = parseFieldId(fieldId);
    if (parsed.kind === "radio" || (meta && meta.type === "radio")) {
      const groupName = parsed.kind === "radio" ? parsed.value : meta.name;
      return fillRadioGroup(groupName, item.value);
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
      return fillCustomSelect(element, item.value);
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
      '  <div class="jap-logo">',
      '    <div class="jap-logo-icon">A</div>',
      '    <span class="jap-logo-text">Applied</span>',
      '  </div>',
      '  <button id="jap-close" class="jap-icon-btn" title="Close">✕</button>',
      '</div>',
      '<div class="jap-body">',
      '  <div class="jap-status-container">',
      '    <div id="jap-status" class="jap-status">',
      '      <span class="jap-status-dot"></span>',
      '      <span>Ready to fill</span>',
      '    </div>',
      '  </div>',
      '  <button id="jap-fill" class="jap-btn jap-btn-primary">',
      '    ✨ Fill application',
      '  </button>',
      '</div>',
      '<div id="jap-warning" class="jap-warning hidden">',
      '  <div class="jap-warning-title">',
      '    <span>⚠️ Duplicate Application</span>',
      '  </div>',
      '  <div id="jap-warning-text" class="jap-warning-text"></div>',
      '  <div id="jap-warning-meta" class="jap-warning-meta"></div>',
      '  <button id="jap-force-apply" class="jap-btn jap-btn-danger">Apply Anyway</button>',
      '</div>',
      '<div class="jap-footer">',
      '  <span><span class="jap-shortcut">Ctrl+Shift+F</span> to quick fill</span>',
      '</div>',
    ].join("\n");
    document.body.appendChild(overlay);
    query("#jap-fill", overlay).onclick = async () => {
      if (STATE.isBusy) {
        setStatus("Busy...", "loading");
        return;
      }

      STATE.isBusy = true;
      try {
        const scanned = await runScan();
        if (scanned) {
          await runApply();
        }
      } finally {
        STATE.isBusy = false;
      }
    };
    query("#jap-close", overlay).onclick = () => overlay.classList.add("hidden");
    query("#jap-force-apply", overlay).onclick = async () => {
      if (STATE.isBusy) {
        setStatus("Busy...", "loading");
        return;
      }

      STATE.isBusy = true;
      STATE.alreadyApplied = null;
      STATE.bypassDuplicateCheckOnce = true;
      hideDuplicateWarning();
      try {
        const scanned = await runScan();
        if (scanned) {
          await runApply();
        }
      } finally {
        STATE.isBusy = false;
      }
    };
    return overlay;
  }

  function showDuplicateWarning(application) {
    const warning = query("#jap-warning");
    const warningText = query("#jap-warning-text");
    const warningMeta = query("#jap-warning-meta");
    if (warning && warningText && application) {
      const date = new Date(application.appliedAt).toLocaleDateString();
      const target = application.position || application.context?.title || "this role";
      warningText.textContent = `Already applied to ${target} on ${date}`;
      if (warningMeta) {
        const company = application.company || application.context?.company || "";
        warningMeta.textContent = company ? `Company: ${company}` : "";
      }
      warning.classList.remove("hidden");
    }
  }

  function hideDuplicateWarning() {
    const warning = query("#jap-warning");
    const warningMeta = query("#jap-warning-meta");
    if (warning) {
      warning.classList.add("hidden");
    }
    if (warningMeta) {
      warningMeta.textContent = "";
    }
  }

  function setStatus(text, type = "") {
    const statusNode = query("#jap-status");
    if (statusNode) {
      const dot = statusNode.querySelector(".jap-status-dot");
      const textSpan = statusNode.querySelector("span:not(.jap-status-dot)") || document.createElement("span");
      
      if (type) {
        statusNode.className = `jap-status ${type}`;
      } else {
        statusNode.className = "jap-status";
      }
      
      if (textSpan) {
        textSpan.textContent = String(text || "");
        if (!statusNode.contains(textSpan)) {
          statusNode.appendChild(textSpan);
        }
      }
    }
  }

  function queuePendingApplicationRecord() {
    if (!STATE.lastFields.length) {
      return;
    }

    STATE.pendingRecord = {
      url: window.location.href,
      fields: STATE.lastFields.map((field) => ({ ...field })),
      applicationContext: buildApplicationContext(),
      queuedAt: Date.now(),
    };
  }

  async function flushPendingApplicationRecord() {
    if (STATE.recordingInFlight || !STATE.pendingRecord) {
      return;
    }

    const pending = STATE.pendingRecord;
    STATE.recordingInFlight = true;

    try {
      const response = await ext.runtime.sendMessage({
        type: "recordApplication",
        url: pending.url,
        fields: pending.fields,
        applicationContext: pending.applicationContext,
      });

      if (response?.ok) {
        STATE.pendingRecord = null;
      }
    } catch {
      // Ignore recording errors; user can retry from current page flow.
    } finally {
      STATE.recordingInFlight = false;
    }
  }

  function shouldTreatAsSubmitClick(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    if (target.closest('button[type="submit"], input[type="submit"]')) {
      return true;
    }

    const submitLike = target.closest(
      '[data-qa*="submit"], [data-automation-id*="submit"], [aria-label*="submit" i], [aria-label*="apply" i]',
    );
    if (!submitLike) {
      return false;
    }

    const label = normalizeText(
      submitLike.textContent ||
      submitLike.getAttribute("aria-label") ||
      submitLike.getAttribute("value") ||
      "",
    );

    return label.includes("apply") || label.includes("submit");
  }

  function attachRecordHooks() {
    if (STATE.recordHooksAttached) {
      return;
    }

    STATE.recordHooksAttached = true;

    document.addEventListener(
      "submit",
      () => {
        window.setTimeout(() => {
          flushPendingApplicationRecord();
        }, 250);
      },
      true,
    );

    document.addEventListener(
      "click",
      (event) => {
        if (!shouldTreatAsSubmitClick(event.target)) {
          return;
        }

        window.setTimeout(() => {
          flushPendingApplicationRecord();
        }, 350);
      },
      true,
    );

    window.addEventListener(
      "beforeunload",
      () => {
        flushPendingApplicationRecord();
      },
      true,
    );
  }

  async function runScan() {
    setStatus("Scanning...", "loading");
    try {
      if (STATE.pendingRecord && STATE.pendingRecord.url !== window.location.href) {
        STATE.pendingRecord = null;
      }

      STATE.lastSuggestions = [];
      STATE.lastFields = [];
      STATE.lastScanUrl = "";

      const fields = extractFields();
      if (!fields.length) {
        setStatus("No fields found", "");
        return false;
      }

      STATE.lastFields = fields;
      const applicationContext = buildApplicationContext();

      const bypassDuplicateCheck = STATE.bypassDuplicateCheckOnce;
      STATE.bypassDuplicateCheckOnce = false;

      if (!bypassDuplicateCheck) {
        const checkResponse = await ext.runtime.sendMessage({
          type: "checkApplication",
          fields,
          applicationContext,
        }).catch(() => null);

        if (checkResponse?.ok && checkResponse.payload?.alreadyApplied) {
          STATE.alreadyApplied = checkResponse.payload.application;
          STATE.lastSuggestions = [];
          STATE.lastScanUrl = window.location.href;
          setStatus("Already applied!", "success");
          showDuplicateWarning(checkResponse.payload.application);
          return false;
        }
      }

      STATE.alreadyApplied = null;
      hideDuplicateWarning();
      const response = await ext.runtime.sendMessage({
        type: "scanAndResolve",
        fields,
        applicationContext,
      }).catch(err => {
        return { ok: false, error: "Local proxy is not reachable. Please ensure 'npm run start:proxy' is running." };
      });

      if (!response || !response.ok) {
        setStatus(`Error: ${response?.error || "failed"}`, "error");
        return false;
      }
      STATE.lastSuggestions = response.session?.suggestions || [];
      STATE.lastScanUrl = window.location.href;
      if (!STATE.lastSuggestions.length) {
        setStatus(`Found ${fields.length} fields (no suggestions)`, "");
        return true;
      }

      const suggestedCount = STATE.lastSuggestions.filter((item) => item && item.suggested).length;
      if (suggestedCount === 0) {
        setStatus(`Found ${fields.length} fields (0 suggestions ready)`, "error");
      } else {
        setStatus(`Found ${fields.length} fields (${suggestedCount} ready)`, "success");
      }
      return true;
    } catch (e) {
      setStatus(`Error: ${e?.message || e}`, "error");
      return false;
    }
  }

  async function runApply() {
    if (STATE.alreadyApplied) {
      setStatus("Blocked: already applied", "error");
      showDuplicateWarning(STATE.alreadyApplied);
      return;
    }

    if (STATE.lastScanUrl && STATE.lastScanUrl !== window.location.href) {
      setStatus("Page changed, rescan required", "error");
      return;
    }

    if (!Array.isArray(STATE.lastSuggestions) || !STATE.lastSuggestions.length) {
      setStatus("No suggestions yet (click Fill)", "");
      return;
    }

    setStatus("Applying...", "loading");
    try {
      const approvedItems = STATE.lastSuggestions.filter(
        (item) => item && item.suggested && hasMeaningfulValue(item.value),
      );

      if (!approvedItems.length) {
        setStatus("No approved suggestions to apply", "error");
        return;
      }

      const result = applyBatch(approvedItems);
      if (result.appliedCount <= 0) {
        setStatus("Could not apply any fields", "error");
        return;
      }

      queuePendingApplicationRecord();
      setStatus(`Applied ${result.appliedCount} fields (submit to record)`, "success");
    } catch (e) {
      setStatus(`Error: ${e?.message || e}`, "error");
    }
  }

  function boot() {
    if (!STATE.booted) {
      STATE.booted = true;
      if (getActiveAdapter()) {
        attachRecordHooks();
        showOverlay();
      }
    }
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

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
  };

  const LEVER_ADAPTER = {
    id: "lever",
    matches(hostname) {
      const value = normalizeText(hostname);
      return value.includes("lever.co") || value.includes("lever");
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

      queryAll('input:not([type="hidden"]):not([type="file"]), textarea, select').forEach(add);
      queryAll('[role="combobox"]').forEach(add);
      queryAll('.gh-select, .select-container input').forEach(add);
      queryAll('input[type="radio"]').forEach(add);

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

  const ASHBY_ADAPTER = {
    id: "ashby",
    matches(hostname) {
      const value = normalizeText(hostname);
      return value.includes("ashbyhq.com") || value.includes("jobs.ashbyhq");
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

  const WORKDAY_ADAPTER = {
    id: "workday",
    matches(hostname) {
      const value = normalizeText(hostname);
      return value.includes("myworkday.com") || value.includes("myworkdayjobs") || value.includes("workday.com");
    },
    collectCandidateElements() {
      const set = new Set();

      queryAll('input:not([type="hidden"]):not([type="file"])').forEach((el) => {
        if (el instanceof HTMLInputElement && isVisible(el)) {
          set.add(el);
        }
      });
      queryAll('textarea').forEach((el) => {
        if (el instanceof HTMLTextAreaElement && isVisible(el)) {
          set.add(el);
        }
      });
      queryAll('select').forEach((el) => {
        if (el instanceof HTMLSelectElement && isVisible(el)) {
          set.add(el);
        }
      });
      
      queryAll('[data-automation-id*="text"]').forEach((el) => {
        if (el instanceof HTMLElement && isVisible(el)) {
          const nested = findWorkdayInput(el);
          if (nested) set.add(nested);
        }
      });
      queryAll('[data-automation-id="promptInput"]').forEach((el) => {
        if (el instanceof HTMLElement && isVisible(el)) {
          set.add(el);
        }
      });
      queryAll('[data-automation-id="input_"]').forEach((el) => {
        if (el instanceof HTMLElement && isVisible(el)) {
          set.add(el);
        }
      });
      queryAll('input[type="radio"]').forEach((el) => {
        if (el instanceof HTMLInputElement && isVisible(el)) {
          set.add(el);
        }
      });

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

    if (isWorkdayInput(el)) {
      return true;
    }

    const parent = el.closest('[class*="select"], [role="combobox"]');
    if (parent) {
      return true;
    }

    return false;
  }

  function collectFormElements() {
    const set = new Set();

    const add = (el) => {
      const normalized = normalizeCandidateElement(el);
      if (normalized) {
        set.add(normalized);
      }
    };

    queryAll('input:not([type="hidden"]):not([type="file"]), textarea, select').forEach(add);
    queryAll('[role="combobox"]').forEach(add);
    queryAll('.react-select, .select__control').forEach(add);

    return Array.from(set);
  }

  function collectRadioButtons() {
    const set = new Set();
    
    queryAll('input[type="radio"]').forEach((el) => {
      if (el instanceof HTMLInputElement) {
        set.add(el);
      }
    });

    return Array.from(set);
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
        options.push({ label, value: parseInt(value, 10) });
      }
    });

    if (!options.length) {
      const hiddenInput = container.querySelector('input[aria-hidden="true"]');
      if (hiddenInput) {
        const initialValue = hiddenInput.defaultValue;
        if (initialValue) {
          options.push({ label: "Yes", value: 1 });
          options.push({ label: "No", value: 0 });
        }
      }
    }

    return options;
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
    el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true, cancelable: true }));
  }

  function dispatchFocusAndBlurEvents(el) {
    el.dispatchEvent(new FocusEvent("focus", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new FocusEvent("blur", { bubbles: true, cancelable: true }));
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

  function findAshbySelectContainer(el) {
    return findGreenhouseSelectContainer(el);
  }

  function isAshbySelect(el) {
    return isAshbyOrGreenhouseSelect(el);
  }

  function isWorkdayInput(el) {
    if (!(el instanceof HTMLElement)) {
      return false;
    }

    const dataId = el.getAttribute("data-automation-id") || "";
    const className = el.className || "";
    
    if (dataId.includes("text") || dataId.includes("promptInput") || dataId.includes("input_")) {
      return true;
    }

    if (className.includes("input")) {
      const parent = el.closest('[data-automation-id]');
      if (parent) return true;
    }

    return false;
  }

  function findWorkdayInput(el) {
    if (!el) return null;
    
    if (el instanceof HTMLInputElement) return el;
    if (el instanceof HTMLTextAreaElement) return el;
    if (el instanceof HTMLSelectElement) return el;

    const input = el.querySelector('input:not([type="hidden"])');
    if (input) return input;
    
    const textarea = el.querySelector('textarea');
    if (textarea) return textarea;

    const select = el.querySelector('select');
    if (select) return select;

    return el;
  }

  function findWorkdayDropdownOptions(el) {
    const options = [];
    
    const promptOptions = document.querySelectorAll('[data-automation-id="promptOption"]');
    promptOptions.forEach((option) => {
      const label = cleanText(option.textContent || option.getAttribute("data-automation-label") || "");
      const value = option.getAttribute("data-option-value") || option.getAttribute("data-value") || label;
      if (label) {
        options.push({ label, value });
      }
    });

    const roleOptions = document.querySelectorAll('[role="option"]');
    roleOptions.forEach((option) => {
      const label = cleanText(option.textContent || "");
      const value = option.getAttribute("data-value") || label;
      if (label) {
        options.push({ label, value });
      }
    });

    return options;
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

  function findReactSelectDropdown(control) {
    if (!control) {
      return null;
    }
    
    const menu = control.querySelector('[class*="menu"], [class*="-dropdown"], [class*="__menu"]');
    return menu;
  }

  function findReactSelectOption(dropdown, value) {
    if (!dropdown) {
      return null;
    }

    const target = normalizeText(value);
    const options = dropdown.querySelectorAll('[class*="option"], [class*="item"], div[role="option"]');
    
    for (const option of options) {
      const label = normalizeText(option.textContent || "");
      if (label.includes(target) || target.includes(label) || label === target) {
        return option;
      }
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

  let profileFileHints = { resume: null, coverLetter: null };

  async function loadProfileFileHints() {
    try {
      const response = await ext.runtime.sendMessage({ type: "getProfileFiles" });
      if (response && response.ok && response.payload) {
        profileFileHints = {
          resume: response.payload.resume,
          coverLetter: response.payload.coverLetter,
        };
      }
    } catch {
      profileFileHints = { resume: null, coverLetter: null };
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
      '  <button id="jap-fill" class="jap-btn jap-btn-primary">Fill</button>',
      '  <div id="jap-status" class="jap-status">Ready</div>',
      '  <button id="jap-close" class="jap-btn jap-btn-ghost">✕</button>',
      "</div>",
      '<div id="jap-warning" class="jap-warning hidden">',
      '  <span id="jap-warning-text"></span>',
      '  <button id="jap-force-apply" class="jap-btn jap-btn-warning">Apply Anyway</button>',
      "</div>",
    ].join("\n");
    document.body.appendChild(overlay);
    query("#jap-fill", overlay).onclick = () => runScan().then(() => runApply());
    query("#jap-close", overlay).onclick = () => overlay.classList.add("hidden");
    query("#jap-force-apply", overlay).onclick = () => {
      STATE.alreadyApplied = null;
      hideDuplicateWarning();
      runScan().then(() => runApply());
    };
    return overlay;
  }

  function showDuplicateWarning(application) {
    const warning = query("#jap-warning");
    const warningText = query("#jap-warning-text");
    if (warning && warningText && application) {
      const date = new Date(application.appliedAt).toLocaleDateString();
      warningText.textContent = `Already applied to ${application.company || "this company"} on ${date}`;
      warning.classList.remove("hidden");
    }
  }

  function hideDuplicateWarning() {
    const warning = query("#jap-warning");
    if (warning) {
      warning.classList.add("hidden");
    }
  }

  function setStatus(text) {
    const statusNode = query("#jap-status");
    if (statusNode) {
      statusNode.textContent = String(text || "");
    }
  }

  async function runScan() {
    setStatus("Scanning...");
    try {
      const fields = extractFields();
      if (!fields.length) {
        setStatus("No fields found");
        return;
      }

      STATE.lastFields = fields;

      const checkResponse = await ext.runtime.sendMessage({ type: "checkApplication", fields });
      if (checkResponse?.ok && checkResponse.payload?.alreadyApplied) {
        STATE.alreadyApplied = checkResponse.payload.application;
        setStatus("Already applied!");
        showDuplicateWarning(checkResponse.payload.application);
        return;
      }

      STATE.alreadyApplied = null;
      const response = await ext.runtime.sendMessage({ type: "scanAndResolve", fields });
      if (!response || !response.ok) {
        setStatus(`Error: ${response?.error || "failed"}`);
        return;
      }
      STATE.lastSuggestions = response.session?.suggestions || [];
      setStatus(`Found ${fields.length} fields`);
    } catch (e) {
      setStatus(`Error: ${e?.message || e}`);
    }
  }

  async function runApply() {
    setStatus("Applying...");
    try {
      const result = applyBatch(STATE.lastSuggestions);
      if (result.appliedCount > 0 && STATE.lastFields.length > 0) {
        await ext.runtime.sendMessage({ type: "recordApplication", fields: STATE.lastFields });
      }
      setStatus(`Applied ${result.appliedCount} fields`);
    } catch (e) {
      setStatus(`Error: ${e?.message || e}`);
    }
  }

  function boot() {
    if (!STATE.booted) {
      STATE.booted = true;
      if (getActiveAdapter()) {
        loadProfileFileHints();
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

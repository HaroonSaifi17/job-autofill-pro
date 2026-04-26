"use strict";

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const DATA_DIRECTORY = path.resolve(__dirname, "..", "data");
const HISTORY_FILE = path.join(DATA_DIRECTORY, "application-history.json");

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeJobKey(url, company, position) {
  const domain = extractDomain(url);
  const normalized = `${domain}|${(company || "").toLowerCase().trim()}|${(position || "").toLowerCase().trim()}`;
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function extractJobInfo(url, fields) {
  const companyField = fields.find(
    (f) => f.label && /company|employer|organization/i.test(f.label),
  );
  const positionField = fields.find(
    (f) =>
      f.label &&
      /position|role|job title|title|how would you like us to title you/i.test(f.label),
  );
  const titleField = fields.find(
    (f) => f.label && /job title|posting title/i.test(f.label),
  );

  return {
    company: companyField?.value || "",
    position: positionField?.value || titleField?.value || "",
  };
}

class ApplicationHistory {
  constructor() {
    this.entries = new Map();
  }

  async load() {
    try {
      const raw = await fs.readFile(HISTORY_FILE, "utf8");
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== "object") {
        this.entries = new Map();
        return;
      }

      const next = new Map();
      for (const [key, value] of Object.entries(parsed)) {
        next.set(key, {
          url: value.url,
          company: value.company,
          position: value.position,
          appliedAt: value.appliedAt,
          fields: value.fields || [],
        });
      }

      this.entries = next;
    } catch (error) {
      if (error && error.code === "ENOENT") {
        this.entries = new Map();
        return;
      }

      throw error;
    }
  }

  async persist() {
    await fs.mkdir(DATA_DIRECTORY, { recursive: true });

    const serialized = {};
    for (const [key, value] of this.entries) {
      serialized[key] = value;
    }

    await fs.writeFile(HISTORY_FILE, JSON.stringify(serialized, null, 2), "utf8");
  }

  hasApplied(url, fields) {
    const { company, position } = extractJobInfo(url, fields);
    const key = normalizeJobKey(url, company, position);
    return this.entries.has(key);
  }

  getApplication(url, fields) {
    const { company, position } = extractJobInfo(url, fields);
    const key = normalizeJobKey(url, company, position);
    return this.entries.get(key);
  }

  async recordApplication(url, fields) {
    const { company, position } = extractJobInfo(url, fields);
    const key = normalizeJobKey(url, company, position);

    this.entries.set(key, {
      url,
      company,
      position,
      appliedAt: new Date().toISOString(),
      fields: fields.slice(0, 20),
    });

    await this.persist();
  }

  getAll() {
    return Array.from(this.entries.values()).sort(
      (a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime(),
    );
  }

  size() {
    return this.entries.size;
  }
}

module.exports = {
  ApplicationHistory,
  extractDomain,
  normalizeJobKey,
  extractJobInfo,
};
"use strict";

const fs = require("fs/promises");
const path = require("path");
const pdfParse = require("pdf-parse");

const {
  normalizeText,
  splitIntoChunks,
  toBoolean,
} = require("./text-utils");

const PROFILE_DIR = path.resolve(__dirname, "..", "..", "profile-data");

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".text", ".markdown", ".json"]);
const PDF_EXTENSIONS = new Set([".pdf"]);

const FACT_ALIASES = {
  fullName: ["full name", "name", "legal name", "candidate name"],
  firstName: ["first name", "given name", "forename"],
  lastName: ["last name", "family name", "surname"],
  email: ["email", "email address", "mail"],
  phone: ["phone", "phone number", "mobile", "contact number"],
  linkedInUrl: ["linkedin", "linkedin url", "linkedin profile"],
  githubUrl: ["github", "github url", "github profile"],
  websiteUrl: ["website", "portfolio", "portfolio url", "personal site"],
  location: ["location", "current location", "where are you based"],
  city: ["city", "current city", "town"],
  state: ["state", "province", "region"],
  country: ["country", "nation", "nationality"],
  workAuthorization: ["work authorization", "authorized to work", "work permit"],
  needsSponsorship: ["visa sponsorship", "need sponsorship", "require sponsorship"],
  salaryExpectation: ["salary expectation", "expected salary", "expected ctc", "compensation"],
  currentCTC: ["current ctc", "current salary", "current compensation"],
  noticePeriod: ["notice period", "availability", "when can you start", "start date"],
  willingToRelocate: ["willing to relocate", "relocate", "relocation"],
  currentCompany: ["current company", "current employer", "present company"],
  currentRole: ["current role", "job title", "current title"],
  graduationYear: ["graduation year", "year of graduation", "passing year"],
  degree: ["degree", "highest degree", "qualification"],
  university: ["university", "college", "institution"],
  cgpa: ["cgpa", "gpa"],
  education: ["education"],
  totalExperience: ["total experience", "overall experience", "years of experience"],
  codingExperience: ["coding experience", "programming experience"],
  experienceLevel: ["professional experience", "experience level"],
  typescriptExperience: ["typescript experience", "years of typescript"],
  javascriptExperience: ["javascript experience", "years of javascript"],
  nodeExperience: ["node experience", "node.js experience", "nodejs experience"],
  llmExperience: ["llm experience", "ai experience", "llm api experience"],
  technicalSkills: ["technical skills", "skills", "tech stack"],
  fresherStatus: ["fresher status", "fresher", "new graduate", "recent graduate"],
  achievements: ["achievements", "awards", "honors"],
  projects: ["projects", "key projects"],
  aboutYou: ["about you", "about yourself", "bio", "summary"],
  strengths: ["strengths", "core strengths"],
  weaknesses: ["weaknesses"],
  whyHireYou: ["why hire you", "why should we hire you"],
  hobbies: ["hobbies", "interests"],
  coverLetterText: ["cover letter", "cover letter text"],
};

const FACT_KEYS = Object.keys(FACT_ALIASES);

const BOOLEAN_FACT_KEYS = new Set([
  "workAuthorization",
  "needsSponsorship",
]);

function nowIso() {
  return new Date().toISOString();
}

function sanitizeLineValue(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeEmail(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const exact = raw.match(/^[^<>\s]+@[^<>\s]+\.[^<>\s]+$/i);
  if (exact) {
    return exact[0].trim();
  }

  const bracket = raw.match(/<([^<>]+)>/);
  if (bracket) {
    return bracket[1].trim();
  }

  const fallback = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return fallback ? fallback[0].trim() : sanitizeLineValue(raw);
}

function sanitizePhone(value) {
  const raw = sanitizeLineValue(value);
  if (!raw) {
    return "";
  }

  const compact = raw.replace(/[^\d+]/g, "");
  if (!compact) {
    return raw;
  }

  if (compact.startsWith("+")) {
    return `+${compact.slice(1).replace(/\D/g, "")}`;
  }

  return compact.replace(/\D/g, "");
}

function parseName(fullName) {
  const parts = sanitizeLineValue(fullName)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return { firstName: "", lastName: "" };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function inferFullName(firstName, lastName, fullName) {
  if (sanitizeLineValue(fullName)) {
    return sanitizeLineValue(fullName);
  }

  if (sanitizeLineValue(firstName) && sanitizeLineValue(lastName)) {
    return `${sanitizeLineValue(firstName)} ${sanitizeLineValue(lastName)}`;
  }

  return sanitizeLineValue(firstName || lastName || "");
}

function canonicalFactKey(rawKey) {
  const normalized = normalizeText(rawKey);
  if (!normalized) {
    return null;
  }

  for (const [factKey, aliases] of Object.entries(FACT_ALIASES)) {
    for (const alias of aliases) {
      if (normalizeText(alias) === normalized) {
        return factKey;
      }
    }
  }

  return null;
}

function extractByRegex(text, regex) {
  const match = String(text || "").match(regex);
  if (!match || !match[1]) {
    return "";
  }
  return sanitizeLineValue(match[1]);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => sanitizeLineValue(entry))
    .filter(Boolean);
}

function parseKVLine(line) {
  const match = String(line || "").match(/^\s*([A-Za-z0-9 _/().-]{2,80})\s*[:=-]\s*(.+)\s*$/);
  if (!match) {
    return null;
  }

  return {
    rawKey: sanitizeLineValue(match[1]),
    value: sanitizeLineValue(match[2]),
  };
}

function mergeFact(target, key, value) {
  if (!key) {
    return;
  }

  if (value === null || typeof value === "undefined") {
    return;
  }

  if (BOOLEAN_FACT_KEYS.has(key)) {
    const booleanValue = toBoolean(value);
    if (booleanValue === null) {
      return;
    }
    target[key] = booleanValue;
    return;
  }

  const text = sanitizeLineValue(value);
  if (!text) {
    return;
  }

  target[key] = text;
}

function parseSimpleKeyValues(text) {
  const parsed = {};
  const lines = String(text || "").split(/\r?\n/);

  for (const line of lines) {
    const kv = parseKVLine(line);
    if (!kv) {
      continue;
    }

    const factKey = canonicalFactKey(kv.rawKey);
    if (!factKey) {
      continue;
    }

    mergeFact(parsed, factKey, kv.value);
  }

  return parsed;
}

function parseJsonFacts(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return {};
  }

  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") {
      return {};
    }

    const parsed = {};
    const entries = Object.entries(data);

    for (const [key, value] of entries) {
      const canonical = canonicalFactKey(key) || (FACT_KEYS.includes(key) ? key : null);
      if (!canonical) {
        continue;
      }

      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        mergeFact(parsed, canonical, value);
        continue;
      }

      if (Array.isArray(value)) {
        const textValue = normalizeStringArray(value).join(", ");
        mergeFact(parsed, canonical, textValue);
      }
    }

    return parsed;
  } catch {
    return {};
  }
}

function extractUrls(text) {
  const urls = Array.from(new Set(String(text || "").match(/https?:\/\/[^\s)]+/gi) || []));

  return {
    linkedInUrl: urls.find((url) => /linkedin\.com/i.test(url)) || "",
    githubUrl: urls.find((url) => /github\.com/i.test(url)) || "",
    websiteUrl: urls.find((url) => !/linkedin\.com|github\.com/i.test(url)) || "",
  };
}

function extractFactsFromRawText(combinedText) {
  const regexFacts = {
    fullName: extractByRegex(combinedText, /(?:^|\n)\s*(?:full\s+name|name)\s*[:=-]\s*([^\n]+)/i),
    firstName: extractByRegex(combinedText, /(?:^|\n)\s*(?:first\s+name|given\s+name)\s*[:=-]\s*([^\n]+)/i),
    lastName: extractByRegex(combinedText, /(?:^|\n)\s*(?:last\s+name|family\s+name|surname)\s*[:=-]\s*([^\n]+)/i),
    email: sanitizeEmail(extractByRegex(combinedText, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)),
    phone: extractByRegex(combinedText, /(\+?\d[\d\s().-]{7,}\d)/),
    location: extractByRegex(combinedText, /(?:^|\n)\s*location\s*[:=-]\s*([^\n]+)/i),
    city: extractByRegex(combinedText, /(?:^|\n)\s*city\s*[:=-]\s*([^\n]+)/i),
    state: extractByRegex(combinedText, /(?:^|\n)\s*state\s*[:=-]\s*([^\n]+)/i),
    country: extractByRegex(combinedText, /(?:^|\n)\s*country\s*[:=-]\s*([^\n]+)/i),
    salaryExpectation: extractByRegex(combinedText, /(?:^|\n)\s*(?:salary\s+expectation|expected\s+salary)\s*[:=-]\s*([^\n]+)/i),
    currentCTC: extractByRegex(combinedText, /(?:^|\n)\s*(?:current\s+ctc|current\s+salary)\s*[:=-]\s*([^\n]+)/i),
    noticePeriod: extractByRegex(combinedText, /(?:^|\n)\s*(?:notice\s+period|availability)\s*[:=-]\s*([^\n]+)/i),
    codingExperience: extractByRegex(combinedText, /(?:^|\n)\s*(?:coding\s+experience|programming\s+experience)\s*[:=-]\s*([^\n]+)/i),
    totalExperience: extractByRegex(combinedText, /(?:^|\n)\s*(?:total\s+experience|overall\s+experience)\s*[:=-]\s*([^\n]+)/i),
    workAuthorization: toBoolean(extractByRegex(combinedText, /(?:work\s+authorization|authorized\s+to\s+work)[^\n:=-]*[:=-]\s*([^\n]+)/i)),
    needsSponsorship: toBoolean(extractByRegex(combinedText, /(?:visa\s+sponsorship|require\s+visa\s+sponsorship|needs?\s+sponsorship)[^\n:=-]*[:=-]\s*([^\n]+)/i)),
  };

  return {
    ...regexFacts,
    ...extractUrls(combinedText),
    ...parseSimpleKeyValues(combinedText),
  };
}

function normalizeFacts(rawFacts) {
  const next = {};

  for (const factKey of FACT_KEYS) {
    const value = rawFacts[factKey];
    if (BOOLEAN_FACT_KEYS.has(factKey)) {
      const booleanValue = typeof value === "boolean" ? value : toBoolean(value);
      next[factKey] = booleanValue === null ? null : booleanValue;
      continue;
    }

    next[factKey] = sanitizeLineValue(value);
  }

  next.email = sanitizeEmail(next.email);
  next.phone = sanitizePhone(next.phone);

  const nameParts = parseName(next.fullName);
  next.firstName = next.firstName || nameParts.firstName;
  next.lastName = next.lastName || nameParts.lastName;
  next.fullName = inferFullName(next.firstName, next.lastName, next.fullName);

  next.coverLetterText = sanitizeLineValue(next.coverLetterText).slice(0, 7000);
  next.aboutYou = sanitizeLineValue(next.aboutYou).slice(0, 2000);
  next.projects = sanitizeLineValue(next.projects).slice(0, 3000);
  next.achievements = sanitizeLineValue(next.achievements).slice(0, 3000);
  next.technicalSkills = sanitizeLineValue(next.technicalSkills).slice(0, 1500);

  return next;
}

function extractFacts(documents) {
  const combinedText = documents
    .map((document) => String(document.text || "").trim())
    .filter(Boolean)
    .join("\n\n");

  const rawFacts = extractFactsFromRawText(combinedText);

  for (const document of documents) {
    if (document.type === "json") {
      const fromJson = parseJsonFacts(document.text);
      Object.assign(rawFacts, fromJson);
    }

    if (/cover[-_\s]?letter/i.test(document.source) && !rawFacts.coverLetterText) {
      rawFacts.coverLetterText = String(document.text || "").slice(0, 7000);
    }
  }

  return normalizeFacts(rawFacts);
}

function extractAnswerBank(documents) {
  const pairs = [];

  for (const document of documents) {
    const text = String(document.text || "");

    const qaRegex =
      /(?:^|\n)\s*(?:Q|Question)\s*[:=-]\s*([^\n]+)\n\s*(?:A|Answer)\s*[:=-]\s*([\s\S]*?)(?=\n\s*(?:Q|Question)\s*[:=-]|$)/gi;

    let qaMatch = qaRegex.exec(text);
    while (qaMatch) {
      pairs.push({
        source: document.source,
        question: sanitizeLineValue(qaMatch[1]),
        answer: sanitizeLineValue(qaMatch[2]).slice(0, 1800),
      });
      qaMatch = qaRegex.exec(text);
    }

    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const compact = line.match(/^\s*([^:]{8,140})\s*::\s*(.{3,})$/);
      if (!compact) {
        continue;
      }

      pairs.push({
        source: document.source,
        question: sanitizeLineValue(compact[1]),
        answer: sanitizeLineValue(compact[2]).slice(0, 1400),
      });
    }
  }

  const unique = new Map();
  for (const pair of pairs) {
    const key = `${normalizeText(pair.question)}::${normalizeText(pair.answer)}`;
    if (!pair.question || !pair.answer || unique.has(key)) {
      continue;
    }
    unique.set(key, pair);
  }

  return Array.from(unique.values());
}

function buildChunks(documents) {
  const chunks = [];

  for (const document of documents) {
    const pieces = splitIntoChunks(document.text, 700);
    for (const piece of pieces) {
      chunks.push({
        source: document.source,
        text: piece,
      });
    }
  }

  return chunks;
}

async function readTextDocument(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function readPdfDocument(filePath) {
  const buffer = await fs.readFile(filePath);
  const parsed = await pdfParse(buffer);
  return String(parsed.text || "");
}

async function walkFiles(currentPath, files) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    if (entry.isDirectory() && entry.name === "templates") {
      continue;
    }

    const absolutePath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(absolutePath, files);
      continue;
    }

    files.push(absolutePath);
  }
}

class ProfileStore {
  constructor() {
    this.profile = {
      loadedAt: null,
      schemaVersion: "v2",
      facts: {},
      answerBank: [],
      chunks: [],
      files: [],
      diagnostics: {
        warnings: [],
      },
    };
  }

  getProfile() {
    return this.profile;
  }

  async reload() {
    const filePaths = [];

    try {
      await walkFiles(PROFILE_DIR, filePaths);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        this.profile = {
          loadedAt: nowIso(),
          schemaVersion: "v2",
          facts: normalizeFacts({}),
          answerBank: [],
          chunks: [],
          files: [],
          diagnostics: {
            warnings: ["profile-data directory not found."],
          },
        };
        return this.profile;
      }
      throw error;
    }

    const documents = [];
    const fileSummaries = [];
    const warnings = [];

    for (const filePath of filePaths) {
      const extension = path.extname(filePath).toLowerCase();
      const relativePath = path.relative(PROFILE_DIR, filePath);

      if (!TEXT_EXTENSIONS.has(extension) && !PDF_EXTENSIONS.has(extension)) {
        continue;
      }

      let text = "";
      let type = "text";

      try {
        if (PDF_EXTENSIONS.has(extension)) {
          type = "pdf";
          text = await readPdfDocument(filePath);
        } else {
          type = extension === ".json" ? "json" : "text";
          text = await readTextDocument(filePath);
        }
      } catch (error) {
        fileSummaries.push({
          source: relativePath,
          type,
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const trimmed = String(text || "").trim();

      fileSummaries.push({
        source: relativePath,
        type,
        status: trimmed ? "ok" : "empty",
      });

      if (!trimmed) {
        continue;
      }

      documents.push({
        source: relativePath,
        type,
        text: trimmed,
      });
    }

    const facts = extractFacts(documents);
    const answerBank = extractAnswerBank(documents);
    const chunks = buildChunks(documents);

    if (!facts.fullName) {
      warnings.push("Could not confidently detect full name from profile files.");
    }
    if (!facts.email) {
      warnings.push("Could not detect email from profile files.");
    }
    if (!facts.phone) {
      warnings.push("Could not detect phone from profile files.");
    }

    this.profile = {
      loadedAt: nowIso(),
      schemaVersion: "v2",
      facts,
      answerBank,
      chunks,
      files: fileSummaries,
      diagnostics: {
        warnings,
      },
    };

    return this.profile;
  }
}

module.exports = {
  ProfileStore,
};

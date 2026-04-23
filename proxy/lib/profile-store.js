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

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".text", ".markdown"]);
const PDF_EXTENSIONS = new Set([".pdf"]);

function sanitizeLineValue(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeEmail(value) {
  const raw = String(value || "").trim();
  const emailMatch = raw.match(/^[^<>]+$/);
  if (emailMatch) {
    return emailMatch[0].trim();
  }
  const bracketMatch = raw.match(/<([^<>]+)>/);
  if (bracketMatch) {
    return bracketMatch[1].trim();
  }
  return sanitizeLineValue(raw);
}

function inferFullName(firstName, lastName, fullName) {
  if (fullName) {
    return fullName;
  }
  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }
  return firstName || lastName || "";
}

function deriveNames(fullName, firstName, lastName) {
  let derivedFirst = firstName;
  let derivedLast = lastName;

  if ((!derivedFirst || !derivedLast) && fullName) {
    const parts = fullName
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (!derivedFirst && parts.length) {
      derivedFirst = parts[0];
    }

    if (!derivedLast && parts.length > 1) {
      derivedLast = parts.slice(1).join(" ");
    }
  }

  return {
    firstName: derivedFirst || "",
    lastName: derivedLast || "",
  };
}

function extractByRegex(text, regex) {
  const match = String(text || "").match(regex);
  if (!match || !match[1]) {
    return "";
  }
  return sanitizeLineValue(match[1]);
}

function parseSimpleKeyValues(text) {
  const lines = String(text || "").split(/\r?\n/);

  const parsed = {};

  const keyMap = {
    "name": "fullName",
    "full name": "fullName",
    "first name": "firstName",
    "last name": "lastName",
    "family name": "lastName",
    "given name": "firstName",
    "email": "email",
    "phone": "phone",
    "mobile": "phone",
    "linkedin": "linkedInUrl",
    "linkedin url": "linkedInUrl",
    "linkedin profile": "linkedInUrl",
    "github": "githubUrl",
    "github url": "githubUrl",
    "github profile": "githubUrl",
    "website": "websiteUrl",
    "portfolio": "websiteUrl",
    "portfolio url": "websiteUrl",
    "portfolio website": "websiteUrl",
    "location": "location",
    "city": "city",
    "country": "country",
    "nation": "country",
    "nationality": "country",
    "current location": "location",
    "work authorization": "workAuthorization",
    "authorized to work": "workAuthorization",
    "eligible to work": "workAuthorization",
    "visa sponsorship": "needsSponsorship",
    "require visa sponsorship": "needsSponsorship",
    "sponsorship": "needsSponsorship",
    "salary expectation": "salaryExpectation",
    "expected ctc": "salaryExpectation",
    "current company": "currentCompany",
    "current role": "currentRole",
    "job title": "currentRole",
    "graduation year": "graduationYear",
    "degree": "degree",
    "university": "university",
    "college": "university",
    "cgpa": "cgpa",
    "education": "education",
    "coding experience": "codingExperience",
    "years of coding experience": "codingExperience",
    "professional experience": "experienceLevel",
    "experience level": "experienceLevel",
    "years experience": "experienceLevel",
    "node.js years": "experienceLevel",
    "nodejs years": "experienceLevel",
    "technical skills": "technicalSkills",
    "skills": "technicalSkills",
    "tech stack": "technicalSkills",
    "notice period": "noticePeriod",
    "availability": "noticePeriod",
    "when can you start": "noticePeriod",
    "achievements": "achievements",
    "awards": "achievements",
    "projects": "projects",
    "about yourself": "aboutYou",
    "tell me about yourself": "aboutYou",
    "describe yourself": "aboutYou",
    "strengths": "strengths",
    "weaknesses": "weaknesses",
    "why should we hire you": "whyHireYou",
    "hobbies": "hobbies",
    "interests": "hobbies",
    "years of typescript experience": "typescriptExperience",
    "years of javascript experience": "javascriptExperience",
    "years of node.js experience": "nodeExperience",
    "node js experience": "nodeExperience",
    "llm experience": "llmExperience",
    "ai llm experience": "llmExperience",
    "relocate to delhi ncr": "willingToRelocate",
    "willing to relocate": "willingToRelocate",
    "relocate": "willingToRelocate",
    "willing to reloc": "willingToRelocate",
    "current ctc": "currentCTC",
    "expected ctc": "salaryExpectation",
    "degree": "degree",
    "highest degree": "degree",
  };

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z0-9 _/()-]{2,50})\s*[:=-]\s*(.+)\s*$/);
    if (!match) {
      continue;
    }

    const key = normalizeText(match[1]);
    const value = sanitizeLineValue(match[2]);
    const mappedKey = keyMap[key];

    if (!mappedKey || !value) {
      continue;
    }

    if (mappedKey === "workAuthorization" || mappedKey === "needsSponsorship") {
      parsed[mappedKey] = toBoolean(value);
      continue;
    }

    parsed[mappedKey] = value;
  }

  return parsed;
}

function extractUrls(combinedText) {
  const urls = Array.from(new Set(String(combinedText || "").match(/https?:\/\/[^\s)]+/gi) || []));

  const linkedInUrl = urls.find((url) => /linkedin\.com/i.test(url)) || "";
  const githubUrl = urls.find((url) => /github\.com/i.test(url)) || "";
  const websiteUrl =
    urls.find((url) => !/linkedin\.com|github\.com/i.test(url)) || "";

  return {
    linkedInUrl,
    githubUrl,
    websiteUrl,
  };
}

function normalizeFacts(facts) {
  const fullName = sanitizeLineValue(facts.fullName);
  const { firstName, lastName } = deriveNames(fullName, facts.firstName, facts.lastName);

  const normalized = {
    fullName: inferFullName(firstName, lastName, fullName),
    firstName: sanitizeLineValue(firstName),
    lastName: sanitizeLineValue(lastName),
    email: sanitizeEmail(facts.email),
    phone: sanitizeLineValue(facts.phone),
    linkedInUrl: sanitizeLineValue(facts.linkedInUrl),
    githubUrl: sanitizeLineValue(facts.githubUrl),
    websiteUrl: sanitizeLineValue(facts.websiteUrl),
    location: sanitizeLineValue(facts.location),
    city: sanitizeLineValue(facts.city),
    state: sanitizeLineValue(facts.state),
    country: sanitizeLineValue(facts.country),
    salaryExpectation: sanitizeLineValue(facts.salaryExpectation),
    currentCompany: sanitizeLineValue(facts.currentCompany),
    currentRole: sanitizeLineValue(facts.currentRole),
    coverLetterText: sanitizeLineValue(facts.coverLetterText),
    workAuthorization: typeof facts.workAuthorization === "boolean" ? facts.workAuthorization : null,
    needsSponsorship: typeof facts.needsSponsorship === "boolean" ? facts.needsSponsorship : null,
    graduationYear: sanitizeLineValue(facts.graduationYear),
    degree: sanitizeLineValue(facts.degree),
    university: sanitizeLineValue(facts.university),
    cgpa: sanitizeLineValue(facts.cgpa),
    education: sanitizeLineValue(facts.education),
    codingExperience: sanitizeLineValue(facts.codingExperience),
    totalExperience: sanitizeLineValue(facts.totalExperience),
    experienceLevel: sanitizeLineValue(facts.experienceLevel),
    typescriptExperience: sanitizeLineValue(facts.typescriptExperience),
    javascriptExperience: sanitizeLineValue(facts.javascriptExperience),
    nodeExperience: sanitizeLineValue(facts.nodeExperience),
    llmExperience: sanitizeLineValue(facts.llmExperience),
    technicalSkills: sanitizeLineValue(facts.technicalSkills),
    noticePeriod: sanitizeLineValue(facts.noticePeriod),
    fresherStatus: sanitizeLineValue(facts.fresherStatus),
    willingToRelocate: sanitizeLineValue(facts.willingToRelocate),
    achievements: sanitizeLineValue(facts.achievements),
    projects: sanitizeLineValue(facts.projects),
    aboutYou: sanitizeLineValue(facts.aboutYou),
    strengths: sanitizeLineValue(facts.strengths),
    weaknesses: sanitizeLineValue(facts.weaknesses),
    whyHireYou: sanitizeLineValue(facts.whyHireYou),
    hobbies: sanitizeLineValue(facts.hobbies),
  };

  return normalized;
}

function extractFacts(documents) {
  const combined = documents.map((document) => document.text).join("\n\n");

  const fromRegex = {
    fullName: extractByRegex(combined, /(?:^|\n)\s*(?:full\s+name|name)\s*[:=-]\s*([^\n]+)/i),
    firstName: extractByRegex(combined, /(?:^|\n)\s*(?:first\s+name|given\s+name)\s*[:=-]\s*([^\n]+)/i),
    lastName: extractByRegex(combined, /(?:^|\n)\s*(?:last\s+name|family\s+name|surname)\s*[:=-]\s*([^\n]+)/i),
    email: sanitizeEmail(extractByRegex(combined, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)),
    phone: extractByRegex(combined, /(\+?\d[\d\s().-]{7,}\d)/),
    location: extractByRegex(combined, /(?:^|\n)\s*location\s*[:=-]\s*([^\n]+)/i),
    city: extractByRegex(combined, /(?:^|\n)\s*city\s*[:=-]\s*([^\n]+)/i),
    state: extractByRegex(combined, /(?:^|\n)\s*state\s*[:=-]\s*([^\n]+)/i),
    country: extractByRegex(combined, /(?:^|\n)\s*country\s*[:=-]\s*([^\n]+)/i),
    salaryExpectation: extractByRegex(combined, /(?:^|\n)\s*salary\s+expectation\s*[:=-]\s*([^\n]+)/i),
    codingExperience: extractByRegex(combined, /(?:^|\n)\s*(?:coding\s+experience|years\s+of\s+coding)\s*[:=-]\s*([^\n]+)/i),
    totalExperience: extractByRegex(combined, /(?:^|\n)\s*(?:total\s+experience|overall\s+experience)\s*[:=-]\s*([^\n]+)/i),
  };

  const keyValues = parseSimpleKeyValues(combined);
  const urls = extractUrls(combined);

  const workAuthorizationLine = extractByRegex(combined, /(?:work\s+authorization|authorized\s+to\s+work)[^\n:=-]*[:=-]\s*([^\n]+)/i);
  const sponsorshipLine = extractByRegex(combined, /(?:visa\s+sponsorship|require\s+visa\s+sponsorship|needs?\s+sponsorship)[^\n:=-]*[:=-]\s*([^\n]+)/i);

  const coverLetterDocument = documents.find((document) => {
    return /cover[-_\s]?letter/i.test(document.source);
  });
  const coverLetterText = coverLetterDocument ? coverLetterDocument.text.slice(0, 3500) : "";

  const merged = {
    ...fromRegex,
    ...urls,
    ...keyValues,
    coverLetterText: coverLetterText || keyValues.coverLetterText || "",
    workAuthorization: keyValues.workAuthorization ?? toBoolean(workAuthorizationLine),
    needsSponsorship: keyValues.needsSponsorship ?? toBoolean(sponsorshipLine),
  };

  return normalizeFacts(merged);
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
        answer: sanitizeLineValue(qaMatch[2]).slice(0, 1600),
      });
      qaMatch = qaRegex.exec(text);
    }

    const compactLines = text.split(/\r?\n/);
    for (const line of compactLines) {
      const compactMatch = line.match(/^\s*([^:]{8,120})\s*::\s*(.{3,})$/);
      if (!compactMatch) {
        continue;
      }

      pairs.push({
        source: document.source,
        question: sanitizeLineValue(compactMatch[1]),
        answer: sanitizeLineValue(compactMatch[2]).slice(0, 1000),
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
  return parsed.text || "";
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
      facts: {},
      answerBank: [],
      chunks: [],
      files: [],
    };
  }

  getProfile() {
    return this.profile;
  }

  async reload() {
    const files = [];

    try {
      await walkFiles(PROFILE_DIR, files);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        this.profile = {
          loadedAt: new Date().toISOString(),
          facts: {},
          answerBank: [],
          chunks: [],
          files: [],
        };
        return this.profile;
      }
      throw error;
    }

    const documents = [];
    const fileSummaries = [];

    for (const filePath of files) {
      const extension = path.extname(filePath).toLowerCase();
      const relativePath = path.relative(PROFILE_DIR, filePath);

      if (!TEXT_EXTENSIONS.has(extension) && !PDF_EXTENSIONS.has(extension)) {
        continue;
      }

      let content = "";
      let type = "text";

      try {
        if (PDF_EXTENSIONS.has(extension)) {
          type = "pdf";
          content = await readPdfDocument(filePath);
        } else {
          content = await readTextDocument(filePath);
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

      const trimmedContent = String(content || "").trim();

      fileSummaries.push({
        source: relativePath,
        type,
        status: trimmedContent ? "ok" : "empty",
      });

      if (!trimmedContent) {
        continue;
      }

      documents.push({
        source: relativePath,
        type,
        text: trimmedContent,
      });
    }

    const facts = extractFacts(documents);
    const answerBank = extractAnswerBank(documents);
    const chunks = buildChunks(documents);

    this.profile = {
      loadedAt: new Date().toISOString(),
      facts,
      answerBank,
      chunks,
      files: fileSummaries,
    };

    return this.profile;
  }
}

module.exports = {
  ProfileStore,
};

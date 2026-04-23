"use strict";

const {
  chooseOption,
  normalizeText,
  toBoolean,
} = require("./text-utils");

const KEYWORD_GROUPS = {
  firstName: ["first name", "given name", "forename", "your first", "given"],
  lastName: ["last name", "family name", "surname", "your last", "family", "surname"],
  fullName: ["full name", "legal name", "your name", "name", "fullname", "your full"],
  email: ["email", "e-mail", "email address", "mail id", "your email"],
  phone: ["phone", "mobile", "telephone", "cell", "contact number", "phone number", "phone"],
  location: ["location", "where are you based", "current location", "address", "your location", "base location", "locate me"],
  city: ["city", "town", "current city", "location (city)"],
  state: ["state", "province", "region"],
  country: ["country", "nation", "nationality", "country of origin"],
  linkedInUrl: ["linkedin", "linkedin profile", "linkedin url"],
  githubUrl: ["github", "github profile", "github url"],
  websiteUrl: ["website", "portfolio", "personal site"],
  salaryExpectation: ["salary", "compensation", "expected pay", "expected ctc", "ctc", "expected salary", "expected ctc", "expected"],
  currentCTC: ["current ctc", "current salary", "current compensation", "present ctc"],
  needsSponsorship: ["visa sponsorship", "require sponsorship", "sponsorship", "need visa"],
  coverLetterText: ["cover letter", "cover letter text", "tell us about yourself"],
  codingExperience: ["coding experience", "programming experience", "development experience", "years of coding", "years of programming"],
  experienceLevel: ["experience level", "years of experience", "total years", "professional experience", "total experience", "years of professional"],
  typescriptExperience: ["typescript experience", "typescript", "ts experience", "years of typescript", "typescript exp"],
  javascriptExperience: ["javascript experience", "javascript", "js experience", "years of javascript"],
  nodeExperience: ["node.js experience", "nodejs experience", "node experience", "years with node", "node.js", "node js", "years of node"],
  llmExperience: ["llm experience", "ai experience", "llm apis", "openai experience", "ai apis", "years of ai"],
  totalExperience: ["total experience", "overall experience"],
  fresherStatus: ["fresh graduate", "fresher", "recent graduate", "new graduate"],
  education: ["college", "university", "institute", "institution", "degree", "cgpa", "education", "qualification"],
  degree: ["degree", "qualification", "highest qualification", "education"],
  university: ["university", "college name", "institution name"],
  technicalSkills: ["technical skills", "skills", "programming languages", "tech stack"],
  resume: ["resume", "cv", "upload resume", "attach resume", "resume/cv", "attach"],
  coverLetter: ["cover letter", "attach cover letter", "upload cover letter"],
  noticePeriod: ["notice period", "last working day", "availability", "when can you start", "serve notice", "serving notice"],
  achievements: ["achievements", "awards", "honors"],
  projects: ["projects", "portfolio"],
  aboutYou: ["about yourself", "tell me about yourself", "describe yourself"],
  strengths: ["strengths", "your strengths"],
  whyHireYou: ["why should we hire you", "why hire you"],
  hobbies: ["hobbies", "interests"],
  currentCompany: ["current company", "current organization", "present company"],
  graduationYear: ["graduation year", "passing year", "year of graduation"],
  relocate: ["relocate", "willing to relocate", "relocate to", "relocation"],
  willingToRelocate: ["willing to relocate", "relocate to delhi", "relocate to ncr", "relocate", "willing to reloc", "are you living in delhi", "relocating"],
  fresherStatus: ["fresher", "fresh graduate", "new graduate", "recent graduate", "no experience", "0 years", "years of experience"],
  graduateYear: ["graduation year", "passing year", "year of graduation", "will graduate", "expected to graduate", "completing"],
};

function fieldLabel(field) {
  return [field.label, field.name, field.placeholder, field.description]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join(" ");
}

function includesAny(target, patterns) {
  const normalized = normalizeText(target);
  return patterns.some((pattern) => normalized.includes(normalizeText(pattern)));
}

function mapFieldToFact(field) {
  const target = fieldLabel(field);

  for (const [factKey, patterns] of Object.entries(KEYWORD_GROUPS)) {
    if (includesAny(target, patterns)) {
      return factKey;
    }
  }

  return null;
}

function resolveBooleanField(field, factValue) {
  if (typeof factValue !== "boolean") {
    return null;
  }

  const boolAsText = factValue ? "Yes" : "No";

  if (field.type === "checkbox") {
    return factValue;
  }

  if (field.type === "radio" || field.type === "select") {
    const option = chooseOption(boolAsText, field.options);
    return option;
  }

  if (field.type === "text" || field.type === "textarea") {
    return boolAsText;
  }

  return boolAsText;
}

function resolveOptionField(field, factValue) {
  if (!Array.isArray(field.options) || !field.options.length) {
    return null;
  }

  const option = chooseOption(factValue, field.options);
  if (option !== null) {
    return option;
  }

  const boolValue = toBoolean(factValue);
  if (boolValue !== null) {
    const boolOption = chooseOption(boolValue ? "yes" : "no", field.options);
    if (boolOption !== null) {
      return boolOption;
    }
  }

  return null;
}

function normalizeForFieldType(field, value) {
  const type = String(field.type || "").toLowerCase();

  if (value === null || typeof value === "undefined") {
    return null;
  }

  if (type === "checkbox") {
    const boolValue = toBoolean(value);
    if (boolValue === null) {
      return null;
    }
    return boolValue;
  }

  if (type === "select" || type === "radio") {
    return resolveOptionField(field, value);
  }

  const stringValue = String(value).trim();
  return stringValue || null;
}

function resolveDeterministic(fields, facts, answerMemory) {
  const filled = [];
  const unresolved = [];

  for (const field of fields) {
    const memoryValue = answerMemory.get(field.fingerprint);
    if (typeof memoryValue !== "undefined") {
      const normalizedMemory = normalizeForFieldType(field, memoryValue);
      if (normalizedMemory !== null) {
        filled.push({
          fieldId: field.id,
          value: normalizedMemory,
          confidence: 0.96,
          source: "memory",
          reason: "Matched from your previous approved answer.",
        });
        continue;
      }
    }

    const factKey = mapFieldToFact(field);
    if (!factKey) {
      unresolved.push(field);
      continue;
    }

    const factValue = facts[factKey];

    if (factKey === "workAuthorization" || factKey === "needsSponsorship") {
      const boolResolved = resolveBooleanField(field, factValue);
      if (boolResolved !== null) {
        filled.push({
          fieldId: field.id,
          value: boolResolved,
          confidence: 0.92,
          source: "facts",
          reason: `Mapped from your ${factKey} profile preference.`,
        });
        continue;
      }
    }

    const normalizedValue = normalizeForFieldType(field, factValue);
    if (normalizedValue !== null) {
      filled.push({
        fieldId: field.id,
        value: normalizedValue,
        confidence: 0.9,
        source: "facts",
        reason: `Mapped from your ${factKey} profile data.`,
      });
      continue;
    }

    unresolved.push(field);
  }

  return {
    filled,
    unresolved,
  };
}

module.exports = {
  resolveDeterministic,
};

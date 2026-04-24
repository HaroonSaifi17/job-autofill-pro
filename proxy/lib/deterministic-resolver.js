"use strict";

const {
  chooseOption,
  normalizeText,
  toBoolean,
} = require("./text-utils");

const FACT_MATCH_RULES = [
  {
    key: "firstName",
    keywords: ["first name", "given name", "forename", "fname"],
  },
  {
    key: "lastName",
    keywords: ["last name", "family name", "surname", "lname"],
  },
  {
    key: "fullName",
    keywords: ["full name", "legal name", "candidate name", "your name"],
  },
  {
    key: "email",
    keywords: ["email", "e-mail", "email address", "mail id"],
  },
  {
    key: "phone",
    keywords: ["phone", "mobile", "telephone", "contact number", "phone number"],
  },
  {
    key: "linkedInUrl",
    keywords: ["linkedin", "linkedin profile", "linkedin url"],
  },
  {
    key: "githubUrl",
    keywords: ["github", "github profile", "github url"],
  },
  {
    key: "websiteUrl",
    keywords: ["website", "portfolio", "personal site", "homepage"],
  },
  {
    key: "location",
    keywords: ["location", "where are you based", "current location", "address"],
  },
  {
    key: "city",
    keywords: ["city", "town", "current city"],
  },
  {
    key: "state",
    keywords: ["state", "province", "region"],
  },
  {
    key: "country",
    keywords: ["country", "nation", "nationality"],
  },
  {
    key: "workAuthorization",
    keywords: ["authorized to work", "work authorization", "work permit"],
  },
  {
    key: "needsSponsorship",
    keywords: ["sponsorship", "visa sponsorship", "need sponsorship", "require sponsorship"],
  },
  {
    key: "salaryExpectation",
    keywords: ["salary expectation", "expected salary", "expected ctc", "compensation"],
  },
  {
    key: "currentCTC",
    keywords: ["current ctc", "current salary", "current compensation"],
  },
  {
    key: "noticePeriod",
    keywords: ["notice period", "availability", "when can you start", "start date"],
  },
  {
    key: "willingToRelocate",
    keywords: ["willing to relocate", "relocate", "relocation"],
  },
  {
    key: "graduationYear",
    keywords: ["graduation year", "year of graduation", "passing year"],
  },
  {
    key: "degree",
    keywords: ["degree", "highest qualification", "education level"],
  },
  {
    key: "university",
    keywords: ["university", "college", "institution"],
  },
  {
    key: "totalExperience",
    keywords: ["total experience", "overall experience", "years of experience"],
  },
  {
    key: "codingExperience",
    keywords: ["coding experience", "programming experience", "development experience"],
  },
  {
    key: "typescriptExperience",
    keywords: ["typescript experience", "years of typescript"],
  },
  {
    key: "javascriptExperience",
    keywords: ["javascript experience", "years of javascript"],
  },
  {
    key: "nodeExperience",
    keywords: ["node experience", "node.js experience", "nodejs experience"],
  },
  {
    key: "llmExperience",
    keywords: ["llm experience", "ai experience", "genai experience"],
  },
  {
    key: "technicalSkills",
    keywords: ["technical skills", "skills", "tech stack", "programming languages"],
  },
  {
    key: "aboutYou",
    keywords: ["about yourself", "about you", "bio", "summary"],
  },
  {
    key: "projects",
    keywords: ["projects", "project highlights"],
  },
  {
    key: "achievements",
    keywords: ["achievements", "awards", "honors"],
  },
  {
    key: "strengths",
    keywords: ["strengths", "core strengths"],
  },
  {
    key: "weaknesses",
    keywords: ["weaknesses"],
  },
  {
    key: "whyHireYou",
    keywords: ["why should we hire you", "why hire you"],
  },
  {
    key: "hobbies",
    keywords: ["hobbies", "interests"],
  },
  {
    key: "coverLetterText",
    keywords: ["cover letter", "motivation", "why this role"],
  },
];

const BOOLEAN_FACT_KEYS = new Set([
  "workAuthorization",
  "needsSponsorship",
]);

function fieldContext(field) {
  const optionsText = Array.isArray(field.options)
    ? field.options
        .map((option) => {
          if (option && typeof option === "object") {
            return `${option.label || ""} ${option.value || ""}`;
          }
          return String(option || "");
        })
        .join(" ")
    : "";

  return [
    field.label,
    field.name,
    field.placeholder,
    field.description,
    optionsText,
  ]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join(" ");
}

function includesAny(text, patterns) {
  const target = normalizeText(text);
  if (!target) {
    return false;
  }

  return patterns.some((pattern) => target.includes(normalizeText(pattern)));
}

function mapFieldToFactKey(field) {
  const context = fieldContext(field);

  for (const rule of FACT_MATCH_RULES) {
    if (includesAny(context, rule.keywords)) {
      return rule.key;
    }
  }

  return null;
}

function normalizeOptionValue(field, rawValue) {
  if (!Array.isArray(field.options) || !field.options.length) {
    return null;
  }

  const option = chooseOption(rawValue, field.options);
  if (option !== null) {
    return option;
  }

  const boolValue = toBoolean(rawValue);
  if (boolValue !== null) {
    const boolOption = chooseOption(boolValue ? "yes" : "no", field.options);
    if (boolOption !== null) {
      return boolOption;
    }
  }

  return null;
}

function normalizeValueForFieldType(field, value) {
  const type = String(field.type || "").toLowerCase();

  if (value === null || typeof value === "undefined") {
    return null;
  }

  if (type === "checkbox") {
    return toBoolean(value);
  }

  if (type === "radio" || type === "select") {
    return normalizeOptionValue(field, value);
  }

  const text = String(value).trim();
  return text || null;
}

function confidenceForFact(factKey, normalizedValue) {
  if (BOOLEAN_FACT_KEYS.has(factKey)) {
    return 0.93;
  }

  if (typeof normalizedValue === "string" && normalizedValue.length >= 5) {
    return 0.9;
  }

  return 0.88;
}

function resolveDeterministic(fields, facts, answerMemory) {
  const filled = [];
  const unresolved = [];

  for (const field of fields) {
    const memoryValue = answerMemory.get(field.fingerprint);
    if (typeof memoryValue !== "undefined") {
      const normalizedMemory = normalizeValueForFieldType(field, memoryValue);
      if (normalizedMemory !== null) {
        filled.push({
          fieldId: field.id,
          value: normalizedMemory,
          confidence: 0.97,
          source: "memory",
          reason: "Matched from previous approved answer memory.",
        });
        continue;
      }
    }

    const factKey = mapFieldToFactKey(field);
    if (!factKey) {
      unresolved.push(field);
      continue;
    }

    const factValue = facts[factKey];
    const normalizedValue = normalizeValueForFieldType(field, factValue);
    if (normalizedValue === null) {
      unresolved.push(field);
      continue;
    }

    filled.push({
      fieldId: field.id,
      value: normalizedValue,
      confidence: confidenceForFact(factKey, normalizedValue),
      source: "facts",
      reason: `Mapped from profile field: ${factKey}`,
    });
  }

  return {
    filled,
    unresolved,
  };
}

module.exports = {
  resolveDeterministic,
};

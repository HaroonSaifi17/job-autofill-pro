"use strict";

const { chooseOption, clamp } = require("./text-utils");
const { buildQuestionText } = require("./retrieval");

const RESPONSE_SCHEMA = {
  name: "job_application_answers",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            fieldId: { type: "string" },
            answer: {
              oneOf: [
                { type: "string" },
                { type: "boolean" },
                { type: "null" },
              ],
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            reason: { type: "string" },
          },
          required: ["fieldId", "answer", "confidence", "reason"],
        },
      },
    },
    required: ["answers"],
  },
};

function truncate(value, max = 700) {
  const text = String(value || "").trim();
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 3)}...`;
}

function compactObject(source) {
  if (!source || typeof source !== "object") {
    return {};
  }

  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || typeof value === "undefined") {
      continue;
    }

    if (typeof value === "string" && !value.trim()) {
      continue;
    }

    if (Array.isArray(value) && !value.length) {
      continue;
    }

    out[key] = value;
  }

  return out;
}

function toAiField(field) {
  const options = Array.isArray(field.options)
    ? field.options.slice(0, 40)
      .map((option) => {
        if (option && typeof option === "object") {
          return {
            label: String(option.label || option.value || ""),
            value: String(option.value || option.label || ""),
          };
        }

        const text = String(option || "");
        return {
          label: text,
          value: text,
        };
      })
      .filter((option) => option.label || option.value)
    : [];

  return compactObject({
    fieldId: field.id,
    label: field.label || "",
    name: field.name || "",
    type: field.type || "text",
    required: !!field.required,
    placeholder: field.placeholder || "",
    description: field.description || "",
    options,
  });
}

function sanitizeAiAnswer(field, candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  if (!candidate.fieldId || candidate.fieldId !== field.id) {
    return null;
  }

  const confidence = clamp(Number(candidate.confidence || 0), 0, 1);
  let answer = candidate.answer;

  if (field.type === "checkbox") {
    if (typeof answer !== "boolean") {
      const text = String(answer || "").toLowerCase().trim();
      if (["true", "yes", "1", "checked", "accept", "confirm", "y"].includes(text)) {
        answer = true;
      } else if (["false", "no", "0", "unchecked", "n"].includes(text)) {
        answer = false;
      } else {
        return null;
      }
    }
  } else if (field.type === "select" || field.type === "radio") {
    const option = chooseOption(answer, field.options);
    if (option === null) {
      return null;
    }
    answer = option;
  } else if (typeof answer === "string") {
    answer = answer.trim();
    if (!answer) {
      return null;
    }
  } else if (typeof answer === "boolean") {
    answer = answer ? "Yes" : "No";
  } else {
    return null;
  }

  return {
    fieldId: field.id,
    value: answer,
    confidence,
    source: "ai",
    reason: truncate(candidate.reason || "Generated from profile context and prior answers."),
  };
}

function compactFacts(facts) {
  return compactObject({
    fullName: facts.fullName || "",
    firstName: facts.firstName || "",
    lastName: facts.lastName || "",
    email: facts.email || "",
    phone: facts.phone || "",
    linkedInUrl: facts.linkedInUrl || "",
    githubUrl: facts.githubUrl || "",
    websiteUrl: facts.websiteUrl || "",
    location: facts.location || "",
    city: facts.city || "",
    state: facts.state || "",
    country: facts.country || "",
    workAuthorization: typeof facts.workAuthorization === "boolean" ? facts.workAuthorization : null,
    needsSponsorship: typeof facts.needsSponsorship === "boolean" ? facts.needsSponsorship : null,
    noticePeriod: facts.noticePeriod || "",
    salaryExpectation: facts.salaryExpectation || "",
    currentCTC: facts.currentCTC || "",
    totalExperience: facts.totalExperience || "",
    codingExperience: facts.codingExperience || "",
    typescriptExperience: facts.typescriptExperience || "",
    javascriptExperience: facts.javascriptExperience || "",
    nodeExperience: facts.nodeExperience || "",
    llmExperience: facts.llmExperience || "",
    technicalSkills: facts.technicalSkills || "",
    degree: facts.degree || "",
    university: facts.university || "",
    graduationYear: facts.graduationYear || "",
    fresherStatus: facts.fresherStatus || "",
    willingToRelocate: facts.willingToRelocate || "",
    aboutYou: truncate(facts.aboutYou || "", 1200),
    projects: truncate(facts.projects || "", 1200),
    achievements: truncate(facts.achievements || "", 1200),
    strengths: truncate(facts.strengths || "", 700),
    weaknesses: truncate(facts.weaknesses || "", 700),
    whyHireYou: truncate(facts.whyHireYou || "", 700),
    hobbies: truncate(facts.hobbies || "", 500),
  });
}

function buildPromptContext(profile, unresolvedFields, context, runtimeContext) {
  const facts = profile.facts || {};

  const formUrl = runtimeContext && runtimeContext.url ? runtimeContext.url : "";
  const host = (() => {
    if (!formUrl) {
      return "unknown";
    }
    try {
      return new URL(formUrl).hostname;
    } catch {
      return "unknown";
    }
  })();

  return {
    target: {
      site: host,
      formUrl,
      jobTitle:
        runtimeContext && (runtimeContext.title || runtimeContext.jobTitle)
          ? String(runtimeContext.title || runtimeContext.jobTitle)
          : "",
      company:
        runtimeContext && (runtimeContext.company || runtimeContext.employer)
          ? String(runtimeContext.company || runtimeContext.employer)
          : "",
    },
    candidateProfile: compactFacts(facts),
    unresolvedFields: unresolvedFields.map(toAiField),
    contextChunks: (context.chunks || [])
      .map((chunk) => compactObject({
        source: chunk.source,
        text: truncate(chunk.text, 900),
      }))
      .filter((chunk) => Object.keys(chunk).length),
    answerBank: (context.answers || [])
      .map((entry) => compactObject({
        source: entry.source,
        question: entry.question,
        answer: truncate(entry.answer, 900),
      }))
      .filter((entry) => Object.keys(entry).length),
  };
}

function buildSystemMessage() {
  return [
    "You write strong job-application answers using only provided data.",
    "Never invent facts. If evidence is missing, return answer null.",
    "Keep factual fields concise and direct. For behavioral/project prompts, use action + impact in 1-3 sentences.",
    "For select/radio, pick one valid option value. For checkbox, return boolean.",
    "Use professional tone and avoid filler phrases.",
    "Return strict JSON that matches the schema.",
  ].join(" ");
}

function buildUserMessage(payload) {
  return JSON.stringify(payload);
}

function filterByConfidence(items, minConfidence) {
  const accepted = [];
  const unresolved = [];

  for (const item of items) {
    if (!item) {
      continue;
    }

    if (item.confidence >= minConfidence) {
      accepted.push(item);
    }
  }

  return { accepted, unresolved };
}

async function resolveWithAi(client, profile, unresolvedFields, context, runtimeContext) {
  if (!Array.isArray(unresolvedFields) || !unresolvedFields.length) {
    return {
      filled: [],
      unresolvedAfterAi: [],
      model: null,
      raw: null,
    };
  }

  const payload = buildPromptContext(profile, unresolvedFields, context, runtimeContext);
  const messages = [
    { role: "system", content: buildSystemMessage() },
    { role: "user", content: buildUserMessage(payload) },
  ];

  const completion = await client.completeStructured(messages, RESPONSE_SCHEMA);
  const rawAnswers = Array.isArray(completion.parsed && completion.parsed.answers)
    ? completion.parsed.answers
    : [];

  const answerByFieldId = new Map();
  for (const answer of rawAnswers) {
    if (answer && answer.fieldId) {
      answerByFieldId.set(answer.fieldId, answer);
    }
  }

  const normalizedAnswers = [];

  for (const field of unresolvedFields) {
    const candidate = answerByFieldId.get(field.id);
    const normalized = sanitizeAiAnswer(field, candidate);

    if (normalized) {
      normalizedAnswers.push(normalized);
    }
  }

  const { accepted } = filterByConfidence(normalizedAnswers, 0.45);

  const acceptedFieldIds = new Set(accepted.map((item) => item.fieldId));
  const unresolvedAfterAi = [];
  for (const field of unresolvedFields) {
    if (!acceptedFieldIds.has(field.id)) {
      unresolvedAfterAi.push(field);
    }
  }

  return {
    filled: accepted,
    unresolvedAfterAi,
    model: completion.model,
    raw: completion.parsed,
  };
}

function createQuestionSummary(fields) {
  return fields.map((field) => ({
    fieldId: field.id,
    question: buildQuestionText(field),
  }));
}

module.exports = {
  createQuestionSummary,
  resolveWithAi,
};

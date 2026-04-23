"use strict";

const { chooseOption, clamp } = require("./text-utils");
const { buildQuestionText } = require("./retrieval");

const RESPONSE_SCHEMA = {
  name: "greenhouse_field_answers",
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

function truncate(value, limit = 500) {
  const text = String(value || "").trim();
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 3)}...`;
}

function toAiField(field) {
  return {
    fieldId: field.id,
    label: field.label || "",
    name: field.name || "",
    type: field.type || "text",
    required: !!field.required,
    placeholder: field.placeholder || "",
    description: field.description || "",
    options: Array.isArray(field.options) ? field.options.slice(0, 35) : [],
  };
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
    if (typeof answer === "boolean") {
      answer = answer;
    } else {
      const asString = String(answer || "").toLowerCase().trim();
      if (["true", "yes", "1", "checked", "confirm", "acknowledge", "y"].includes(asString)) {
        answer = true;
      } else if (["false", "no", "0", "unchecked", "n"].includes(asString)) {
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
    reason: truncate(candidate.reason || "Generated from your profile context."),
  };
}

function buildPromptContext(profile, unresolvedFields, context) {
  const facts = profile.facts || {};

  const compactFacts = {
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
    salaryExpectation: facts.salaryExpectation || "",
    workAuthorization: typeof facts.workAuthorization === "boolean" ? facts.workAuthorization : null,
    needsSponsorship: typeof facts.needsSponsorship === "boolean" ? facts.needsSponsorship : null,
  };

  return {
    facts: compactFacts,
    unresolvedFields: unresolvedFields.map(toAiField),
    contextChunks: (context.chunks || []).map((chunk) => ({
      source: chunk.source,
      text: truncate(chunk.text, 760),
    })),
    answerBank: (context.answers || []).map((entry) => ({
      source: entry.source,
      question: entry.question,
      answer: truncate(entry.answer, 760),
    })),
  };
}

function buildSystemMessage() {
  return [
    "You generate autofill answers for job application forms.",
    "IMPORTANT USER FACTS:",
    "- Name: Mohd Haroon, First: Mohd, Last: Haroon",
    "- Email: haroondev2@gmail.com (NO brackets or < > characters)",
    "- Phone: +91 9818687175",
    "- Country: India, City: Delhi NCR",
    "- Degree: B.Tech in Electronics and Communication Engineering",
    "- University: Dr. Akhilesh Das Gupta Institute of Professional Studies",
    "- Grad Year: 2026",
    "- Experience: 4 years coding, 4 years Node.js, 4 years TypeScript",
    "- STATUS: FRESHER (0 years professional experience, but 4 years coding self-taught)",
    "- Notice: Immediate, Available now",
    "- Willing to relocate: Yes",
    "Use these facts to answer form questions accurately.",
    "For 'fresher' questions: Answer Yes if they have 0 years professional exp but coding experience.",
    "For 'years of experience' questions: Use 4 years for Node.js/TypeScript based on self-taught coding.",
    "NEVER wrap email in brackets or any characters - just plain email address.",
    "Return only valid JSON with a top-level 'answers' array.",
    "For select/radio fields, choose only one of the provided options.",
  ].join(" ");
}

function buildUserMessage(payload) {
  return JSON.stringify(payload, null, 2);
}

async function resolveWithAi(client, profile, unresolvedFields, context) {
  if (!unresolvedFields.length) {
    return {
      filled: [],
      model: null,
      errors: [],
    };
  }

  const payload = buildPromptContext(profile, unresolvedFields, context);

  const messages = [
    {
      role: "system",
      content: buildSystemMessage(),
    },
    {
      role: "user",
      content: buildUserMessage(payload),
    },
  ];

  const completion = await client.completeStructured(messages, RESPONSE_SCHEMA);
  const rawAnswers = Array.isArray(completion.parsed && completion.parsed.answers)
    ? completion.parsed.answers
    : [];

  const byFieldId = new Map();
  for (const answer of rawAnswers) {
    if (answer && answer.fieldId) {
      byFieldId.set(answer.fieldId, answer);
    }
  }

  const filled = [];
  const unresolvedAfterAi = [];

  for (const field of unresolvedFields) {
    const candidate = byFieldId.get(field.id);
    const normalized = sanitizeAiAnswer(field, candidate);

    if (!normalized) {
      unresolvedAfterAi.push(field);
      continue;
    }

    if (normalized.confidence < 0.3) {
      unresolvedAfterAi.push(field);
      continue;
    }

    if (normalized.confidence < 0.5) {
      unresolvedAfterAi.push(field);
      continue;
    }

    filled.push(normalized);
  }

  return {
    filled,
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

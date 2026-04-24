"use strict";

const {
  normalizeText,
  overlapScore,
} = require("./text-utils");

function buildQuestionText(field) {
  const optionsText = Array.isArray(field.options)
    ? field.options
        .map((option) => {
          if (option && typeof option === "object") {
            return `${option.label || ""} ${option.value || ""}`.trim();
          }
          return String(option || "").trim();
        })
        .filter(Boolean)
        .join(" ")
    : "";

  const segments = [
    field.label,
    field.name,
    field.placeholder,
    field.description,
    optionsText,
  ];

  return segments
    .map((segment) => String(segment || "").trim())
    .filter(Boolean)
    .join(" ");
}

function rankItems(query, items, textSelector, minScore = 0.08) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery || !Array.isArray(items)) {
    return [];
  }

  const ranked = [];
  for (const item of items) {
    const text = String(textSelector(item) || "");
    if (!text.trim()) {
      continue;
    }

    const score = overlapScore(normalizedQuery, text);
    if (score >= minScore) {
      ranked.push({
        item,
        score,
      });
    }
  }

  ranked.sort((left, right) => right.score - left.score);
  return ranked;
}

function getRelevantContext(profile, unresolvedFields, chunkLimit = 8, answerLimit = 8) {
  const chunks = Array.isArray(profile.chunks) ? profile.chunks : [];
  const answerBank = Array.isArray(profile.answerBank) ? profile.answerBank : [];
  const questions = Array.isArray(unresolvedFields)
    ? unresolvedFields.map((field) => buildQuestionText(field)).filter(Boolean)
    : [];

  if (!questions.length) {
    return {
      chunks: chunks.slice(0, chunkLimit),
      answers: answerBank.slice(0, answerLimit),
    };
  }

  const chunkScores = new Map();
  const answerScores = new Map();

  for (const question of questions) {
    const rankedChunks = rankItems(question, chunks, (chunk) => chunk.text);
    const rankedAnswers = rankItems(question, answerBank, (entry) => {
      return `${entry.question} ${entry.answer}`;
    });

    for (const ranked of rankedChunks.slice(0, 12)) {
      const key = `${ranked.item.source}::${ranked.item.text.slice(0, 100)}`;
      const previous = chunkScores.get(key);
      if (!previous || ranked.score > previous.score) {
        chunkScores.set(key, ranked);
      }
    }

    for (const ranked of rankedAnswers.slice(0, 12)) {
      const key = `${ranked.item.source}::${normalizeText(ranked.item.question)}`;
      const previous = answerScores.get(key);
      if (!previous || ranked.score > previous.score) {
        answerScores.set(key, ranked);
      }
    }
  }

  const selectedChunks = Array.from(chunkScores.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, chunkLimit)
    .map((entry) => entry.item);

  const selectedAnswers = Array.from(answerScores.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, answerLimit)
    .map((entry) => entry.item);

  return {
    chunks: selectedChunks,
    answers: selectedAnswers,
  };
}

function normalizeFieldFingerprint(field) {
  const optionPart = Array.isArray(field.options)
    ? field.options
        .map((option) => {
          if (option && typeof option === "object") {
            return `${normalizeText(option.label)}:${normalizeText(option.value)}`;
          }
          return normalizeText(option);
        })
        .join("|")
    : "";

  return normalizeText([
    field.name,
    field.label,
    field.type,
    optionPart,
  ].join("::"));
}

module.exports = {
  buildQuestionText,
  getRelevantContext,
  normalizeFieldFingerprint,
};

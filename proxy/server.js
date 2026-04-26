"use strict";

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const dotenv = require("dotenv");
const express = require("express");

const { AnswerMemory } = require("./lib/answer-memory");
const { ApplicationHistory, extractJobInfo } = require("./lib/application-history");
const { resolveWithAi, createQuestionSummary } = require("./lib/ai-resolver");
const { resolveDeterministic } = require("./lib/deterministic-resolver");
const { GitHubModelsClient } = require("./lib/github-models-client");
const { ProfileStore } = require("./lib/profile-store");
const {
  getRelevantContext,
  normalizeFieldFingerprint,
} = require("./lib/retrieval");

dotenv.config();

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const PROFILE_DIR = path.resolve(__dirname, "..", "..", "profile-data");

if (HOST !== "127.0.0.1" && HOST !== "localhost") {
  throw new Error("For safety, HOST must be 127.0.0.1 or localhost.");
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeIncomingField(field, index) {
  const normalized = {
    id: String(field.id || field.name || `field_${index}`),
    name: String(field.name || "").trim(),
    label: String(field.label || "").trim(),
    placeholder: String(field.placeholder || "").trim(),
    description: String(field.description || "").trim(),
    type: String(field.type || "text")
      .trim()
      .toLowerCase(),
    required: !!field.required,
    options: Array.isArray(field.options)
      ? field.options
          .map((option) => {
            if (option && typeof option === "object") {
              return {
                label: String(option.label || option.value || "").trim(),
                value: String(option.value || option.label || "").trim(),
              };
            }
            const value = String(option || "").trim();
            return {
              label: value,
              value,
            };
          })
          .filter((option) => option.label || option.value)
      : [],
  };

  normalized.fingerprint = normalizeFieldFingerprint(normalized);
  return normalized;
}

function sanitizeFields(fields) {
  if (!Array.isArray(fields)) {
    return [];
  }

  const seenIds = new Set();
  const sanitized = [];

  for (let i = 0; i < fields.length; i += 1) {
    const candidate = fields[i] || {};
    const field = sanitizeIncomingField(candidate, i);
    if (!field.id || seenIds.has(field.id)) {
      continue;
    }

    seenIds.add(field.id);
    sanitized.push(field);
  }

  return sanitized;
}

function fingerprintPayload(url, fields) {
  const payload = JSON.stringify({
    url: String(url || ""),
    fields: fields.map((field) => ({
      id: field.id,
      name: field.name,
      label: field.label,
      type: field.type,
      options: field.options,
    })),
  });

  return crypto.createHash("sha256").update(payload).digest("hex");
}

function normalizeSuggestionMap(items) {
  const map = new Map();

  for (const item of items) {
    if (!item || !item.fieldId) {
      continue;
    }

    map.set(item.fieldId, item);
  }

  return map;
}

function findProfileFilePath(kind) {
  const profile = profileStore.getProfile();
  const files = profile.files || [];

  if (kind === "resume") {
    const resumeFiles = files.filter((f) => {
      const name = f.source || "";
      return /resume|cv/i.test(name);
    });
    if (resumeFiles.length) {
      return path.join(PROFILE_DIR, resumeFiles[0].source);
    }
  }

  if (kind === "coverLetter") {
    const coverFiles = files.filter((f) => {
      const name = f.source || "";
      return /cover[-_]?letter/i.test(name);
    });
    if (coverFiles.length) {
      return path.join(PROFILE_DIR, coverFiles[0].source);
    }
  }

  return null;
}

function mergeSuggestions(fields, deterministic, ai, threshold) {
  const combined = [];
  const deterministicMap = normalizeSuggestionMap(deterministic);
  const aiMap = normalizeSuggestionMap(ai);

  for (const field of fields) {
    const deterministicItem = deterministicMap.get(field.id);
    const aiItem = aiMap.get(field.id);

    if (deterministicItem) {
      combined.push({
        fieldId: field.id,
        fingerprint: field.fingerprint,
        source: deterministicItem.source,
        value: deterministicItem.value,
        confidence: deterministicItem.confidence,
        reason: deterministicItem.reason,
        suggested: deterministicItem.confidence >= threshold,
      });
      continue;
    }

    if (aiItem) {
      combined.push({
        fieldId: field.id,
        fingerprint: field.fingerprint,
        source: aiItem.source,
        value: aiItem.value,
        confidence: aiItem.confidence,
        reason: aiItem.reason,
        suggested: aiItem.confidence >= threshold,
      });
      continue;
    }

    combined.push({
      fieldId: field.id,
      fingerprint: field.fingerprint,
      source: "none",
      value: null,
      confidence: 0,
      reason: "No suggestion available.",
      suggested: false,
    });
  }

  return combined;
}

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const answerMemory = new AnswerMemory();
  await answerMemory.load();

  const applicationHistory = new ApplicationHistory();
  await applicationHistory.load();

  const profileStore = new ProfileStore();
  await profileStore.reload();

  const modelsClient = new GitHubModelsClient({
    token: process.env.GITHUB_TOKEN,
  });

  let modelStatus = {
    preferred: ["openai/gpt-5-mini", "openai/gpt-4.1", "openai/gpt-4o"],
    catalogSize: null,
    checkedAt: null,
  };

  try {
    const check = await modelsClient.checkAvailableModels();
    modelsClient.models = check.preferred;
    modelStatus = {
      preferred: check.preferred,
      catalogSize: check.catalogSize,
      checkedAt: nowIso(),
    };
  } catch (error) {
    modelStatus = {
      preferred: modelsClient.models,
      catalogSize: null,
      checkedAt: nowIso(),
      warning: error instanceof Error ? error.message : String(error),
    };
  }

  const responseCache = new Map();

  app.get("/health", (_request, response) => {
    const profile = profileStore.getProfile();
    response.json({
      ok: true,
      service: "autofill-job-proxy",
      startedAt: nowIso(),
      host: HOST,
      port: PORT,
      models: modelStatus,
      profile: {
        loadedAt: profile.loadedAt,
        fileCount: profile.files.length,
        chunkCount: profile.chunks.length,
        answerBankCount: profile.answerBank.length,
      },
      memorySize: answerMemory.entries().length,
      applicationHistorySize: applicationHistory.size(),
    });
  });

  app.post("/reload-profile", async (_request, response) => {
    try {
      const profile = await profileStore.reload();
      response.json({
        ok: true,
        loadedAt: profile.loadedAt,
        files: profile.files,
        chunkCount: profile.chunks.length,
        answerBankCount: profile.answerBank.length,
      });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/remember", async (request, response) => {
    const approvals = Array.isArray(request.body && request.body.approvals)
      ? request.body.approvals
      : [];

    const sanitized = approvals
      .map((entry) => ({
        fingerprint: String(entry.fingerprint || "").trim(),
        value: entry.value,
      }))
      .filter((entry) => entry.fingerprint);

    try {
      await answerMemory.addMany(sanitized);
      response.json({
        ok: true,
        remembered: sanitized.length,
        memorySize: answerMemory.entries().length,
      });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/profile-files", async (_request, response) => {
    try {
      const files = profileStore.getProfile().files || [];
      const resumePath = findProfileFilePath("resume");
      const coverPath = findProfileFilePath("coverLetter");

      response.json({
        ok: true,
        files: files.map((f) => f.source),
        resume: resumePath,
        coverLetter: coverPath,
      });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/check-application", async (request, response) => {
    try {
      const url = String(request.body?.url || "").trim();
      const fields = sanitizeFields(request.body?.fields || []);

      if (!url) {
        response.status(400).json({
          ok: false,
          error: "Missing URL.",
        });
        return;
      }

      const existing = applicationHistory.getApplication(url, fields);
      response.json({
        ok: true,
        alreadyApplied: !!existing,
        application: existing || null,
      });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/record-application", async (request, response) => {
    try {
      const url = String(request.body?.url || "").trim();
      const fields = sanitizeFields(request.body?.fields || []);

      if (!url) {
        response.status(400).json({
          ok: false,
          error: "Missing URL.",
        });
        return;
      }

      await applicationHistory.recordApplication(url, fields);
      response.json({
        ok: true,
        recorded: true,
        historySize: applicationHistory.size(),
      });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/application-history", async (_request, response) => {
    try {
      response.json({
        ok: true,
        applications: applicationHistory.getAll(),
      });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/v1/resolve-form", async (request, response) => {
    const startedAt = Date.now();
    const body = request.body || {};

    const url = String(body.url || "").trim();
    const fields = sanitizeFields(body.fields);

    if (!url) {
      response.status(400).json({
        ok: false,
        error: "Missing form URL.",
      });
      return;
    }

    if (!fields.length) {
      response.status(400).json({
        ok: false,
        error: "No form fields provided.",
      });
      return;
    }

    const confidenceThreshold =
      typeof body.confidenceThreshold === "number"
        ? Math.max(0, Math.min(1, body.confidenceThreshold))
        : 0.7;

    const cacheKey = fingerprintPayload(url, fields);
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < 1000 * 60 * 15) {
      response.json({
        ...cached.payload,
        cached: true,
      });
      return;
    }

    try {
      const profile = profileStore.getProfile();

      const deterministic = resolveDeterministic(
        fields,
        profile.facts,
        answerMemory,
      );
      const retrieval = getRelevantContext(profile, deterministic.unresolved);

      let aiResult = {
        filled: [],
        unresolvedAfterAi: deterministic.unresolved,
        model: null,
      };
      let aiWarning = null;

        if (deterministic.unresolved.length) {
          try {
            aiResult = await resolveWithAi(
              modelsClient,
              profile,
              deterministic.unresolved,
              retrieval,
              { url },
            );
          } catch (error) {
            aiWarning = error instanceof Error ? error.message : String(error);
          }
      }

      const suggestions = mergeSuggestions(
        fields,
        deterministic.filled,
        aiResult.filled,
        confidenceThreshold,
      );

      const unresolvedIds = suggestions
        .filter((suggestion) => !suggestion.suggested)
        .map((suggestion) => suggestion.fieldId);

      const approvedCount = suggestions.filter(
        (suggestion) => suggestion.suggested,
      ).length;
      const elapsedMs = Date.now() - startedAt;

      const payload = {
        ok: true,
        cached: false,
        url,
        modelUsed: aiResult.model,
        profileLoadedAt: profile.loadedAt,
        confidenceThreshold,
        stats: {
          totalFields: fields.length,
          deterministicCount: deterministic.filled.length,
          aiCount: aiResult.filled.length,
          approvedCount,
          unresolvedCount: unresolvedIds.length,
          elapsedMs,
        },
        aiWarning,
        suggestions,
        unresolvedQuestions: createQuestionSummary(
          fields.filter((field) => unresolvedIds.includes(field.id)),
        ),
      };

      responseCache.set(cacheKey, {
        cachedAt: Date.now(),
        payload,
      });

      response.json(payload);
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        details: error && error.details ? error.details : undefined,
      });
    }
  });

  const server = app.listen(PORT, HOST, () => {
    process.stdout.write(`[proxy] listening on http://${HOST}:${PORT}\n`);
    process.stdout.write(
      `[proxy] profile files loaded: ${profileStore.getProfile().files.length}\n`,
    );
    process.stdout.write(
      `[proxy] models: ${modelStatus.preferred.join(", ")}\n`,
    );
  });

  async function shutdown() {
    try {
      await answerMemory.persist();
    } catch (error) {
      process.stderr.write(
        `[proxy] failed to persist memory: ${String(error)}\n`,
      );
    }

    await new Promise((resolve) => server.close(resolve));
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  process.stderr.write(`[proxy] startup error: ${String(error)}\n`);
  process.exit(1);
});

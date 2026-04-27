"use strict";

const dotenv = require("dotenv");
const express = require("express");

const { AnswerMemory } = require("./lib/answer-memory");
const { ApplicationHistory } = require("./lib/application-history");
const { resolveWithAi, createQuestionSummary } = require("./lib/ai-resolver");
const { resolveDeterministic } = require("./lib/deterministic-resolver");
const { GitHubModelsClient } = require("./lib/github-models-client");
const { ProfileStore } = require("./lib/profile-store");
const {
  sanitizeUrl,
  sanitizeFields,
  sanitizeApplicationContext,
  sanitizeConfidenceThreshold,
} = require("./lib/request-sanitizers");
const { makeCacheKey, trimCache } = require("./lib/resolve-cache");
const { mergeSuggestions } = require("./lib/suggestion-merge");
const {
  getRelevantContext,
} = require("./lib/retrieval");

dotenv.config();

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
if (HOST !== "127.0.0.1" && HOST !== "localhost") {
  throw new Error("For safety, HOST must be 127.0.0.1 or localhost.");
}

function nowIso() {
  return new Date().toISOString();
}

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const startedAt = nowIso();

  const answerMemory = new AnswerMemory();
  await answerMemory.load();

  const applicationHistory = new ApplicationHistory();
  await applicationHistory.load();

  const profileStore = new ProfileStore();
  await profileStore.reload();

  let modelsClient = null;

  let modelStatus = {
    preferred: ["openai/gpt-5-mini", "openai/gpt-4.1", "openai/gpt-4o"],
    catalogSize: null,
    checkedAt: null,
  };

  const token = String(process.env.GITHUB_TOKEN || "").trim();
  if (!token) {
    modelStatus = {
      ...modelStatus,
      checkedAt: nowIso(),
      warning: "GITHUB_TOKEN missing; AI model resolution disabled.",
    };
  } else {
    modelsClient = new GitHubModelsClient({ token });

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
  }

  const responseCache = new Map();
  const inflightResolutions = new Map();
  const CACHE_TTL_MS = 1000 * 60 * 15;
  const CACHE_MAX_SIZE = 200;

  function defaultAiResult(unresolvedFields) {
    return {
      filled: [],
      unresolvedAfterAi: Array.isArray(unresolvedFields) ? unresolvedFields : [],
      model: null,
    };
  }

  async function buildResolvePayload(
    url,
    fields,
    context,
    confidenceThreshold,
    profile,
  ) {
    const startedAt = Date.now();
    const deterministic = resolveDeterministic(
      fields,
      profile.facts,
      answerMemory,
    );

    const questionSummaryPromise = Promise.resolve().then(() =>
      createQuestionSummary(fields),
    );

    let aiResult = defaultAiResult(deterministic.unresolved);
    let aiWarning = null;

    if (!modelsClient) {
      aiWarning = "AI resolver unavailable: GITHUB_TOKEN missing.";
    } else if (deterministic.unresolved.length) {
      const retrievalPromise = Promise.resolve().then(() =>
        getRelevantContext(profile, deterministic.unresolved),
      );

      try {
        const retrieval = await retrievalPromise;
        aiResult = await resolveWithAi(
          modelsClient,
          profile,
          deterministic.unresolved,
          retrieval,
          { url, ...context },
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

    const questionLookup = new Map(
      (await questionSummaryPromise).map((item) => [item.fieldId, item.question]),
    );
    const unresolvedQuestions = unresolvedIds
      .map((fieldId) => ({
        fieldId,
        question: questionLookup.get(fieldId) || "",
      }));

    const approvedCount = suggestions.filter(
      (suggestion) => suggestion.suggested,
    ).length;

    return {
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
        elapsedMs: Date.now() - startedAt,
      },
      aiWarning,
      suggestions,
      unresolvedQuestions,
    };
  }

  app.get("/health", (_request, response) => {
    const profile = profileStore.getProfile();
    response.json({
      ok: true,
      service: "autofill-job-proxy",
      startedAt,
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

  app.get("/health", async (_request, response) => {

    try {
      const url = sanitizeUrl(request.body?.url);
      const fields = sanitizeFields(request.body?.fields || []);
      const context = sanitizeApplicationContext(request.body?.applicationContext);

      if (!url) {
        response.status(400).json({
          ok: false,
          error: "Missing URL.",
        });
        return;
      }

      const existing = applicationHistory.getApplication(url, fields, context);
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
      const requestUrl = sanitizeUrl(request.body?.url);
      const url = requestUrl || sanitizeUrl(request.body?.sourceUrl);
      const fields = sanitizeFields(request.body?.fields || []);
      const context = sanitizeApplicationContext(request.body?.applicationContext);

      if (!url) {
        response.status(400).json({
          ok: false,
          error: "Missing URL.",
        });
        return;
      }

      await applicationHistory.recordApplication(url, fields, context);
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
    const body = request.body || {};

    const url = sanitizeUrl(body.url);
    const fields = sanitizeFields(body.fields);
    const context = sanitizeApplicationContext(body.applicationContext);

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

    const confidenceThreshold = sanitizeConfidenceThreshold(body.confidenceThreshold);

    const profile = profileStore.getProfile();

    const cacheKey = makeCacheKey(
      url,
      fields,
      context,
      confidenceThreshold,
      profile.loadedAt,
    );
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      response.json({
        ...cached.payload,
        cached: true,
      });
      return;
    }

    try {
      let inflight = inflightResolutions.get(cacheKey);
      if (!inflight) {
        inflight = buildResolvePayload(
          url,
          fields,
          context,
          confidenceThreshold,
          profile,
        )
          .then((payload) => {
            responseCache.set(cacheKey, {
              cachedAt: Date.now(),
              payload,
            });
            trimCache(responseCache, CACHE_MAX_SIZE);
            return payload;
          })
          .finally(() => {
            inflightResolutions.delete(cacheKey);
          });

        inflightResolutions.set(cacheKey, inflight);
      }

      const payload = await inflight;
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

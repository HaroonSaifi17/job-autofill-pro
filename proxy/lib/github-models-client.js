"use strict";

const { clamp, parseJsonFromModel } = require("./text-utils");

const BASE_URL = "https://models.github.ai";

const DEFAULT_MODELS = ["openai/gpt-5-mini", "openai/gpt-4.1", "openai/gpt-4o"];

const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2026-03-10",
};

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

class HttpError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractTextCompletion(responseBody) {
  if (
    !responseBody ||
    !Array.isArray(responseBody.choices) ||
    !responseBody.choices.length
  ) {
    return "";
  }

  const first = responseBody.choices[0];
  if (!first || !first.message) {
    return "";
  }

  return String(first.message.content || "").trim();
}

class GitHubModelsClient {
  constructor(options) {
    const token = options && options.token ? String(options.token).trim() : "";
    if (!token) {
      throw new Error("GITHUB_TOKEN is missing. Add it to your environment.");
    }

    this.token = token;
    this.models =
      Array.isArray(options.models) && options.models.length
        ? options.models
        : DEFAULT_MODELS;
    this.baseUrl = options.baseUrl || BASE_URL;
  }

  async checkAvailableModels() {
    const response = await fetch(`${this.baseUrl}/catalog/models`, {
      method: "GET",
      headers: {
        ...DEFAULT_HEADERS,
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!response.ok) {
      const payload = await safeJson(response);
      throw new HttpError(
        response.status,
        `Failed to fetch model catalog (${response.status}).`,
        payload,
      );
    }

    const catalog = await response.json();
    const availableIds = new Set(
      Array.isArray(catalog) ? catalog.map((entry) => entry.id) : [],
    );

    const availableModels = this.models.filter((model) =>
      availableIds.has(model),
    );
    const selectedModels = availableModels.length
      ? availableModels
      : this.models;

    return {
      preferred: selectedModels,
      catalogSize: Array.isArray(catalog) ? catalog.length : 0,
    };
  }

  async postCompletion(model, messages, responseFormat) {
    const payload = {
      model,
      messages,
      temperature: 0,
      max_tokens: 1800,
      response_format: responseFormat,
    };

    const response = await fetch(`${this.baseUrl}/inference/chat/completions`, {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const payloadJson = await safeJson(response);
      throw new HttpError(
        response.status,
        `Inference request failed for model ${model} (${response.status}).`,
        payloadJson,
      );
    }

    const body = await response.json();
    const text = extractTextCompletion(body);

    return {
      text,
      raw: body,
    };
  }

  async completeStructured(messages, responseSchema) {
    const responseFormat = {
      type: "json_schema",
      json_schema: responseSchema,
    };

    const errors = [];

    for (const model of this.models) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const completion = await this.postCompletion(
            model,
            messages,
            responseFormat,
          );
          const parsed = parseJsonFromModel(completion.text);

          if (!parsed) {
            throw new Error(`Model ${model} returned invalid JSON output.`);
          }

          return {
            model,
            parsed,
            rawText: completion.text,
          };
        } catch (error) {
          const status =
            error && typeof error.status === "number" ? error.status : null;

          errors.push({
            model,
            attempt: attempt + 1,
            status,
            message: error instanceof Error ? error.message : String(error),
            payload: error && error.payload ? error.payload : null,
          });

          const retriable =
            status === 429 || (status !== null && status >= 500);

          if (!retriable) {
            break;
          }

          const delay = clamp(350 * Math.pow(2, attempt), 350, 2400);
          await wait(delay);
        }
      }
    }

    const tail = errors.slice(-1)[0];
    const reason = tail ? tail.message : "Unknown completion error";
    const failure = new Error(`All model attempts failed: ${reason}`);
    failure.details = errors;
    throw failure;
  }
}

module.exports = {
  GitHubModelsClient,
};

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveWithAi } = require("../proxy/lib/ai-resolver");

function makeField(overrides = {}) {
  return {
    id: "field_1",
    label: "Tell us about yourself",
    name: "about_you",
    type: "text",
    required: true,
    placeholder: "",
    description: "",
    options: [],
    ...overrides,
  };
}

function makeProfile() {
  return {
    facts: {
      fullName: "Jane Doe",
      email: "jane@example.com",
      projects: "Built an internal workflow automation tool.",
      aboutYou: "Backend engineer with 5 years of experience.",
      workAuthorization: true,
      needsSponsorship: false,
    },
  };
}

test("resolveWithAi returns empty payload when no unresolved fields", async () => {
  const client = {
    completeStructured() {
      throw new Error("should not be called");
    },
  };

  const result = await resolveWithAi(client, makeProfile(), [], { chunks: [], answers: [] }, { url: "https://example.com" });

  assert.deepEqual(result, {
    filled: [],
    unresolvedAfterAi: [],
    model: null,
    raw: null,
  });
});

test("resolveWithAi keeps valid answer above confidence threshold", async () => {
  const field = makeField({ id: "q_about" });
  const client = {
    async completeStructured(messages) {
      assert.equal(Array.isArray(messages), true);
      return {
        model: "openai/gpt-5-mini",
        parsed: {
          answers: [
            {
              fieldId: "q_about",
              answer: "I build reliable backend systems and improve developer productivity.",
              confidence: 0.88,
              reason: "Matches profile summary and projects.",
            },
          ],
        },
      };
    },
  };

  const result = await resolveWithAi(
    client,
    makeProfile(),
    [field],
    { chunks: [{ source: "profile.md", text: "Backend experience" }], answers: [] },
    { url: "https://jobs.example.com", title: "Backend Engineer", company: "Example" },
  );

  assert.equal(result.model, "openai/gpt-5-mini");
  assert.equal(result.filled.length, 1);
  assert.equal(result.filled[0].fieldId, "q_about");
  assert.equal(result.filled[0].source, "ai");
  assert.equal(result.unresolvedAfterAi.length, 0);
});

test("resolveWithAi rejects low-confidence answers", async () => {
  const field = makeField({ id: "q_low" });
  const client = {
    async completeStructured() {
      return {
        model: "openai/gpt-5-mini",
        parsed: {
          answers: [
            {
              fieldId: "q_low",
              answer: "Some vague answer",
              confidence: 0.2,
              reason: "Low certainty",
            },
          ],
        },
      };
    },
  };

  const result = await resolveWithAi(
    client,
    makeProfile(),
    [field],
    { chunks: [], answers: [] },
    { url: "https://example.com" },
  );

  assert.equal(result.filled.length, 0);
  assert.equal(result.unresolvedAfterAi.length, 1);
  assert.equal(result.unresolvedAfterAi[0].id, "q_low");
});

test("resolveWithAi normalizes checkbox and select answers", async () => {
  const checkboxField = makeField({ id: "q_checkbox", type: "checkbox", label: "Are you authorized to work?" });
  const selectField = makeField({
    id: "q_select",
    type: "select",
    label: "Preferred location",
    options: [
      { label: "Remote", value: "remote" },
      { label: "Onsite", value: "onsite" },
    ],
  });

  const client = {
    async completeStructured() {
      return {
        model: "openai/gpt-5-mini",
        parsed: {
          answers: [
            {
              fieldId: "q_checkbox",
              answer: "yes",
              confidence: 0.9,
              reason: "Explicitly available in profile.",
            },
            {
              fieldId: "q_select",
              answer: "Remote",
              confidence: 0.91,
              reason: "Best available option.",
            },
          ],
        },
      };
    },
  };

  const result = await resolveWithAi(
    client,
    makeProfile(),
    [checkboxField, selectField],
    { chunks: [], answers: [] },
    { url: "https://example.com" },
  );

  assert.equal(result.filled.length, 2);

  const checkbox = result.filled.find((item) => item.fieldId === "q_checkbox");
  const select = result.filled.find((item) => item.fieldId === "q_select");

  assert.equal(checkbox.value, true);
  assert.equal(select.value, "remote");
});

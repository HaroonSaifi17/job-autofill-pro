"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeFieldType,
  sanitizeIncomingField,
  sanitizeUrl,
  sanitizeFields,
  sanitizeApplicationContext,
  sanitizeConfidenceThreshold,
} = require("../proxy/lib/request-sanitizers");

test("sanitizeUrl keeps http/https and removes hash", () => {
  assert.equal(
    sanitizeUrl("https://boards.greenhouse.io/acme/jobs/123#section"),
    "https://boards.greenhouse.io/acme/jobs/123",
  );
});

test("sanitizeUrl rejects unsupported schemes", () => {
  assert.equal(sanitizeUrl("javascript:alert(1)"), "");
  assert.equal(sanitizeUrl("file:///tmp/form"), "");
});

test("sanitizeUrl trims input and rejects invalid URLs", () => {
  assert.equal(sanitizeUrl("   https://example.com/jobs/123#frag   "), "https://example.com/jobs/123");
  assert.equal(sanitizeUrl("not-a-url"), "");
});

test("normalizeFieldType allows known and defaults unknown types", () => {
  assert.equal(normalizeFieldType("EMAIL"), "email");
  assert.equal(normalizeFieldType("unsupported-type"), "text");
});

test("sanitizeIncomingField normalizes options and creates fingerprint", () => {
  const field = sanitizeIncomingField(
    {
      id: "work_auth",
      type: "select",
      options: [
        { label: "Yes", value: "1" },
        "No",
        "   ",
      ],
    },
    0,
  );

  assert.equal(field.type, "select");
  assert.equal(field.options.length, 2);
  assert.deepEqual(field.options[0], { label: "Yes", value: "1" });
  assert.deepEqual(field.options[1], { label: "No", value: "No" });
  assert.equal(typeof field.fingerprint, "string");
  assert.ok(field.fingerprint.length > 5);
});

test("sanitizeFields normalizes types and deduplicates ids", () => {
  const fields = sanitizeFields([
    { id: "email", label: "Email", type: "EMAIL" },
    { id: "email", label: "Email 2", type: "text" },
    { id: "exp", label: "Years", type: "unknown_type" },
  ]);

  assert.equal(fields.length, 2);
  assert.equal(fields[0].type, "email");
  assert.equal(fields[1].type, "text");
});

test("sanitizeFields falls back to name-based ids", () => {
  const fields = sanitizeFields([
    { name: "candidate_email", label: "Email" },
    { name: "candidate_phone", label: "Phone" },
  ]);

  assert.equal(fields.length, 2);
  assert.equal(fields[0].id, "candidate_email");
  assert.equal(fields[1].id, "candidate_phone");
});

test("sanitizeApplicationContext keeps only title/company", () => {
  const context = sanitizeApplicationContext({
    title: "Senior Engineer",
    employer: "Acme",
    ignored: "value",
  });

  assert.deepEqual(context, {
    title: "Senior Engineer",
    company: "Acme",
  });
});

test("sanitizeApplicationContext supports aliases and trims", () => {
  const context = sanitizeApplicationContext({
    jobTitle: "  Staff Backend Engineer  ",
    company: "  Example Corp  ",
  });

  assert.deepEqual(context, {
    title: "Staff Backend Engineer",
    company: "Example Corp",
  });
});

test("sanitizeConfidenceThreshold clamps and defaults", () => {
  assert.equal(sanitizeConfidenceThreshold(5), 1);
  assert.equal(sanitizeConfidenceThreshold(-5), 0);
  assert.equal(sanitizeConfidenceThreshold("not-a-number"), 0.6);
  assert.equal(sanitizeConfidenceThreshold("0.75"), 0.75);
});

test("sanitizeConfidenceThreshold supports custom fallback", () => {
  assert.equal(sanitizeConfidenceThreshold("invalid", 0.72), 0.72);
});

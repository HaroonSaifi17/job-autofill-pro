"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeJobUrl,
  extractJobInfo,
  normalizeJobKey,
} = require("../proxy/lib/application-history");

test("ApplicationHistory normalizes URLs - same job ID should match", () => {
  // Same job role, different tracking params should match
  const url1 = normalizeJobUrl("https://boards.greenhouse.io/acme/jobs/123?source=Indeed");
  const url2 = normalizeJobUrl("https://boards.greenhouse.io/acme/jobs/123?source=LinkedIn");
  
  assert.equal(url1, url2, "Same job ID with different tracking should normalize to same URL");
});

test("ApplicationHistory normalizes URLs - different job IDs should NOT match", () => {
  // Different job postings should not match
  const url100 = normalizeJobUrl("https://boards.greenhouse.io/acme/jobs/100");
  const url200 = normalizeJobUrl("https://boards.greenhouse.io/acme/jobs/200");
  
  assert.notEqual(url100, url200, "Different job IDs should have different normalized URLs");
});

test("ApplicationHistory normalizes URLs - different jobs with query params", () => {
  const url1 = normalizeJobUrl("https://boards.greenhouse.io/acme/jobs/100?gh_jid=1");
  const url2 = normalizeJobUrl("https://boards.greenhouse.io/acme/jobs/200?gh_jid=2");
  
  assert.notEqual(url1, url2, "Different job posts should not match even with gh_jid");
});

test("ApplicationHistory keeps job-identifying query parameters", () => {
  const normalized = normalizeJobUrl(
    "https://jobs.example.com/openings/abc?utm_source=linkedin&gh_jid=999&ref=campaign",
  );

  assert.equal(normalized, "https://jobs.example.com/openings/abc?gh_jid=999");
});

test("extractJobInfo prefers context over field labels", () => {
  const info = extractJobInfo(
    "https://boards.greenhouse.io/acme/jobs/123",
    [
      { label: "Company", value: "Fallback Company" },
      { label: "Position", value: "Fallback Position" },
    ],
    { company: "Context Company", title: "Context Title" },
  );

  assert.equal(info.company, "context company");
  assert.equal(info.position, "context title");
});

test("normalizeJobKey changes when role context changes", () => {
  const url = "https://boards.greenhouse.io/acme/jobs/123";
  const company = "acme";

  const keyA = normalizeJobKey(url, company, "backend engineer");
  const keyB = normalizeJobKey(url, company, "frontend engineer");

  assert.notEqual(keyA, keyB);
});

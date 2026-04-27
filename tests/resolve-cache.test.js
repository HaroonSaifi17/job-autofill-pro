"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeCacheKey, trimCache } = require("../proxy/lib/resolve-cache");

test("makeCacheKey changes with context and threshold", () => {
  const fields = [{ id: "a", name: "email", label: "Email", type: "email", options: [] }];

  const keyA = makeCacheKey("https://a.com", fields, { title: "Role A" }, 0.7, "t1");
  const keyB = makeCacheKey("https://a.com", fields, { title: "Role B" }, 0.7, "t1");
  const keyC = makeCacheKey("https://a.com", fields, { title: "Role A" }, 0.9, "t1");

  assert.notEqual(keyA, keyB);
  assert.notEqual(keyA, keyC);
});

test("makeCacheKey remains stable for identical input", () => {
  const fields = [
    {
      id: "location",
      name: "location",
      label: "Preferred Location",
      type: "select",
      options: [
        { label: "Remote", value: "remote" },
        { label: "Onsite", value: "onsite" },
      ],
    },
  ];

  const keyA = makeCacheKey("https://jobs.example.com/1", fields, { title: "SWE" }, 0.6, "stamp1");
  const keyB = makeCacheKey("https://jobs.example.com/1", fields, { title: "SWE" }, 0.6, "stamp1");

  assert.equal(keyA, keyB);
});

test("trimCache evicts oldest entries", () => {
  const cache = new Map();
  cache.set("old", { cachedAt: 1 });
  cache.set("mid", { cachedAt: 2 });
  cache.set("new", { cachedAt: 3 });

  trimCache(cache, 2);

  assert.equal(cache.has("old"), false);
  assert.equal(cache.has("mid"), true);
  assert.equal(cache.has("new"), true);
});

test("trimCache does nothing when cache is under limit", () => {
  const cache = new Map();
  cache.set("only", { cachedAt: 10 });

  trimCache(cache, 5);

  assert.equal(cache.size, 1);
  assert.equal(cache.has("only"), true);
});

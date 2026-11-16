import { test } from "node:test";
import assert from "node:assert/strict";
import { actionStep, ago, check, ciSummary, normalize, prState, sortPrs, ticketOf, timeline } from "../model.js";

const node = (over = {}) => ({
  url: "https://github.com/acme/shop/pull/7", number: 7, title: "Retry payments", isDraft: false,
  createdAt: "2026-11-15T10:00:00Z", updatedAt: "2026-11-15T11:00:00Z",
  headRefName: "fix/ABC-123", baseRefName: "main", headRefOid: "abc",
  repository: { nameWithOwner: "acme/shop" }, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
  reviewDecision: null, reviews: { nodes: [] }, reviewThreads: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ name: "unit", status: "COMPLETED", conclusion: "SUCCESS" }] } } } }] },
  additions: 16, deletions: 2, files: { nodes: [{ path: "src/a.go", additions: 14, deletions: 2 }] },
  ...over,
});

test("check: failures, cancelled, running, and status contexts", () => {
  assert.equal(check({ name: "a", status: "COMPLETED", conclusion: "FAILURE" }).status, "failed");
  assert.equal(check({ name: "a", status: "COMPLETED", conclusion: "CANCELLED" }).status, "skipped");
  assert.equal(check({ name: "a", status: "IN_PROGRESS", conclusion: null }).status, "running");
  assert.equal(check({ context: "ci/x", state: "ERROR" }).status, "failed");
  assert.equal(check({ context: "ci/x", state: "SUCCESS", targetUrl: "u" }).url, "u");
});

test("ciSummary counts", () => {
  assert.deepEqual(ciSummary([{ status: "passed" }, { status: "failed" }, { status: "running" }]), { status: "failed", failed: 1, running: 1, passed: 1, total: 3 });
  assert.equal(ciSummary([]).status, "none");
});

test("ticketOf reads branch names", () => {
  assert.equal(ticketOf("fix/ABC-123"), "ABC-123");
  assert.equal(ticketOf("feat/ABC-45-retry"), "ABC-45");
  assert.equal(ticketOf("main"), null);
});

test("normalize: approvals count only on the head commit", () => {
  const pr = normalize(node({ reviews: { nodes: [
    { state: "APPROVED", author: { login: "dana" }, commit: { oid: "abc" }, submittedAt: "2026-11-15T10:30:00Z" },
    { state: "APPROVED", author: { login: "old" }, commit: { oid: "zzz" } },
  ] } }));
  assert.deepEqual(pr.approvedBy.map((a) => a.login), ["dana"]);
  assert.equal(pr.ticket, "ABC-123");
  assert.equal(pr.ci.status, "passed");
});

test("prState follows the sync script's order", () => {
  const s = (over) => prState(normalize(node(over))).label;
  assert.equal(s({ isDraft: true, mergeable: "CONFLICTING" }), "Draft");
  assert.equal(s({ mergeable: "CONFLICTING" }), "Merge conflict");
  assert.equal(s({ commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ name: "u", status: "COMPLETED", conclusion: "FAILURE" }] } } } }] } }), "CI failed");
  assert.equal(s({ reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] } }), "1 open threads");
  assert.equal(s({ reviewDecision: "CHANGES_REQUESTED" }), "Changes requested");
  assert.equal(s({ mergeStateStatus: "BLOCKED" }), "Waiting for review");
  assert.equal(s({ reviews: { nodes: [{ state: "APPROVED", author: { login: "d" }, commit: { oid: "abc" } }] } }), "Ready to merge");
  assert.equal(s({}), "Open");
});

test("merged and closed PRs", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const merged = normalize(node({ state: "MERGED", mergedAt: "2026-11-15T11:59:30Z", mergeable: "CONFLICTING" }));
  assert.equal(prState(merged).label, "Merged");
  assert.deepEqual(timeline(merged, now).at(-1), { label: "Merged → main", sub: "just now", status: "done" });
  assert.equal(prState(normalize(node({ state: "CLOSED" }))).label, "Closed");
});

test("sortPrs: urgent first, then newest", () => {
  const a = normalize(node({ url: "a", updatedAt: "2026-11-15T12:00:00Z" }));
  const b = normalize(node({ url: "b", mergeable: "CONFLICTING" }));
  const c = normalize(node({ url: "c", updatedAt: "2026-11-15T13:00:00Z" }));
  assert.deepEqual(sortPrs([a, b, c]).map((p) => p.key), ["b", "c", "a"]);
});

test("ago and timeline", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  assert.equal(ago("2026-11-15T11:57:00Z", now), "3m ago");
  assert.equal(ago("2026-11-15T09:00:00Z", now), "3h ago");
  const t = timeline(normalize(node()), now);
  assert.deepEqual(t.map((s) => s.label), ["PR opened", "CI passed", "Waiting for review", "Merge into main"]);
  assert.equal(t[1].sub, "1/1 passed");
});

test("timeline before a PR: push, open draft PR, then what comes after", () => {
  const steps = timeline(null, Date.now(), { ahead: 2, base: "develop" });
  assert.deepEqual(steps.map((s) => [s.label, s.status]), [["Push", "todo"], ["Open draft PR", "todo"], ["CI", "todo"], ["Review", "todo"], ["Merge into develop", "todo"]]);
  assert.equal(steps[0].sub, "↑2 not pushed");
  assert.deepEqual(timeline(null, Date.now(), { ahead: 0 })[0], { label: "Pushed", sub: "everything is on GitHub", status: "done" });
});

test("timeline: a clicked push or create shows running, done, or failed with the error", () => {
  const run = timeline(null, Date.now(), { ahead: 1, action: { kind: "push", status: "running", cmd: "git push -u origin HEAD" } });
  assert.deepEqual(run[0], { label: "Push", sub: "git push -u origin HEAD", status: "running" });
  const fail = timeline(null, Date.now(), { action: { kind: "create", status: "failed", cmd: "gh pr create", out: "\npull request create failed: GraphQL: x\nmore" } });
  assert.deepEqual(fail[1], { label: "Open draft PR", sub: "pull request create failed: GraphQL: x", status: "failed", tip: "pull request create failed: GraphQL: x\nmore" });
  const done = actionStep({ kind: "create", status: "done", result: "PR #153 opened" }, "Draft PR opened");
  assert.deepEqual(done, { label: "Draft PR opened", sub: "PR #153 opened", status: "done" });
});

test("timeline with a PR: a later push shows right after PR opened", () => {
  const pr = normalize(node());
  const t = timeline(pr, Date.parse("2026-11-15T12:00:00Z"), { action: { kind: "push", status: "done", result: "pushed 1 commit" } });
  assert.deepEqual(t.slice(0, 2).map((s) => [s.label, s.status]), [["PR opened", "done"], ["Pushed", "done"]]);
  assert.equal(timeline(pr, Date.now(), { ahead: 3 })[1].sub, "↑3 not pushed");
  assert.equal(timeline(pr, Date.now()).length, 4);
});

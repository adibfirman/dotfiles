import { test } from "node:test";
import assert from "node:assert/strict";
import { actionStep, ago, check, checkLine, ciSummary, detailOf, duration, normalize, overview, prState, reviewWord, sortChecks, sortPrs, stateIcon, ticketOf, timeline } from "../model.js";

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

test("check: required and run time come from the detail query", () => {
  const c = check({ name: "sonar", status: "COMPLETED", conclusion: "FAILURE", isRequired: true, startedAt: "2026-11-15T10:00:00Z", completedAt: "2026-11-15T10:00:55Z" });
  assert.deepEqual(c, { name: "sonar", status: "failed", url: null, required: true, seconds: 55 });
  assert.equal(check({ name: "x", status: "IN_PROGRESS" }).required, null);
  assert.equal(checkLine(c), "Failing after 55s");
  assert.equal(checkLine({ status: "passed", seconds: 360 }), "Successful in 6m");
  assert.equal(checkLine({ status: "running", seconds: null }), "Running");
});

test("duration", () => {
  assert.equal(duration(null), "");
  assert.equal(duration(36), "36s");
  assert.equal(duration(3720), "1h 2m");
});

test("normalize: author, labels, comments, changed files", () => {
  const pr = normalize(node({ author: { login: "ridho9" }, labels: { nodes: [{ name: "security", color: "d73a4a" }] }, totalCommentsCount: 3, changedFiles: 28 }));
  assert.equal(pr.author, "ridho9");
  assert.deepEqual(pr.labels, [{ name: "security", color: "d73a4a" }]);
  assert.equal(pr.comments, 3);
  assert.equal(pr.changedFiles, 28);
  assert.equal(normalize(node()).changedFiles, 1);
});

test("detailOf and overview: required failing first, unresolved threads, pending reviewers", () => {
  const d = detailOf({
    head: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
      { name: "test", status: "COMPLETED", conclusion: "SUCCESS", isRequired: false },
      { name: "gitar", status: "COMPLETED", conclusion: "SUCCESS", isRequired: false },
      { name: "sonar", status: "COMPLETED", conclusion: "FAILURE", isRequired: true },
    ] } } } }] },
    commitList: { totalCount: 7, nodes: [{ commit: { oid: "a1", messageHeadline: "feat: x", committedDate: "2026-11-15T10:00:00Z", author: { name: "Adib", user: { login: "adib" } } } }] },
    files: { nodes: [{ path: "a.go", additions: 1, deletions: 0 }] }, changedFiles: 28,
    reviewRequests: { nodes: [{ requestedReviewer: { login: "dana" } }] },
  });
  assert.equal(d.commitCount, 7);
  assert.deepEqual(d.commits[0], { oid: "a1", title: "feat: x", at: "2026-11-15T10:00:00Z", author: "adib" });
  assert.equal(d.fileCount, 28);
  assert.deepEqual(d.pendingReviewers, ["dana"]);
  const o = overview(normalize(node({ reviewThreads: { nodes: [{ isResolved: false }] } })), d);
  assert.equal(o.checks.sub, "1 required failing");
  assert.deepEqual(o.checks.bar, ["good", "good", "bad"]);
  assert.equal(o.comments.sub, "1 unresolved");
  assert.equal(o.approvals.sub, "1 pending");
  assert.deepEqual(sortChecks(d.checks).map((c) => c.name), ["sonar", "test", "gitar"]);
});

test("stateIcon and reviewWord", () => {
  assert.equal(stateIcon(normalize(node({ state: "MERGED" }))).kind, "merged");
  assert.equal(stateIcon(normalize(node({ isDraft: true }))).label, "Draft");
  assert.equal(reviewWord(normalize(node({ reviewDecision: "CHANGES_REQUESTED" }))), "Changes requested");
  assert.equal(reviewWord(normalize(node())), "");
});

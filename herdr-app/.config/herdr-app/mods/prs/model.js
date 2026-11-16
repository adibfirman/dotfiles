// Pure PR logic for the prs mod: no herdr imports, so `node --test` can load it.
// The state rules follow herdr/.config/herdr/scripts/sync-all-pr-worktree-labels.

// CANCELLED is not a failure: a newer run often cancels the old one.
const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
const FAILED_STATES = new Set(["FAILURE", "ERROR"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);

/** One check (a CheckRun or a StatusContext) as { name, status: "passed" | "failed" | "running" | "skipped", url }. */
export function check(c) {
  const name = c.name ?? c.context ?? "check";
  const url = c.detailsUrl ?? c.targetUrl ?? null;
  const conclusion = String(c.conclusion ?? "").toUpperCase();
  const state = String(c.state ?? c.status ?? "").toUpperCase();
  if (FAILED_CONCLUSIONS.has(conclusion) || FAILED_STATES.has(state)) return { name, status: "failed", url };
  if (conclusion === "SUCCESS" || state === "SUCCESS") return { name, status: "passed", url };
  if (["SKIPPED", "NEUTRAL", "CANCELLED", "STALE"].includes(conclusion)) return { name, status: "skipped", url };
  if (PENDING_STATES.has(state) || (!conclusion && state !== "COMPLETED")) return { name, status: "running", url };
  return { name, status: "passed", url };
}

/** All checks of a PR as one word, with counts. */
export function ciSummary(checks) {
  const n = (s) => checks.filter((c) => c.status === s).length;
  const failed = n("failed"), running = n("running"), passed = n("passed");
  const status = !checks.length ? "none" : failed ? "failed" : running ? "running" : "passed";
  return { status, failed, running, passed, total: checks.length };
}

/** A ticket key from a branch name like fix/ABC-123 or feat/ABC-123-retry. */
export function ticketOf(branch) {
  return /([A-Z][A-Z0-9]+-\d+)/.exec(branch ?? "")?.[1] ?? null;
}

/** A GraphQL pullRequest node as a flat PR object. */
export function normalize(node) {
  const contexts = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const checks = contexts.map(check);
  const reviews = node.reviews?.nodes ?? [];
  const approvals = reviews.filter((r) => r.state === "APPROVED" && r.commit?.oid === node.headRefOid);
  return {
    key: node.url,
    url: node.url,
    number: node.number,
    title: node.title,
    repo: node.repository?.nameWithOwner ?? "",
    draft: Boolean(node.isDraft),
    state: node.state ?? "OPEN",
    mergedAt: node.mergedAt ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    head: node.headRefName,
    base: node.baseRefName,
    ticket: ticketOf(node.headRefName) ?? ticketOf(node.title),
    mergeable: node.mergeable ?? "UNKNOWN",
    mergeState: node.mergeStateStatus ?? "UNKNOWN",
    reviewDecision: node.reviewDecision ?? null,
    approvedBy: approvals.map((r) => ({ login: r.author?.login ?? "someone", at: r.submittedAt })),
    unresolved: (node.reviewThreads?.nodes ?? []).filter((t) => !t.isResolved).length,
    checks,
    ci: ciSummary(checks),
    additions: node.additions ?? 0,
    deletions: node.deletions ?? 0,
    files: (node.files?.nodes ?? []).map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
  };
}

/**
 * What the PR needs next, in the sync script's order. rank: lower comes first in the list.
 * kind picks the color: bad, wait, good, idle.
 */
export function prState(pr) {
  if (pr.state === "MERGED") return { label: "Merged", kind: "good", rank: 7 };
  if (pr.state === "CLOSED") return { label: "Closed", kind: "idle", rank: 8 };
  if (pr.draft) return { label: "Draft", kind: "idle", rank: 6 };
  if (pr.mergeable === "CONFLICTING") return { label: "Merge conflict", kind: "bad", rank: 0 };
  if (pr.ci.status === "failed") return { label: "CI failed", kind: "bad", rank: 1 };
  if (pr.unresolved > 0 || pr.reviewDecision === "CHANGES_REQUESTED") return { label: pr.reviewDecision === "CHANGES_REQUESTED" ? "Changes requested" : `${pr.unresolved} open threads`, kind: "bad", rank: 2 };
  if (pr.mergeState === "BLOCKED") return { label: pr.approvedBy.length ? "Blocked" : "Waiting for review", kind: "wait", rank: 3 };
  if (pr.approvedBy.length) return { label: "Ready to merge", kind: "good", rank: 4 };
  return { label: pr.ci.status === "running" ? "CI running" : "Open", kind: "idle", rank: 5 };
}

/** Most urgent first, then the most recently updated. */
export function sortPrs(prs) {
  return [...prs].sort((a, b) => prState(a).rank - prState(b).rank || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** "just now", "3m ago", "2h ago", "4d ago". */
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** The detail timeline: [{ label, sub, status: "done" | "running" | "failed" | "todo" }]. */
export function timeline(pr, now = Date.now()) {
  const steps = [{ label: "PR opened", sub: ago(pr.createdAt, now), status: "done" }];
  const ci = pr.ci;
  steps.push({
    label: ci.status === "failed" ? "CI failed" : ci.status === "running" ? "CI running" : ci.status === "passed" ? "CI passed" : "No CI",
    sub: ci.total ? `${ci.passed}/${ci.total} passed${ci.failed ? `, ${ci.failed} failed` : ""}` : "",
    status: ci.status === "failed" ? "failed" : ci.status === "running" ? "running" : ci.status === "passed" ? "done" : "todo",
  });
  if (pr.approvedBy.length) {
    const last = pr.approvedBy[pr.approvedBy.length - 1];
    steps.push({ label: "Approved", sub: `${last.at ? `${ago(last.at, now)} · ` : ""}${last.login}`, status: "done" });
  } else if (pr.reviewDecision === "CHANGES_REQUESTED") {
    steps.push({ label: "Changes requested", sub: pr.unresolved ? `${pr.unresolved} open threads` : "", status: "failed" });
  } else {
    steps.push({ label: "Waiting for review", sub: pr.unresolved ? `${pr.unresolved} open threads` : "", status: "todo" });
  }
  if (pr.state === "MERGED") {
    steps.push({ label: `Merged → ${pr.base}`, sub: pr.mergedAt ? ago(pr.mergedAt, now) : "", status: "done" });
    return steps;
  }
  if (pr.state === "CLOSED") {
    steps.push({ label: "Closed without merge", sub: "", status: "failed" });
    return steps;
  }
  steps.push({
    label: pr.mergeable === "CONFLICTING" ? "Merge conflict" : `Merge into ${pr.base}`,
    sub: pr.mergeable === "CONFLICTING" ? "rebase or merge the base" : pr.mergeState === "CLEAN" ? "ready" : pr.mergeState.toLowerCase(),
    status: pr.mergeable === "CONFLICTING" ? "failed" : "todo",
  });
  return steps;
}

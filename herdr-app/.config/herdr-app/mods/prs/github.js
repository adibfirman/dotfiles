// GitHub reads for the prs mod, through the gh CLI (the user's own login). Read only.
import { exec } from "herdr";
import { normalize } from "./model.js";

// The PR fields the list and the detail view show.
const FRAGMENT = `fragment P on PullRequest {
        url number title isDraft state mergedAt createdAt updatedAt
        headRefName baseRefName headRefOid
        repository { nameWithOwner }
        mergeable mergeStateStatus reviewDecision additions deletions
        reviews(last: 20) { nodes { state submittedAt author { login } commit { oid } } }
        reviewThreads(first: 100) { nodes { isResolved } }
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { nodes {
          ... on CheckRun { name status conclusion detailsUrl }
          ... on StatusContext { context state targetUrl }
        } } } } } }
        files(first: 50) { nodes { path additions deletions } }
}`;

// All my open PRs in one call (the "All" view).
export const QUERY = `query($q: String!) { search(query: $q, type: ISSUE, first: 40) { nodes { ...P } } }
${FRAGMENT}`;

async function gh(args, timeout = 60_000) {
  const r = await exec("gh", args, { timeout }).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `gh exit ${r.code}`).trim().slice(0, 300));
  return r.stdout;
}

export async function fetchPrs() {
  const out = await gh(["api", "graphql", "-f", `query=${QUERY}`, "-f", "q=is:pr is:open author:@me archived:false"]);
  return (JSON.parse(out).data?.search?.nodes ?? []).filter((n) => n?.url).map(normalize);
}

/**
 * The newest PR (any state) for each forge run's branch, in one call: one aliased field per run.
 * Returns Map<run dir, pr>. A run with no repo or branch is skipped.
 */
export async function fetchRunPrs(runs) {
  const asked = runs.filter((r) => r.repo && r.branch);
  if (!asked.length) return new Map();
  const fields = asked.map((r, i) => {
    const [owner, name] = r.repo.split("/");
    return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
      pullRequests(headRefName: ${JSON.stringify(r.branch)}, first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ...P } } }`;
  });
  const out = await gh(["api", "graphql", "-f", `query=query { ${fields.join("\n")} }\n${FRAGMENT}`]);
  const data = JSON.parse(out).data ?? {};
  const map = new Map();
  asked.forEach((r, i) => {
    const node = data[`r${i}`]?.pullRequests?.nodes?.[0];
    if (node) map.set(r.dir, normalize(node));
  });
  return map;
}

/** Unresolved review threads with file, line, author, and the first comment. */
export async function openThreads(pr) {
  const [owner, name] = pr.repo.split("/");
  const q = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    reviewThreads(first: 100) { nodes { isResolved path line comments(first: 1) { nodes { author { login } body } } } } } } }`;
  const out = await gh(["api", "graphql", "-f", `query=${q}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${pr.number}`]);
  return (JSON.parse(out).data?.repository?.pullRequest?.reviewThreads?.nodes ?? []).filter((t) => !t.isResolved).map((t) => ({
    path: t.path, line: t.line, author: t.comments?.nodes?.[0]?.author?.login ?? "someone", body: t.comments?.nodes?.[0]?.body ?? "",
  }));
}

/** The last lines of a failed GitHub Actions job log, from a check's details URL. */
export async function failedLog(pr, url) {
  const job = /\/actions\/runs\/\d+\/job\/(\d+)/.exec(url ?? "")?.[1];
  if (!job) return null;
  const out = await gh(["run", "view", "--repo", pr.repo, "--job", job, "--log-failed"], 120_000).catch(() => null);
  return out ? out.split("\n").slice(-120).join("\n") : null;
}

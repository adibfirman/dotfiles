// GitHub reads for the prs mod, through the gh CLI (the user's own login). Read only.
import { exec } from "herdr";
import { detailOf, normalize } from "./model.js";

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
        author { login } labels(first: 10) { nodes { name color } } totalCommentsCount changedFiles
}`;

async function gh(args, timeout = 60_000) {
  const r = await exec("gh", args, { timeout }).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `gh exit ${r.code}`).trim().slice(0, 300));
  return r.stdout;
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

/**
 * The detail view's data for one PR: commits, files, checks with run time and the required flag, reviewers asked,
 * and the comments, reviews, and code threads of the activity list.
 */
export async function fetchPrDetail(pr) {
  const [owner, name] = pr.repo.split("/");
  const out = await gh(["api", "graphql", "-f", `query=${DETAIL}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${pr.number}`]);
  const node = JSON.parse(out).data?.repository?.pullRequest;
  if (!node) throw new Error(`No data for ${pr.repo}#${pr.number}`);
  return detailOf(node);
}

const DETAIL = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) {
  changedFiles
  comments(last: 50) { nodes { body createdAt author { __typename login } } }
  reviewList: reviews(last: 50) { nodes { body state submittedAt author { __typename login } } }
  threads: reviewThreads(last: 50) { nodes { isResolved path line startLine originalLine originalStartLine
    comments(first: 20) { nodes { body createdAt diffHunk author { __typename login } } } } }
  commitList: commits(first: 100) { totalCount nodes { commit { oid messageHeadline committedDate author { name user { login } } } } }
  files(first: 100) { nodes { path additions deletions } }
  reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
  head: commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    ... on CheckRun { name status conclusion detailsUrl startedAt completedAt isRequired(pullRequestNumber: $number) }
    ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: $number) }
  } } } } } }
} } }`;

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

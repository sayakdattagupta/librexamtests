import fs from "node:fs";
import process from "node:process";
import { validateTest } from "./validateTest.mjs";

const TOPIC = "librexam-test";
const TOKEN = process.env.GITHUB_TOKEN;

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "librexam-indexer",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function getJson(url, useAuth = false) {
  const res = await fetch(url, {
    headers: useAuth ? headers : { "User-Agent": headers["User-Agent"] },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(`${file}.tmp`, file);
}

async function searchRepos() {
  const repos = [];
  for (let page = 1; page <= 10; page++) {
    const data = await getJson(
      `https://api.github.com/search/repositories?q=topic:${TOPIC}&sort=updated&order=desc&per_page=100&page=${page}`,
      true,
    );
    if (data.incomplete_results)
      throw new Error("Search results incomplete, try again later");
    repos.push(...data.items);
    if (data.items.length < 100) break;
  }
  return repos;
}

async function indexRepo(repo, problems) {
  const tests = [];
  let index;
  try {
    index = await getJson(
      `https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch}/index.json`,
    );
  } catch (err) {
    problems.push({
      repo: repo.full_name,
      errors: [`Couldn't load index.json: ${err.message}`],
    });
    return tests;
  }
  if (!Array.isArray(index)) {
    problems.push({
      repo: repo.full_name,
      errors: ["index.json must be an array."],
    });
    return tests;
  }

  for (const entry of index) {
    const label = entry?.name || entry?.filename || "(unnamed)";
    if (typeof entry?.url !== "string" || !entry.url.startsWith("https://")) {
      problems.push({
        repo: repo.full_name,
        test: label,
        errors: ["url must be an https:// link."],
      });
      continue;
    }

    let test;
    try {
      test = await getJson(entry.url);
    } catch (err) {
      problems.push({
        repo: repo.full_name,
        test: label,
        errors: [err.message],
      });
      continue;
    }

    const { errors, warnings } = validateTest(test);
    if (errors.length) {
      problems.push({ repo: repo.full_name, test: label, errors });
      continue;
    }
    if (warnings.length)
      problems.push({ repo: repo.full_name, test: label, warnings });

    tests.push({
      name: entry.name || test.title,
      filename: entry.filename || entry.url.split("/").pop(),
      author: entry.author || test.author || repo.owner.login,
      duration: entry.duration || test.duration,
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      description: entry.description || test.description || "",
      url: entry.url,
      repo: repo.full_name,
      updated_at: repo.pushed_at,
      stargazers_count: repo.stargazers_count,
    });
  }
  return tests;
}

async function main() {
  const blocklist = readJson("blocklist.json", []).map((r) => r.toLowerCase());
  const previous = readJson("indexedRepos.json", { repositories: [] });

  const repos = (await searchRepos()).filter(
    (r) =>
      !r.fork && !r.archived && !blocklist.includes(r.full_name.toLowerCase()),
  );

  if (repos.length === 0 && previous.repositories.length > 0) {
    throw new Error(
      "Search returned 0 repos but we had some before, not overwriting the index.",
    );
  }

  const tests = [];
  const problems = [];
  for (const repo of repos) {
    const found = await indexRepo(repo, problems);
    console.log(`${repo.full_name}: ${found.length} test(s)`);
    tests.push(...found);
  }

  repos.sort((a, b) => a.full_name.localeCompare(b.full_name));
  tests.sort(
    (a, b) => a.repo.localeCompare(b.repo) || a.name.localeCompare(b.name),
  );
  problems.sort((a, b) => a.repo.localeCompare(b.repo));

  writeJson("tests.json", { tests, problems });
  writeJson("indexedRepos.json", {
    total_count: repos.length,
    repositories: repos.map((r) => ({
      name: r.name,
      full_name: r.full_name,
      html_url: r.html_url,
      description: r.description,
      owner: r.owner.login,
      default_branch: r.default_branch,
      updated_at: r.pushed_at,
      stargazers_count: r.stargazers_count,
    })),
  });

  console.log(`\n${tests.length} test(s) from ${repos.length} repo(s).`);
  for (const p of problems) {
    console.log(`- ${p.repo}${p.test ? ` / ${p.test}` : ""}:`);
    for (const e of p.errors || []) console.log(`    error: ${e}`);
    for (const w of p.warnings || []) console.log(`    warning: ${w}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

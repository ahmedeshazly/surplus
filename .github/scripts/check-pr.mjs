// Owner: R1. Enforces AGENT_CONTEXT.md Section 9 on every pull request:
//   1. branch name   <role>/<task-id>-<slug>      e.g. r3/f-7-surplus-calculator
//   2. PR title      [<task-id>] description      e.g. [F-7] exact-sum staging schedule
//   3. file ownership: only files owned by the branch role (see .github/ownership.json)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const title = process.env.PR_TITLE ?? "";
const head = process.env.HEAD_REF ?? "";
const baseSha = process.env.BASE_SHA ?? "";
const headSha = process.env.HEAD_SHA ?? "HEAD";
const labels = JSON.parse(process.env.PR_LABELS ?? "[]");

const errors = [];

const TITLE_RE = /^\[([KSFCH]-\d+|P4)\] \S.*/;
const BRANCH_RE = /^(r[1-6])\/([ksfch]-\d+|p4)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const titleMatch = TITLE_RE.exec(title);
if (!titleMatch) errors.push(`PR title must look like "[F-7] short description". Got: "${title}"`);

const branchMatch = BRANCH_RE.exec(head);
if (!branchMatch) {
  errors.push(
    `Branch must look like "<role>/<task-id>-<slug>", e.g. r3/f-7-surplus-calculator. Got: "${head}"`,
  );
}

if (titleMatch && branchMatch && titleMatch[1].toLowerCase() !== branchMatch[2]) {
  errors.push(
    `Task id in the title (${titleMatch[1]}) does not match the branch (${branchMatch[2].toUpperCase()}).`,
  );
}

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$+?.()|{}[]".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}
const matchesAny = (file, globs = []) => globs.some((g) => globToRegExp(g).test(file));

// K-2 is the scaffold task: it creates files in every area, so it is exempt from the ownership check.
const isScaffold = branchMatch !== null && branchMatch[2] === "k-2";

if (branchMatch && !isScaffold && !labels.includes("ownership-approved")) {
  const role = branchMatch[1];
  const map = JSON.parse(readFileSync(new URL("../ownership.json", import.meta.url), "utf8"));
  const roleCfg = map.roles[role];
  const changed = execFileSync("git", ["diff", "--name-only", `${baseSha}...${headSha}`], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

  const violations = changed.filter((f) => {
    if (matchesAny(f, map.shared)) return false;
    if (matchesAny(f, roleCfg.exclude)) return true;
    return !matchesAny(f, roleCfg.include);
  });

  if (violations.length > 0) {
    errors.push(
      `Files outside ${role.toUpperCase()}'s owned paths (ask the owner, then add the label "ownership-approved"):\n  - ${violations.join("\n  - ")}`,
    );
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`::error::${e.replace(/\n/g, "%0A")}`);
  process.exit(1);
}
console.log("PR rules OK.");

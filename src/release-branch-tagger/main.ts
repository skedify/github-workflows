import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";

import { createLogger, createOctokitInstance, getPrefixedThrow } from "../utils";

const getOptionalInput = (name: string) => core.getInput(name) || undefined;

(async () => {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  if (!GITHUB_TOKEN) {
    core.setFailed("Please add the GITHUB_TOKEN to the release-branch-tagger action");

    return;
  }

  const applicationsJson = core.getInput("applications");
  const stableReleaseInput = getOptionalInput("is-stable-release") || "false";
  const IS_STABLE_RELEASE = stableReleaseInput === "true";

  const applications = JSON.parse(applicationsJson) as { name: string }[];

  const octokitInstance = createOctokitInstance({
    octokit: github.getOctokit(GITHUB_TOKEN),
    repo: github.context.repo.repo,
  });

  const currentBranch = github.context.ref.replace("refs/heads/", "");

  const IS_CORRECT_BRANCH =
    currentBranch.startsWith("release/") || currentBranch.startsWith("hotfix/");
  if (!IS_CORRECT_BRANCH)
    throw new Error(
      "This action expects to be ran on `/release/XXXX-QX` or `/hotfix/xxx` branches."
    );

  const IS_HOTFIX_BRANCH = currentBranch.startsWith("hotfix/");

  const releaseName = IS_HOTFIX_BRANCH
    ? currentBranch.replace("hotfix/", "")
    : currentBranch.replace("release/", "");

  const taskResults = await Promise.allSettled(
    applications.map(async ({ name }) => {
      const log = createLogger(name);

      try {
        const HAS_STABLE_RELEASE = await hasTag({ name, releaseName });

        if (IS_STABLE_RELEASE && HAS_STABLE_RELEASE)
          throw new Error(`Trying to release stable when it already exists! Aborting...`);

        const latestRcTag = await getLatestExistingTag({ name, releaseName, type: "rc" });

        if (IS_STABLE_RELEASE && latestRcTag.length === 0)
          throw new Error(`Trying to release stable without an rc.0 version! Aborting...`);

        const latestHotfixTag = await getLatestExistingTag({ name, releaseName, type: "hotfix" });

        const SHOULD_USE_HOTFIX_TAG = IS_HOTFIX_BRANCH ? true : HAS_STABLE_RELEASE;

        const nextTag = IS_STABLE_RELEASE
          ? `${name}@${releaseName}`
          : determineNextTag({
              type: SHOULD_USE_HOTFIX_TAG ? "hotfix" : "rc",
              latestTag: SHOULD_USE_HOTFIX_TAG ? latestHotfixTag : latestRcTag,
              name,
              releaseName,
              log,
            });

        log(`Tagging with ${nextTag}`);

        // TODO handle case where tag already exists for stable case.
        await octokitInstance.createRelease({
          tag: nextTag,
          sha: github.context.sha,
          // Stable & hotfix releases -> !prerelease
          prerelease: !IS_STABLE_RELEASE && !SHOULD_USE_HOTFIX_TAG,
        });
      } catch (err) {
        const throwError = getPrefixedThrow(name);
        // catch all errors and rethrow them with prefix, or rethrow original error
        if (err instanceof Error) throwError(err.message);
        throw err;
      }
    })
  );

  const errorMessages = taskResults.reduce(
    (text, res) => (res.status === "rejected" ? text + res.reason.message + "\n" : text),
    ""
  );

  if (errorMessages) throw new Error(errorMessages);
})().catch((err) => {
  console.error(err);
  core.setFailed(err.message);
});

function determineNextTag({
  latestTag,
  log,
  name,
  releaseName,
  type,
}: {
  type: "rc" | "hotfix";
  latestTag: string;
  name: string;
  releaseName: string;
  log: (message: string) => void;
}) {
  if (latestTag.length === 0) {
    log(`not tagged yet, starting at ${type}.0`);

    return createTag({ name, releaseName, type, version: 0 });
  } else {
    const currentVersion = latestTag.split(`${type}.`).pop();

    if (typeof currentVersion !== "string")
      throw new Error(`Couldn't determine next ${type} version, aborting... config: ${latestTag}`);

    const nextVersion = Number.parseInt(currentVersion) + 1;

    return createTag({ name, releaseName, type, version: nextVersion });
  }
}

function createTag({
  name,
  releaseName,
  type,
  version,
}: {
  name: string;
  releaseName: string;
  type: "rc" | "hotfix";
  version: number;
}) {
  return `${name}@${releaseName}-${type}.${version}`;
}

async function hasTag({ name, releaseName }: { name: string; releaseName: string }) {
  const { stdout: tagOutput } = await exec.getExecOutput(
    `git tag --list \"${name}@${releaseName}\"`
  );

  return tagOutput.length > 0;
}

async function getLatestExistingTag({
  name,
  releaseName,
  type,
}: {
  name: string;
  releaseName: string;
  type: "rc" | "hotfix";
}) {
  const { stdout: lastestTagOutput } = await exec.getExecOutput(
    `git tag --list --sort=-version:refname \"${name}@${releaseName}-${type}.*\" | head -n 1`
  );

  const [latestTag] = lastestTagOutput.split("\n");

  return latestTag;
}

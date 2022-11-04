import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";

import { createLogger, createOctokitInstance, getPrefixedThrow } from "../utils";

(async () => {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    core.setFailed("Please add the GITHUB_TOKEN to the release-branch-tagger action");

    return;
  }

  const octokitInstance = createOctokitInstance({
    octokit: github.getOctokit(GITHUB_TOKEN),
    repo: github.context.repo.repo,
  });

  const currentBranch = github.context.ref.replace("refs/heads/", "");
  const [type, name, releaseName] = currentBranch.split("/");

  if (type !== "rc" && type !== "hotfix") {
    throw new Error(
      "This action expects to be ran on `/{rc,hotfix}/{APPLICATION}/{BASE_TAG}` branches."
    );
  }

  if (!name || !releaseName) {
    throw new Error(
      "This action expects to be ran on `/{rc,hotfix}/{APPLICATION}/{BASE_TAG}` branches."
    );
  }

  const log = createLogger(name);

  try {
    const latestRcTag = await getLatestExistingTag({ name, releaseName, type: "rc" });
    const latestHotfixTag = await getLatestExistingTag({ name, releaseName, type: "hotfix" });

    const latestTag = type === "hotfix" ? latestHotfixTag : latestRcTag;
    const nextTag = determineNextTag({ type, latestTag, name, releaseName, log });

    log(`Tagging with ${nextTag}`);

    await octokitInstance.createRelease({
      tag: nextTag,
      sha: github.context.sha,
      prerelease: type === "rc",
    });
  } catch (err) {
    const throwError = getPrefixedThrow(name);
    // catch all errors and rethrow them with prefix, or rethrow original error
    if (err instanceof Error) throwError(err.message);
    throw err;
  }
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

    if (Number.isNaN(nextVersion))
      throw new Error(`Couldn't determine next ${type} version, aborting... config: ${latestTag}`);

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

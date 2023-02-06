import { getOctokit } from "@actions/github";

type OctokitInstance = ReturnType<typeof getOctokit>;
const owner = "skedify";

export function createOctokitInstance({
  octokit,
  repo,
}: {
  octokit: OctokitInstance;
  repo: string;
}) {
  function getTagOrBranch(ref: string) {
    return octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
      owner,
      repo,
      ref,
    });
  }

  function getTag(tagName: string) {
    return getTagOrBranch(`tags/${tagName}`);
  }

  function getBranch(branchName: string) {
    return getTagOrBranch(`heads/${branchName}`);
  }

  async function createBranch({ branchName, sha }: { sha: string; branchName: string }) {
    return octokit.request("POST /repos/{owner}/{repo}/git/refs", {
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha,
    });
  }

  async function createTag({ message, sha, tag }: { tag: string; message: string; sha: string }) {
    console.log("creating tag object...");

    const tagObject = await octokit.request("POST /repos/{owner}/{repo}/git/tags", {
      owner,
      repo,
      tag,
      message,
      object: sha,
      type: "commit",
    });

    console.log("creating tag...");
    // create actual git tag with tagObject.
    await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
      owner,
      repo,
      ref: `refs/tags/${tagObject.data.tag}`,
      sha: tagObject.data.sha,
    });

    return tagObject.data.tag;
  }

  async function createRelease({
    tag,
    message = tag,
    sha,
    prerelease,
  }: {
    tag: string;
    message?: string;
    sha: string;
    prerelease: boolean;
  }) {
    const tagName = await createTag({ tag: tag, message, sha });

    console.log("creating release...");
    // create release with tag
    await octokit.request("POST /repos/{owner}/{repo}/releases", {
      owner,
      repo,
      tag_name: tagName,
      name: tagName,
      prerelease,
    });
  }

  async function triggerWorkflow({
    branchName,
    workflowName,
  }: {
    branchName: string;
    workflowName: string;
  }) {
    return octokit.request(
      "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
      {
        owner,
        repo,
        workflow_id: workflowName,
        ref: `${branchName}`,
      }
    );
  }

  return {
    getTag,
    getBranch,
    createRelease,
    createBranch,
    triggerWorkflow,
  };
}

export function getPrefixedThrow(prefix: string) {
  return function throwError(message: string): never {
    throw new Error(`${prefix}: ${message}`);
  };
}

export function createLogger(prefix: string) {
  return function log(message: string): void {
    console.log(`${prefix}: ${message}`);
  };
}

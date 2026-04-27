import type { getOctokit } from "@actions/github";

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
      },
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
  return function log(message: string, ...optionalParams: unknown[]): void {
    console.log(`${prefix}: ${message}`, ...optionalParams);
  };
}

type Octokit = ReturnType<typeof getOctokit>;
type CreateTreeParams = NonNullable<
  Parameters<ReturnType<typeof getOctokit>["rest"]["git"]["createTree"]>[0]
>;

function log({ func, message }: { func: string; message: string }) {
  console.log(`[${func}]: ${message}`);
}
export class OctokitApi {
  #octokit: Octokit;
  #repo: string;
  #branch: string;
  constructor(params: { octokit: Octokit; repo: string; branch: string }) {
    this.#octokit = params.octokit;
    this.#repo = params.repo;
    this.#branch = params.branch;
  }

  async #fileExistsInRepo(path: string) {
    log({ func: "fileExistsInRepo", message: path });

    try {
      await this.#octokit.rest.repos.getContent({
        method: "HEAD",
        owner,
        repo: this.#repo,
        path,
        ref: this.#branch,
      });
      return true;
    } catch (_e) {
      return false;
    }
  }

  async #createCommit({
    message,
    tree,
    baseTree,
  }: {
    message: string;
    tree: { sha: string };
    baseTree: string;
  }) {
    log({ func: "createCommit", message: `base_tree - ${baseTree} | tree - ${tree.sha}` });

    const { data } = await this.#octokit.rest.git.createCommit({
      owner,
      repo: this.#repo,
      message,
      tree: tree.sha,
      parents: [baseTree],
    });

    return data;
  }

  async #createTree({ tree, base_tree }: { base_tree: string; tree: CreateTreeParams["tree"] }) {
    log({ func: "createTree", message: `base_tree - ${base_tree}` });

    const { data } = await this.#octokit.rest.git.createTree({
      owner,
      repo: this.#repo,
      tree,
      base_tree,
    });

    return data;
  }

  // biome-ignore lint/suspicious/noExplicitAny: ignore me
  async #createBlob(contents: any, type: string) {
    if (type === "commit") {
      return contents;
    }

    let content = contents;

    if (!isBase64(content)) {
      content = Buffer.from(contents).toString("base64");
    }

    const file = (
      await this.#octokit.rest.git.createBlob({
        owner,
        repo: this.#repo,
        content,
        encoding: "base64",
      })
    ).data;
    return file.sha;
  }

  async loadRef(ref: string) {
    log({ func: "loadRef", message: ref });

    try {
      const x = await this.#octokit.rest.git.getRef({
        owner,
        repo: this.#repo,
        ref: `heads/${ref}`,
      });
      return x.data.object.sha;
    } catch (_e) {
      // console.log(e);
    }
  }

  async getJsonFileContent<T>({ ref, path }: { ref: string; path: string }) {
    log({ func: "getJsonFileContent", message: `Loading file ${path} at ref ${ref}` });
    const file = await this.#octokit.rest.repos
      .getContent({
        owner,
        repo: this.#repo,
        ref,
        path,
        mediaType: { format: "raw" },
      })
      .catch((error) => {
        if (error.status === 404) {
          // If the file doesn't exist, return null
          return null;
        }

        throw error;
      });

    if (!file || typeof file.data !== "string") return null;

    const content = JSON.parse(file.data) as T;

    return content;
  }

  async compareCommits({ base, head }: { base: string; head: string }) {
    log({ func: "compareCommitsWithBasehead", message: `Comparing ${base}...${head}` });

    const {
      data: { files },
    } = await this.#octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo: this.#repo,
      basehead: `${base}...${head}`,
    });

    return files;
  }

  async multiFileUpload({
    changes,
    batchSize = 1,
  }: {
    changes: {
      message: string;
      ignoreDeletionFailures: boolean;
      files?: {
        [fileName: string]:
          | {
              contents: string | Buffer;
              mode?: "100644" | "100755" | "040000" | "160000" | "120000";
              type?: "blob" | "tree" | "commit";
            }
          | string;
      };
      filesToDelete?: string[];
    }[];
    batchSize?: number;
  }) {
    try {
      if (!changes?.length) {
        throw new Error("No changes provided");
      }

      let baseTree = await this.loadRef(this.#branch);

      // Does the target branch already exist?
      if (!baseTree)
        throw new Error(`The branch '${this.#branch}' doesn't exist and createBranch is 'false'`);

      // Create blobs
      const commits = [];
      for (const change of changes) {
        const message = change.message;
        if (!message) {
          throw new Error("changes[].message is a required parameter");
        }

        const hasFiles = change.files && Object.keys(change.files).length > 0;
        const hasFilesToDelete =
          Array.isArray(change.filesToDelete) && change.filesToDelete.length > 0;

        if (!hasFiles && !hasFilesToDelete) {
          throw new Error("either changes[].files or changes[].filesToDelete are required");
        }

        const treeItems: CreateTreeParams["tree"] = [];
        // Handle file deletions
        if (Array.isArray(change.filesToDelete)) {
          for (const batch of chunk(change.filesToDelete, batchSize)) {
            await Promise.all(
              batch.map(async (fileName) => {
                const exists = await this.#fileExistsInRepo(fileName);

                // If it doesn't exist, and we're not ignoring missing files
                // reject the promise
                if (!exists && !change.ignoreDeletionFailures) {
                  throw new Error(`The file ${fileName} could not be found in the repo`);
                }

                // At this point it either exists, or we're ignoring failures
                if (exists) {
                  treeItems.push({
                    path: fileName,
                    sha: null, // sha as null implies that the file should be deleted
                    mode: "100644",
                    type: "commit",
                  });
                }
              }),
            );
          }
        }

        if (change.files) {
          for (const batch of chunk(Object.keys(change.files), batchSize)) {
            await Promise.all(
              batch.map(async (fileName) => {
                const properties = change.files?.[fileName]; // || {};

                const contents = typeof properties === "string" ? properties : properties?.contents;
                const mode =
                  typeof properties === "string" ? "100644" : properties?.mode || "100644";
                const type = typeof properties === "string" ? "blob" : properties?.type || "blob";

                if (!contents) {
                  throw new Error(`No file contents provided for ${fileName}`);
                }

                const fileSha = await this.#createBlob(contents, type);
                log({ func: "createBlob", message: `Successfully Uploaded ${fileName}` });

                treeItems.push({
                  path: fileName,
                  sha: fileSha,
                  mode: mode,
                  type: type,
                });
              }),
            );
          }
        }

        // no need to issue further requests if there are no updates, creations and deletions
        if (treeItems.length === 0) {
          continue;
        }

        // Add those blobs to a tree
        const tree = await this.#createTree({ tree: treeItems, base_tree: baseTree });

        // Create a commit that points to that tree
        const commit = await this.#createCommit({
          message,
          tree,
          baseTree,
        });

        // Update the base tree if we have another commit to make
        baseTree = commit.sha;
        commits.push(commit);
      }

      log({ func: "updateRef", message: "Updating upstream branch" });
      await this.#octokit.rest.git.updateRef({
        owner,
        repo: this.#repo,
        ref: `heads/${this.#branch}`,
        sha: baseTree,
      });

      // Return the new branch name so that we can use it later
      // e.g. to create a pull request
      return { commits };
    } catch (e) {
      console.error("Error in multiFileUpload:", e);
      throw e;
    }
  }
}

function chunk<T>(input: T[], size: number) {
  return input.reduce((arr, item, idx) => {
    // biome-ignore lint/performance/noAccumulatingSpread: ignore me
    return idx % size === 0 ? [...arr, [item]] : [...arr.slice(0, -1), [...arr.slice(-1)[0], item]];
  }, [] as T[][]);
}

function isBase64(strRaw: string | Buffer): boolean {
  // Handle buffer inputs

  const str = Buffer.isBuffer(strRaw) ? strRaw.toString("utf8") : strRaw;
  const notBase64 = /[^A-Z0-9+/=]/i;

  const isString = typeof str === "string";

  if (!isString) {
    let invalidType: string;
    if (str === null) {
      invalidType = "null";
    } else {
      invalidType = typeof str;
      // @ts-expect-error
      // biome-ignore lint/suspicious/noPrototypeBuiltins: ignore me
      if (invalidType === "object" && str.constructor && str.constructor.hasOwnProperty("name")) {
        // @ts-expect-error
        invalidType = str.constructor.name;
      } else {
        invalidType = `a ${invalidType}`;
      }
    }
    throw new TypeError(`Expected string but received ${invalidType}.`);
  }

  const len = str.length;
  if (!len || len % 4 !== 0 || notBase64.test(str)) {
    return false;
  }
  const firstPaddingChar = str.indexOf("=");
  return (
    firstPaddingChar === -1 ||
    firstPaddingChar === len - 1 ||
    (firstPaddingChar === len - 2 && str[len - 1] === "=")
  );
}

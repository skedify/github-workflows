import { octokit } from "./main";

async function createFile(
  rawParams: Parameters<typeof octokit.rest.repos.createOrUpdateFileContents>[0],
) {
  // biome-ignore lint/style/noNonNullAssertion: <explanation>
  const params = rawParams!;

  return octokit.rest.repos.createOrUpdateFileContents(params);
}

async function updateFile(
  file: Awaited<ReturnType<typeof octokit.rest.repos.getContent>>,
  rawParams: Parameters<typeof octokit.rest.repos.createOrUpdateFileContents>[0],
) {
  // biome-ignore lint/style/noNonNullAssertion: <explanation>
  const params = rawParams!;

  return octokit.rest.repos.createOrUpdateFileContents({
    ...params,
    // @ts-expect-error Octokit saus
    sha: file.data.sha,
  });
}

export async function createOrUpdateFile(
  rawParams: Parameters<typeof octokit.rest.repos.createOrUpdateFileContents>[0],
) {
  // biome-ignore lint/style/noNonNullAssertion: <explanation>
  const params = rawParams!;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  let file: any;

  try {
    file = await octokit.rest.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      ref: `heads/${params.branch}`,
      path: `${params.path}`,
    });
  } catch (error) {
    // @ts-ignore
    if (error.status === 404) {
      // Do nothing, create the file below
    } else {
      throw error;
    }
  }

  if (file == null) {
    return createFile(params);
  }

  return updateFile(file, params);
}

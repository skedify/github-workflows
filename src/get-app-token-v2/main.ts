// /* eslint-disable */
// import * as core from "@actions/core";
// import * as github from "@actions/github";
// import { createAppAuth } from "@octokit/auth-app";

// (async () => {
//   const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
//   const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

//   if (!GITHUB_TOKEN) {
//     core.setFailed("Please add the GITHUB_TOKEN to the release-branch-tagger action");

//     return;
//   }

//   if (!GITHUB_REPOSITORY) {
//     core.setFailed("Please add the GITHUB_REPOSITORY to the release-branch-tagger action");

//     return;
//   }

//   const APP_ID = core.getInput("APP_ID", { required: true });
//   const PEM = core.getInput("APP_PEM", { required: true });

//   const repository = process.env["GITHUB_REPOSITORY"];

//   const [owner, repo] = GITHUB_REPOSITORY.split("/");
//   const octokit = github.getOctokit(GITHUB_TOKEN);

//   const installation = await octokit.request("GET /repos/{owner}/{repo}/installation", {
//     owner,
//     repo,
//   });

//   installation.data[].
//   // 'https://api.github.com/repos/{owner}/{repo}/installation'
//   // const installationId = core.getInput("installation-id");
//   // const clientId = core.getInput("client-id");
//   // const clientSecret = core.getInput("client-secret");

//   const auth = createAppAuth({ appId, privateKey, clientId, clientSecret });

//   // Retrieve installation access token
//   const { token } = await auth({ type: "installation", installationId });

//   core.setOutput("token", token);
// })().catch((err) => {
//   console.error(err);
//   core.setFailed(err.message);
// });

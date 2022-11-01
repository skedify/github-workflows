import * as core from "@actions/core";
import { createAppAuth } from "@octokit/auth-app";

(async () => {
  const appId = core.getInput("app-id");
  const installationId = core.getInput("installation-id");
  const clientId = core.getInput("client-id");
  const clientSecret = core.getInput("client-secret");
  const privateKey = core.getInput("private-key");

  const auth = createAppAuth({ appId, privateKey, clientId, clientSecret });

  // Retrieve installation access token
  const { token } = await auth({ type: "installation", installationId });

  core.setOutput("token", token);
})().catch((err) => {
  console.error(err);
  core.setFailed(err.message);
});

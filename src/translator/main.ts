import * as core from "@actions/core";
import * as z from "zod";

import { translator } from "./translator";

const mainBranch = core.getInput("mainBranch", { required: true });
const prBranch = core.getInput("prBranch", { required: true });
const repo = core.getInput("repo", { required: true });

const envs = z
  .object({
    GITHUB_TOKEN: z.string().min(1),
    GEMINI_API_TOKEN: z.string().min(1),
  })
  .parse(process.env);

translator({
  mainBranch,
  prBranch,
  repo,
  GITHUB_TOKEN: envs.GITHUB_TOKEN,
  GEMINI_API_TOKEN: envs.GEMINI_API_TOKEN,
}).catch((err) => {
  console.error(err);
  core.setFailed(err.message);
});

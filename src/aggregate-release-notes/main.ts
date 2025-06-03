import fs from "node:fs/promises";
import path from "node:path";
import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import { type GenerativeModel, GoogleGenerativeAI } from "@google/generative-ai";
import z from "zod";

import { createLogger } from "../utils";

import { createOrUpdateFile } from "./createOrUpdateFile";

const organization = "skedify";
const CHANGELOG_NAME = "CHANGELOG.md";

const configSchema = z.record(
  z.string(),
  z.object({
    baseBranch: z.string(),
    cursor: z.string(),
    path: z.string(),
  }),
);

type ConfigSchema = z.infer<typeof configSchema>;

const log = createLogger("release");
const cursorFile: string = core.getInput("cursorFile", { required: true });

const envs = z
  .object({
    GITHUB_TOKEN: z.string().min(1),
    GITHUB_WORKSPACE: z.string().min(1),
    GEMINI_API_TOKEN: z.string().min(1),
  })
  .parse(process.env);

export const octokit = getOctokit(envs.GITHUB_TOKEN);

const branchRefs = {
  MAIN_BRANCH: "main",
  RELEASE_NOTE_BRANCH: "release-notes/main",
};

(async () => {
  const rawConfig = await fs.readFile(path.resolve(envs.GITHUB_WORKSPACE, cursorFile), "utf8");
  const config = configSchema.parse(JSON.parse(rawConfig));

  const { changelogs, updatedConfig } = await getChangelogs(octokit, config);

  if (changelogs.length === 0) {
    await octokit.rest.git
      .deleteRef({
        owner: organization,
        repo: "releases",
        ref: `heads/${branchRefs.RELEASE_NOTE_BRANCH}`,
      })
      .catch(() => {});

    log("No changelogs found, not creating a PR!");

    return;
  }

  const changelogContent = changelogs
    .map(
      (changelog) => `# ${changelog.projectName}

${changelog.diff ?? ""}`,
    )
    .join("\n\n");

  const genAI = new GoogleGenerativeAI(envs.GEMINI_API_TOKEN);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const englishReleaseNote = await gemini(
    model,
    `Summarize the following individual release notes to a human-friendly, marketing oriented release note in Markdown format using the following sections: short intro, new features & enhancements and bug fixes.\n\n${changelogContent}`,
  );
  const dateString = new Date().toISOString().split("T")[0] ?? "";

  const humanFriendlyReleaseNotes = {
    en: `${createMeta(`Release ${dateString}`, `${dateString}`, dateString, "")}\n\n${englishReleaseNote}`,
    nl: `${createMeta(`Release ${dateString}`, `${dateString}`, dateString, "")}\n\n${await gemini(model, `Translate the release note from English to Dutch:\n\n${englishReleaseNote}`)}`,
    fr: `${createMeta(`Release ${dateString}`, `${dateString}`, dateString, "")}\n\n${await gemini(model, `Translate the release note from English to French:\n\n${englishReleaseNote}`)}`,
  };

  const defaultBranch = await octokit.rest.git.getRef({
    owner: organization,
    repo: "releases",
    ref: `heads/${branchRefs.MAIN_BRANCH}`,
  });

  // Create a new branch from the current HEAD
  await octokit.rest.git
    .createRef({
      owner: organization,
      repo: "releases",
      ref: `refs/heads/${branchRefs.RELEASE_NOTE_BRANCH}`,
      sha: defaultBranch.data.object.sha,
    })
    .catch(() => {});

  const baseParam = {
    owner: organization,
    repo: "releases",
    committer: {
      name: "skedibot",
      email: "git@skedify.co",
    },
    author: {
      name: "skedibot",
      email: "git@skedify.co",
    },
  } satisfies Partial<Parameters<typeof octokit.rest.repos.createOrUpdateFileContents>[0]>;

  // Save the raw aggregated changeset file
  await createOrUpdateFile({
    ...baseParam,
    branch: branchRefs.RELEASE_NOTE_BRANCH,
    path: `changelogs/${dateString}.md`,
    message: `${dateString} version`,
    content: Buffer.from(changelogContent).toString("base64"),
  });

  // Save the new cursor
  await createOrUpdateFile({
    ...baseParam,
    branch: branchRefs.RELEASE_NOTE_BRANCH,
    path: "changelog-cursor.json",
    message: `Update cursor to ${dateString}`,
    content: Buffer.from(`${JSON.stringify(updatedConfig, null, 2)}\n`).toString("base64"),
  });

  // Save the human friendly release notes
  for (const [language, changelog] of Object.entries(humanFriendlyReleaseNotes)) {
    await createOrUpdateFile({
      ...baseParam,
      branch: branchRefs.RELEASE_NOTE_BRANCH,
      path: `src/content/releases/${language}/${dateString}.md`,
      message: `${dateString} ${language} version`,
      content: Buffer.from(changelog).toString("base64"),
    });
  }

  await octokit.rest.pulls
    .create({
      owner: organization,
      repo: "releases",
      base: branchRefs.MAIN_BRANCH,
      head: branchRefs.RELEASE_NOTE_BRANCH,
      title: `Release ${dateString}`,
      body: `Release ${dateString}`,
    })
    .catch(() => {});

  log("Done! ✅ :shipitparrot:");
})().catch((err) => {
  console.error(err);
  core.setFailed(err.message);
});

async function getChangelogs(octokit: ReturnType<typeof getOctokit>, config: ConfigSchema) {
  const changelogs: { projectName: string; diff: string }[] = [];

  await Promise.all(
    Object.entries(config).map(async ([repositoryName, c]) => {
      const { baseBranch, cursor, path } = c;

      const defaultBranch = await octokit.rest.git.getRef({
        owner: organization,
        repo: repositoryName,
        ref: `heads/${baseBranch}`,
      });

      const baseSha = defaultBranch.data.object.sha;

      config[repositoryName].cursor = baseSha;

      const {
        data: { files },
      } = await octokit.rest.repos.compareCommitsWithBasehead({
        owner: organization,
        repo: repositoryName,
        basehead: `${cursor}...${baseSha}`,
      });

      const changedFiles = files ?? [];

      changedFiles
        .filter((f) => f.filename.endsWith(CHANGELOG_NAME))
        .forEach((f) => {
          if (f.patch == null) {
            return;
          }

          changelogs.push({
            projectName: f.filename
              .replace(new RegExp(`/^(${path}\/)/`), "")
              .replace("/CHANGELOG.md", ""),
            diff: f.patch
              .split("\n")
              .filter((x) => x.startsWith("+"))
              .map((x) => x.substr(1).trim())
              .join("\n"),
          });
        });
    }),
  );

  return { changelogs, updatedConfig: config };
}

async function gemini(model: GenerativeModel, prompt: string): Promise<string> {
  const result = await model.generateContent(prompt);
  const response = await result.response;

  return response.text();
}

function createMeta(title: string, versionNumber: string, date: string, description: string) {
  return `---
title: '${title}'
versionNumber: '${versionNumber}'
date: '${date}'
description: '${description}'
---`;
}

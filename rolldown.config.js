import { defineConfig } from "rolldown";

const projects = [
  "aggregate-release-notes",
  "release-branch-tagger",
  "release-creator",
  "get-app-token",
  "tagger",
  "translator",
];

export default defineConfig(
  projects.map((project) => ({
    input: `src/${project}/main.ts`,
    platform: "node",
    output: {
      codeSplitting: false,
      minify: true,
      sourcemap: true,
      dir: `${project}/dist`,
    },
  })),
);

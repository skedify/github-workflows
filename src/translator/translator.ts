import { getOctokit } from "@actions/github";
import { GoogleGenAI, Type } from "@google/genai";
import { OctokitApi, createLogger } from "../utils";

const organization = "skedify";
const log = createLogger("translator");
export async function translator({
  mainBranch,
  prBranch,
  repo,
  GITHUB_TOKEN,
  GEMINI_API_TOKEN,
}: {
  repo: string;
  mainBranch: string;
  prBranch: string;
  GITHUB_TOKEN: string;
  GEMINI_API_TOKEN: string;
}) {
  const octokit = getOctokit(GITHUB_TOKEN);
  const gemini = createGemini({ apiKey: GEMINI_API_TOKEN });
  const api = new OctokitApi({ octokit, repo, branch: prBranch });

  const prBranchRef = await octokit.rest.git.getRef({
    owner: organization,
    repo: repo,
    ref: `heads/${prBranch}`,
  });

  const fileGroups = await getI18nFiles({
    repo: repo,
    mainBranch: mainBranch,
    octokit,
    prSha: prBranchRef.data.object.sha,
    prBranch: prBranch,
  });

  if (!fileGroups || fileGroups.length === 0) {
    log("No i18n files found or no changes detected.");
    return;
  }

  const result = await Promise.all(
    fileGroups.flatMap((files) => {
      const source = files.find((f) => f.lng === "en");
      const otherFiles = files.filter((f) => f.lng !== "en");

      if (!source) {
        log("No English file found in the group, skipping...");
        throw new Error(
          `No English file found in the group for repo ${repo} on branch ${prBranch}.`,
        );
      }

      return otherFiles.map(async (target) => {
        const output = await gemini({ source, target });

        const original = target.content
          ? Object.fromEntries(target.content.map(({ k, v }) => [k, v]))
          : {};

        const merged =
          output?.reduce((acc, { k, v }) => {
            acc[k] = v;
            return acc;
          }, original) ?? original;

        const sorted = Object.fromEntries(Object.entries(merged).sort());

        return {
          lng: target.lng,
          path: target.path,
          result: sorted,
        };
      });
    }),
  );

  await api.multiFileUpload({
    changes: [
      {
        message: `[Update i18n files] - ${repo} - ${prBranch}`,
        ignoreDeletionFailures: true,
        files: Object.fromEntries(
          result.map((file) => [file.path, `${JSON.stringify(file.result, null, 2)}\n`]),
        ),
      },
    ],
  });

  log("Done! ✅ :shipitparrot:");
}

const supportedLngs = ["da", "de", "en", "el", "es", "fr", "nl", "no"] as const;
type FileResults = {
  lng: (typeof supportedLngs)[number];
  /** content can be null if the file doesn't exist */
  content: { k: string; v: string }[] | null;
  path: string;
};

async function getI18nFiles({
  octokit,
  mainBranch,
  prBranch,
  prSha,
  repo,
}: {
  octokit: ReturnType<typeof getOctokit>;
  mainBranch: string;
  repo: string;
  prSha: string;
  prBranch: string;
}) {
  console.log(`[compareCommitsWithBasehead]: [${repo}] - Comparing ${mainBranch}...${prBranch}`);

  const {
    data: { files },
  } = await octokit.rest.repos.compareCommitsWithBasehead({
    owner: organization,
    repo: repo,
    basehead: `${mainBranch}...${prBranch}`,
  });

  // all changed i18n en files
  const i18nEnFiles = files
    ?.filter(
      (f) =>
        f.filename.includes("/i18n/en/") && f.filename.endsWith(".json") && f.status !== "removed",
    )
    .map((f) => f.filename);

  if (i18nEnFiles == null || i18nEnFiles.length === 0) return null;

  console.log("i18nEnFiles", i18nEnFiles);

  // returns a [][] of results, where each inner array corresponds to a single i18n file
  // and contains the content for each supported language.
  // If a language is not available, the content will be null.

  const allI18nFiles = await Promise.all(
    i18nEnFiles.map(
      (enFile) =>
        new Promise<FileResults[]>((resolve, reject) => {
          Promise.all(
            supportedLngs.map(async (lng) => {
              const path = enFile.replace("/en/", `/${lng}/`);

              return {
                path,
                file: await octokit.rest.repos
                  .getContent({
                    owner: organization,
                    repo: repo,
                    ref: prSha,
                    path,
                    mediaType: { format: "raw" },
                  })
                  .catch((error) => {
                    if (error.status === 404) {
                      // If the file doesn't exist, return null
                      return null;
                    }

                    throw error;
                  }),
              };
            }),
          )
            .then((files) => {
              const result = supportedLngs.map((lng, idx) => {
                const { file, path } = files[idx];

                if (file == null) {
                  return {
                    lng,
                    path,
                    content: null,
                  };
                }

                if (typeof file.data === "string") {
                  const content = JSON.parse(file.data) as Record<string, string>;

                  return {
                    lng,
                    path,
                    content: Object.entries(content).map(([k, v]) => ({ k, v })),
                  };
                }

                throw new Error("Invalid file data type");
              });

              resolve(result);
            })
            .catch(reject);
        }),
    ),
  );

  return allI18nFiles;
}

const lngMap: Record<FileResults["lng"], string> = {
  da: "Danish",
  de: "German",
  en: "English",
  el: "Greek",
  es: "Spanish",
  fr: "French",
  nl: "Dutch",
  no: "Norwegian",
};
function createGemini({ apiKey }: { apiKey: string }) {
  const genAi = new GoogleGenAI({ apiKey });

  return async ({ source, target }: { source: FileResults; target: FileResults }) => {
    const sourceLng = lngMap[source.lng];
    const targetLng = lngMap[target.lng];

    const contents = `I will provide you 2 JSON files.
${sourceLng} version:
${JSON.stringify(source.content)}

${targetLng} version:
${JSON.stringify(target.content)}

The first file will be a JSON file in ${sourceLng}, and the second will be in ${targetLng}.
I want you to translate it into ${targetLng}, however you should not override existing values, only translate missing values.
The structure of a translation object is as follows: "k" stands for the key, and "v" stands for the value.
If a key exists in the ${sourceLng} version, but not in the ${targetLng} version, you should add it to your output.
Only return newly added translations, do not return the entire file.
        `;

    return genAi.models
      .generateContent({
        model: "gemini-2.0-flash",
        contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                k: { type: Type.STRING },
                v: { type: Type.STRING },
              },
              propertyOrdering: ["k", "v"],
            },
          },
        },
      })
      .then((result) => {
        if (result.text) {
          try {
            return JSON.parse(result.text) as { k: string; v: string }[];
          } catch (error) {
            console.error("Failed to parse Gemini response:", error);
            console.error("Response text:", result.text);

            return null;
            // throw new Error("Invalid response from Gemini API");
          }
        }
        return null;
      });
  };
}

function createGhApi(octokit: ReturnType<typeof getOctokit>) {
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

  async function createOrUpdateFile(
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
        path: params.path,
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

  return {
    createOrUpdateFile,
  };
}

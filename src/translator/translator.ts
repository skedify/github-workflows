import { getOctokit } from "@actions/github";
import { GoogleGenAI, Type } from "@google/genai";
import { OctokitApi, createLogger } from "../utils";

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
  const translate = createGemini({ apiKey: GEMINI_API_TOKEN });
  const api = new OctokitApi({ octokit: getOctokit(GITHUB_TOKEN), repo, branch: prBranch });

  const prSha = await api.loadRef(prBranch);
  if (!prSha) {
    log(`Branch ${prBranch} not found in repository ${repo}.`);
    return;
  }

  const fileGroups = await getI18nFiles({ mainBranch, api, prSha, prBranch });
  if (!fileGroups || fileGroups.length === 0) {
    log("No i18n files found or no changes detected.");
    return;
  }

  const result = await Promise.all(
    fileGroups.flatMap((files) => {
      const source = files.find((f) => f.lng === "en");
      const otherFiles = files.filter((f) => f.lng !== "en");

      if (!source || source.json === null) {
        log("No English file found in the group, skipping...");
        throw new Error(
          `No English file found in the group for repo ${repo} on branch ${prBranch}.`,
        );
      }

      return otherFiles.map(async (target) => {
        const output = await translate({ source, target });
        const sorted = Object.fromEntries(Object.entries({ ...target.json, ...output }).sort());

        return {
          lng: target.lng,
          path: target.path,
          result: `${JSON.stringify(sorted, null, 2)}\n`,
        };
      });
    }),
  );

  await api.multiFileUpload({
    changes: [
      {
        message: "[i18n AI Translations]",
        ignoreDeletionFailures: true,
        files: Object.fromEntries(result.map((file) => [file.path, file.result])),
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
  json: Record<string, string> | null;
  path: string;
};

async function getI18nFiles({
  api,
  mainBranch,
  prBranch,
  prSha,
}: {
  api: OctokitApi;
  mainBranch: string;
  prSha: string;
  prBranch: string;
}) {
  const files = await api.compareCommits({ base: mainBranch, head: prBranch });

  // all changed i18n en files
  const i18nEnFiles = files
    ?.filter(
      (f) => f.filename.includes("/en/") && f.filename.endsWith(".json") && f.status !== "removed",
    )
    .map((f) => f.filename);

  if (i18nEnFiles == null || i18nEnFiles.length === 0) return null;

  log("i18nEnFiles", i18nEnFiles);

  // returns a [][] of results, where each inner array corresponds to a single i18n file
  // and contains the content for each supported language.
  // If a language is not available, the content will be null.
  const allI18nFiles = await Promise.all(
    i18nEnFiles.map((enFile) =>
      Promise.all(
        supportedLngs.map(async (lng) => {
          const path = enFile.replace("/en/", `/${lng}/`);
          const json = await api.getJsonFileContent<Record<string, string>>({
            ref: prSha,
            path,
          });

          return json
            ? { lng, path, json, content: Object.entries(json).map(([k, v]) => ({ k, v })) }
            : { lng, path, json, content: null };
        }),
      ),
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

  return async function translate({
    source,
    target,
  }: { source: FileResults; target: FileResults }) {
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

    const result = await genAi.models.generateContent({
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
    });

    if (!result.text) return null;

    try {
      const parsed = JSON.parse(result.text) as { k: string; v: string }[];
      log(`[${target.path}] Successfully translated file`);

      return Object.fromEntries(
        parsed
          // remove hallucinations
          // biome-ignore lint/style/noNonNullAssertion: <explanation>
          .filter(({ k }) => k in source.json!)
          .map(({ k, v }) => [k, v]),
      );
    } catch (error) {
      console.error(`[${target.path}] Failed to parse Gemini response: `, error);
      console.error(`[${target.path}] Response text:`, result.text);

      return null;
    }
  };
}

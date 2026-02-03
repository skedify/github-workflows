import { getOctokit } from "@actions/github";
import { GoogleGenAI, Type } from "@google/genai";
import { createLogger, OctokitApi } from "../utils";

const log = createLogger("translator");
type ToTranslate = {
  targetLanguage: Language;
  keysToTranslate: string[];
  file: string;
  enKeyValues: Record<string, string>;
  context: { path: string; content: Record<string, string> }[];
};

const defaultLngs = ["da", "de", "en", "el", "es", "fr", "nl", "no"] as const;
type Language = (typeof defaultLngs)[number];

export async function translator({
  mainBranch,
  prBranch,
  repo,
  GITHUB_TOKEN,
  GEMINI_API_TOKEN,
  languages = defaultLngs.slice(),
}: {
  repo: string;
  mainBranch: string;
  prBranch: string;
  GITHUB_TOKEN: string;
  GEMINI_API_TOKEN: string;
  languages?: Language[];
}) {
  const api = new OctokitApi({ octokit: getOctokit(GITHUB_TOKEN), repo, branch: prBranch });

  const prSha = await api.loadRef(prBranch);
  if (!prSha) {
    log(`Branch ${prBranch} not found in repository ${repo}.`);
    return;
  }

  const { translations } = await translateI18nFiles({
    mainBranch,
    api,
    prSha,
    prBranch,
    languages,
    GEMINI_API_TOKEN,
  });

  if (!translations || translations.length === 0) {
    log("No i18n files found or no changes detected.");
    return;
  }

  await api.multiFileUpload({
    changes: [
      {
        message: "[i18n AI Translations]",
        ignoreDeletionFailures: true,
        files: Object.fromEntries(
          translations.map((file) => [file.path, `${JSON.stringify(file.content, null, 2)}\n`]),
        ),
      },
    ],
  });

  log("Done! ✅ :shipitparrot:");
}

async function translateI18nFiles({
  api,
  mainBranch,
  prBranch,
  prSha,
  languages,
  GEMINI_API_TOKEN,
}: {
  api: OctokitApi;
  mainBranch: string;
  prSha: string;
  prBranch: string;
  languages: Language[];
  GEMINI_API_TOKEN: string;
}) {
  const files = await api.compareCommits({ base: mainBranch, head: prBranch });

  // all changed i18n en files
  const i18nEnFiles = files
    ?.filter(
      (f) => f.filename.includes("/en/") && f.filename.endsWith(".json") && f.status !== "removed",
    )
    .map((f) => f);

  if (i18nEnFiles == null || i18nEnFiles.length === 0)
    return { allI18nFiles: null, contextFiles: new Map() };

  log("i18nEnFiles", i18nEnFiles);

  const additionalLanguageContextFiles = new Map<string, Language>();

  // returns a [][] of results, where each inner array corresponds to a single i18n file
  // and contains the content for each supported language.
  // If a language is not available, the content will be null.
  const allI18nFiles = await Promise.all(
    i18nEnFiles.map((enFile) =>
      Promise.all(
        languages.map(async (lng) => {
          const path = enFile.filename.replace("/en/", `/${lng}/`);
          const json = await api.getJsonFileContent<Record<string, string>>({
            ref: prSha,
            path,
          });

          const ctxFilePathParts = path.split("/");
          ctxFilePathParts[ctxFilePathParts.length - 1] = "common.json";
          const ctxFilePath = ctxFilePathParts.join("/");
          additionalLanguageContextFiles.set(ctxFilePath, lng);

          return json
            ? {
                ctxFilePath,
                lng,
                path,
                json,
                content: Object.entries(json).map(([k, v]) => ({ k, v })),
              }
            : { ctxFilePath, lng, path, json, content: null };
        }),
      ),
    ),
  );

  log("additionalLanguageContextFiles", additionalLanguageContextFiles);

  const contextFiles = new Map<Language, { path: string; content: Record<string, string> }[]>();

  await Promise.all(
    Array.from(additionalLanguageContextFiles).map(async ([ctxFile, lng]) => {
      const json =
        (await api.getJsonFileContent<Record<string, string>>({
          ref: prSha,
          path: ctxFile,
        })) ?? {};

      if (!contextFiles.has(lng)) {
        contextFiles.set(lng, []);
      }

      contextFiles.get(lng)?.push({ path: ctxFile, content: json });
    }),
  );

  const translationMap: ToTranslate[] = [];

  await Promise.all(
    allI18nFiles.map(async (translationFiles) => {
      if (translationFiles.length > 0) {
        const enFile = translationFiles[0].path.replace(`/${translationFiles[0].lng}/`, "/en/");

        const json =
          (await api.getJsonFileContent<Record<string, string>>({
            ref: prSha,
            path: enFile,
          })) ?? {};

        const enKeys = Object.keys(json);
        translationFiles.forEach((target) => {
          const keysToTranslate = enKeys.filter((k) => !Object.keys(target.json ?? {}).includes(k));

          if (keysToTranslate.length > 0) {
            translationMap.push({
              targetLanguage: target.lng,
              keysToTranslate,
              file: target.path,
              enKeyValues: Object.fromEntries(keysToTranslate.map((key) => [key, json[key]])),
              context: [
                ...(contextFiles.get(target.lng) ?? []),
                { path: target.path, content: target.json ?? {} },
              ],
            });
          }
        });
      }
    }),
  );

  const translate = createGemini({ apiKey: GEMINI_API_TOKEN });

  const translations: { path: string; content: Record<string, string> }[] = [];

  await Promise.all(
    translationMap.map(async (t) => {
      const result = await translate(t);

      const fullFile = t.context.find((f) => f.path === t.file) ?? { path: t.file, content: {} };

      translations.push({
        path: t.file,
        content: Object.fromEntries(
          Object.entries({ ...fullFile.content, ...result }).sort(([a], [b]) => a.localeCompare(b)),
        ) as Record<string, string>,
      });
    }),
  );

  return { allI18nFiles, contextFiles, translationMap, translations };
}

const lngMap: Record<Language, string> = {
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
    keysToTranslate,
    targetLanguage,
    context,
    enKeyValues,
    file,
  }: ToTranslate) {
    const responseKeys = Object.fromEntries(keysToTranslate.map((k) => [k, { type: Type.STRING }]));

    const contents = [
      ...context.map((c) => ({
        text: `Context ${c.path}: ${JSON.stringify(c.content)}`,
      })),
      {
        text: `Translate to ${lngMap[targetLanguage]} from English, preserve HTML tags and template variables denoted with {{ }}. ${JSON.stringify(enKeyValues)}`,
      },
    ];

    const result = await genAi.models.generateContent({
      model: "gemini-3-flash-preview",
      contents,
      config: {
        systemInstruction: `You are an expert ${lngMap[targetLanguage]} translator, translate the requested keys. Attempt to re-use the same vocabulary used in the provided context files.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: responseKeys,
          required: keysToTranslate,
          propertyOrdering: keysToTranslate,
        },
      },
    });

    if (!result.text) {
      return null;
    }

    try {
      const parsed = JSON.parse(result.text);
      log(`[${file}] Successfully translated file`);

      return parsed;
    } catch (error) {
      console.error(`[${file}] Failed to parse Gemini response: `, error);
      console.error(`[${file}] Response text:`, result.text);

      return null;
    }
  };
}

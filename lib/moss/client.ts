import { MossClient } from "@moss-js/moss";
import { DEFAULT_MOSS_QUERY_TIMEOUT_MS } from "./types";

// Server-only Moss client. Never import this module from a Client
// Component — it reads MOSS_PROJECT_KEY and loads the native SDK.

export type MossConfig = {
  projectId: string;
  projectKey: string;
  indexName: string;
  modelId: string;
  cachePath: string | null;
  queryTimeoutMs: number;
};

function trimEnv(name: string): string {
  const value = process.env[name];

  return typeof value === "string" ? value.trim() : "";
}

export function isMossEnabledFlag(): boolean {
  return trimEnv("MOSS_ENABLED").toLowerCase() === "true";
}

export function readMossConfig(): MossConfig | null {
  const projectId = trimEnv("MOSS_PROJECT_ID");
  const projectKey = trimEnv("MOSS_PROJECT_KEY");
  const indexName = trimEnv("MOSS_INDEX_NAME");

  if (!projectId || !projectKey || !indexName) {
    return null;
  }

  const timeoutRaw = trimEnv("MOSS_QUERY_TIMEOUT_MS");
  const timeoutParsed = timeoutRaw ? Number(timeoutRaw) : NaN;

  return {
    projectId,
    projectKey,
    indexName,
    modelId: trimEnv("MOSS_MODEL_ID") || "moss-minilm",
    cachePath: trimEnv("MOSS_CACHE_PATH") || null,
    queryTimeoutMs:
      Number.isFinite(timeoutParsed) && timeoutParsed > 0
        ? timeoutParsed
        : DEFAULT_MOSS_QUERY_TIMEOUT_MS,
  };
}

export function isMossConfigured(): boolean {
  return readMossConfig() !== null;
}

export function isMossEnabled(): boolean {
  return isMossEnabledFlag() && isMossConfigured();
}

let client: MossClient | null = null;
let clientFingerprint: string | null = null;
const loadedIndexes = new Set<string>();

function configFingerprint(config: MossConfig): string {
  return `${config.projectId}::${config.indexName}::${config.modelId}::${config.cachePath ?? ""}`;
}

export function getMossClient(): MossClient {
  const config = readMossConfig();

  if (!config) {
    throw new Error("Moss is missing required configuration.");
  }

  const fingerprint = configFingerprint(config);

  if (!client || clientFingerprint !== fingerprint) {
    client = new MossClient(
      config.projectId,
      config.projectKey,
      config.cachePath ? { cachePath: config.cachePath } : undefined
    );
    clientFingerprint = fingerprint;
    loadedIndexes.clear();
  }

  return client;
}

export async function ensureMossIndexLoaded(indexName: string): Promise<void> {
  if (loadedIndexes.has(indexName)) return;

  const config = readMossConfig();
  const clientInstance = getMossClient();

  await clientInstance.loadIndex(
    indexName,
    config?.cachePath ? { cachePath: config.cachePath } : undefined
  );

  loadedIndexes.add(indexName);
}

export function resetMossClientForTests(): void {
  client = null;
  clientFingerprint = null;
  loadedIndexes.clear();
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type BackendName = "google" | "llm" | "mymemory" | "libretranslate";
export type OutputMode = "translate" | "native";

export interface LlmBackendConfig {
  provider: string;
  model: string;
}

export interface Config {
  enabled: boolean;
  sourceLang: string;
  backend: BackendName;
  outputMode: OutputMode;
  protectCode: boolean;
  showFooterStatus: boolean;
  originalShortcut: string;
  mirrorFile: string;
  llm: LlmBackendConfig;
}

export const DEFAULT_CONFIG: Config = {
  enabled: true,
  sourceLang: "it",
  backend: "google",
  outputMode: "translate",
  protectCode: true,
  showFooterStatus: true,
  originalShortcut: "ctrl+shift+e",
  mirrorFile: "",
  llm: { provider: "google", model: "gemini-2.5-flash" },
};

function getConfigDir(): string {
  if (process.env.PI_CODING_AGENT_DIR) {
    return process.env.PI_CODING_AGENT_DIR;
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return join(home, ".pi", "agent");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "translate.json");
}

export function loadConfig(): Config {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: Config): void {
  const path = getConfigPath();
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

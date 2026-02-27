import { readFileSync } from "node:fs";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import type {
  InstagramAccountConfig,
  InstagramConfig,
  InstagramTokenSource,
  ResolvedInstagramAccount,
} from "./types.js";

export type { ResolvedInstagramAccount };

function resolveInstagramToken(
  igConfig: InstagramConfig | undefined,
  accountId: string,
): { token: string; source: InstagramTokenSource } {
  const envToken = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN?.trim();
  if (envToken && accountId === DEFAULT_ACCOUNT_ID) {
    return { token: envToken, source: "env" };
  }

  if (!igConfig) {
    return { token: "", source: "none" };
  }

  const accountConfig =
    accountId !== DEFAULT_ACCOUNT_ID ? igConfig.accounts?.[accountId] : undefined;
  const merged = accountConfig ? { ...igConfig, ...accountConfig } : igConfig;

  if (merged.tokenFile?.trim()) {
    try {
      const fileToken = readFileSync(merged.tokenFile.trim(), "utf-8").trim();
      if (fileToken) {
        return { token: fileToken, source: "configFile" };
      }
    } catch {
      // ignore read failures
    }
  }

  if (merged.pageAccessToken?.trim()) {
    return { token: merged.pageAccessToken.trim(), source: "config" };
  }

  return { token: "", source: "none" };
}

function listConfiguredAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = (cfg.channels?.instagram as InstagramConfig | undefined)?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  return Object.keys(accounts).filter(Boolean);
}

export function listInstagramAccountIds(cfg: OpenClawConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultInstagramAccountId(cfg: OpenClawConfig): string {
  const igConfig = cfg.channels?.instagram as InstagramConfig | undefined;
  if (igConfig?.defaultAccount?.trim()) {
    return igConfig.defaultAccount.trim();
  }
  const ids = listInstagramAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function mergeInstagramAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): InstagramAccountConfig {
  const raw = (cfg.channels?.instagram ?? {}) as InstagramConfig;
  const { accounts: _ignored, defaultAccount: _ignored2, ...base } = raw;
  const account =
    accountId !== DEFAULT_ACCOUNT_ID ? (raw.accounts?.[accountId] ?? {}) : {};
  return { ...base, ...account };
}

export function resolveInstagramAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedInstagramAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled =
    (params.cfg.channels?.instagram as InstagramConfig | undefined)?.enabled !== false;
  const merged = mergeInstagramAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const tokenResolution = resolveInstagramToken(
    params.cfg.channels?.instagram as InstagramConfig | undefined,
    accountId,
  );

  const pageId =
    merged.pageId?.trim() || process.env.INSTAGRAM_PAGE_ID?.trim() || "";

  return {
    accountId,
    name: merged.name?.trim() || undefined,
    enabled,
    pageAccessToken: tokenResolution.token,
    pageId,
    tokenSource: tokenResolution.source,
    config: merged,
  };
}

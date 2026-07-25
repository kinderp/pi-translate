import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig, type Config } from "./config";

const STATUS_PREFIX = "⇄";

function updateStatus(cfg: Config, ctx: ExtensionContext): void {
  if (!cfg.showFooterStatus || !ctx.hasUI) {
    ctx.ui.setStatus("translate", undefined);
    return;
  }
  const label = cfg.enabled
    ? `${STATUS_PREFIX} ${cfg.sourceLang}`
    : `${STATUS_PREFIX} off`;
  ctx.ui.setStatus("translate", ctx.ui.theme.fg("accent", label));
}

export default function (pi: ExtensionAPI): void {
  let cfg: Config = loadConfig();

  pi.on("session_start", async (_event, ctx) => {
    cfg = loadConfig();
    updateStatus(cfg, ctx);
  });

  pi.registerCommand("translate", {
    description: "Toggle translation on/off",
    handler: async (_args, ctx) => {
      cfg.enabled = !cfg.enabled;
      saveConfig(cfg);
      updateStatus(cfg, ctx);
      ctx.ui.notify(
        `Translation ${cfg.enabled ? "enabled" : "disabled"}`,
        "info",
      );
    },
  });
}

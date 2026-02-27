import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { instagramDock, instagramPlugin } from "./src/channel.js";
import { handleInstagramWebhookRequest } from "./src/monitor.js";
import { setInstagramRuntime } from "./src/runtime.js";

const plugin = {
  id: "instagram",
  name: "Instagram",
  description: "Instagram DM channel plugin (Messenger Platform)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setInstagramRuntime(api.runtime);
    api.registerChannel({ plugin: instagramPlugin, dock: instagramDock });
    api.registerHttpHandler(handleInstagramWebhookRequest);
  },
};

export default plugin;

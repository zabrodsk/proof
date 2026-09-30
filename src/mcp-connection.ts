export type McpPlatform = "chatgpt" | "claude";
export type McpConfiguration = {
  mcpEnabled: boolean;
  mcpUrl?: string;
  platforms?: string[];
  scopes?: string[];
};

// Both the app and the public guide use these platform instructions. The app's
// authenticated configuration is the only source for server URLs and availability.
export const mcpPlatforms = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    logo: "chatgpt.svg",
    settingsUrl: "https://chatgpt.com/",
    steps: [
      "Open ChatGPT on the web. In Settings, open Apps and enable developer mode if your workspace allows it.",
      "Choose Create in Apps. Name the app Proof and paste the server URL from this page.",
      "Select OAuth, then Scan Tools. Sign in to Proof and review the requested permissions before creating the app.",
      "Select Proof from the tools menu in a chat, then ask it to check a passage.",
    ],
    note: "Your ChatGPT plan and workspace permissions must allow custom apps and the tool actions used to start checks.",
    guide:
      "https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt",
  },
  {
    id: "claude",
    name: "Claude",
    logo: "claude.png",
    settingsUrl: "https://claude.ai/customize/connectors",
    steps: [
      "Open Customize, then Connectors in Claude.",
      "Choose Add custom connector, name it Proof, and paste the server URL from this page. Team and Enterprise owners add it for their organization first.",
      "Choose Connect and sign in to Proof. Review the requested permissions.",
      "Open the plus menu in a conversation, choose Connectors, and enable Proof.",
    ],
    note: "If advanced settings need OAuth client details, ask your workspace owner for the registered client information.",
    guide:
      "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  },
] as const;

export function connectionState(configuration?: McpConfiguration) {
  if (!configuration) return { ready: false, reason: "loading" as const };
  if (!configuration.mcpEnabled)
    return { ready: false, reason: "disabled" as const };
  try {
    const url = new URL(configuration.mcpUrl || "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return { ready: false, reason: "invalid_url" as const };
  } catch {
    return { ready: false, reason: "invalid_url" as const };
  }
  if (
    !mcpPlatforms.some((platform) =>
      configuration.platforms?.includes(platform.id),
    )
  )
    return { ready: false, reason: "no_platforms" as const };
  return { ready: true, reason: "ready" as const, url: configuration.mcpUrl! };
}

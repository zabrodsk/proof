import { useEffect } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import "./landing-connections.css";

const platforms = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    logo: "chatgpt.svg",
    steps: [
      "Open ChatGPT on the web. If your workspace permits custom apps, enable developer mode in Apps settings.",
      "Choose Apps, then Create. Name the app Proof and enter the connection URL from your Proof settings.",
      "Select OAuth, scan the tools, and sign in to Proof. Review the permissions, then create the app.",
      "Select Proof in a chat and ask it to check the exact passage you provide.",
    ],
    note: "Starting checks requires full MCP tool access. Availability depends on your ChatGPT plan and workspace permissions.",
    guide:
      "https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt",
  },
  {
    id: "claude",
    name: "Claude",
    logo: "claude.png",
    steps: [
      "Open Customize, then Connectors in Claude.",
      "Choose Add custom connector and enter the connection URL from your Proof settings. A team owner may need to add it first.",
      "Connect and sign in with your Proof account. Review the requested permissions.",
      "Enable Proof for the conversation from the chat's connectors menu.",
    ],
    note: "If advanced settings request client details, get the registered client information from your workspace owner.",
    guide:
      "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  },
];

export default function LandingConnections({
  settingsHref = "/app/integrations#connect",
}: {
  settingsHref?: string;
}) {
  useEffect(() => {
    if (window.location.hash === "#connect")
      document.getElementById("connect")?.scrollIntoView({ block: "start" });
  }, []);
  return (
    <div className="lp-connect">
      <div className="lp-connect-copy">
        <h2>
          Your chat.
          <br />
          <em>With the evidence.</em>
        </h2>
        <p>
          Check claims and find sources from ChatGPT or Claude. Open your Proof
          report to read the evidence.
        </p>
      </div>
      <div className="lp-connect-platforms">
        {platforms.map((platform) => (
          <details className="lp-connect-platform" key={platform.name}>
            <summary aria-label={`${platform.name} setup instructions`}>
              <img
                src={`/images/ai/${platform.logo}`}
                alt=""
                width="32"
                height="32"
              />
              <h3 className={`lp-platform-name lp-platform-${platform.id}`}>
                {platform.name}
              </h3>
              <a
                className="lp-platform-connect"
                href={`${settingsHref.split("#")[0]}${settingsHref.includes("?") ? "&" : "?"}platform=${platform.id}#connect`}
                aria-label={`Connect ${platform.name}`}
              >
                Connect <ArrowUpRight size={16} aria-hidden="true" />
              </a>
              <Plus size={18} aria-hidden="true" />
            </summary>
            <div className="lp-connect-instructions">
              <ol>
                {platform.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p>{platform.note}</p>
              <a
                href={platform.guide}
                target="_blank"
                rel="noopener noreferrer"
              >
                {platform.name} setup guide{" "}
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

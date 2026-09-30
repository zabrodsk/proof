import { useEffect } from "react";
import { ArrowRight, ArrowUpRight, Plus, FileCheck2 } from "lucide-react";
import "./landing-connections.css";

const platforms = [
  {
    name: "ChatGPT",
    logo: "chatgpt.svg",
    description: "Bring an evidence check into your next conversation.",
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
    name: "Claude",
    logo: "claude.png",
    description: "Ask about a claim. Follow it back to the source.",
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
      <div className="lp-connect-intro">
        <div className="lp-connect-copy">
          <h2>
            Your chat.
            <br />
            <em>With the evidence.</em>
          </h2>
          <p>
            Use Proof from ChatGPT or Claude. Check a passage, compare it with
            your sources, or find research without leaving the conversation.
          </p>
          <a className="lp-connect-cta" href={settingsHref}>
            Connect your chat <ArrowRight size={18} aria-hidden="true" />
          </a>
        </div>
        <div className="lp-connect-paper">
          <div className="lp-connect-paper-heading">
            <span className="lp-connect-dot" />
            Try this in your chat
          </div>
          <blockquote>
            “Proof, check this passage. Show me the evidence and anything you
            couldn’t verify.”
          </blockquote>
          <div className="lp-connect-paper-footer">
            <FileCheck2 size={24} strokeWidth={1.5} aria-hidden="true" />
            <span>
              Add your passage.
              <br />
              <strong>Open the report to read the sources.</strong>
            </span>
          </div>
        </div>
      </div>
      <div className="lp-connect-platforms">
        {platforms.map((platform) => (
          <article className="lp-connect-platform" key={platform.name}>
            <div className="lp-connect-platform-heading">
              <span className="lp-connect-brand">
                <img
                  src={`/images/ai/${platform.logo}`}
                  alt=""
                  width="30"
                  height="30"
                />
              </span>
              <h3>Proof in {platform.name}</h3>
              <ArrowUpRight size={22} strokeWidth={1.4} aria-hidden="true" />
            </div>
            <p>{platform.description}</p>
            <details>
              <summary>
                How to connect <Plus size={18} aria-hidden="true" />
              </summary>
              <ol>
                {platform.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="lp-connect-note">{platform.note}</p>
              <a
                className="lp-connect-guide-link"
                href={platform.guide}
                target="_blank"
                rel="noopener noreferrer"
              >
                {platform.name} setup guide{" "}
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </details>
          </article>
        ))}
      </div>
      <div className="lp-connect-bottom">
        <p>
          Connect through MCP in your Proof settings. Choose which sources to
          share, and disconnect at any time. Your workspace needs MCP enabled.
        </p>
        <details className="lp-connect-help">
          <summary>
            Can’t connect? <Plus size={16} aria-hidden="true" />
          </summary>
          <p>
            Use the connection URL from your signed-in Proof workspace. If the
            connection option is missing, check your chat account and workspace
            permissions. If sign-in fails, reconnect or ask your workspace owner
            to check setup.
          </p>
        </details>
      </div>
    </div>
  );
}

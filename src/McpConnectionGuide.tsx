import { useState } from "react";
import { Check, Copy, ArrowUpRight, MessageSquare } from "lucide-react";
import "./mcp-connect.css";

type Props = {
  configuration?: {
    mcpEnabled: boolean;
    mcpUrl?: string;
    platforms?: string[];
  };
  publicGuide?: boolean;
};
export default function McpConnectionGuide({
  configuration,
  publicGuide = false,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const enabled = configuration?.mcpEnabled && !!configuration.mcpUrl;
  async function copyUrl() {
    if (!enabled) return;
    try {
      await navigator.clipboard.writeText(configuration!.mcpUrl!);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("Copy the connection URL from the field above.");
    }
  }
  return (
    <div className="proof-mcp-guide">
      <div className="proof-mcp-intro">
        <MessageSquare size={26} aria-hidden="true" />
        <div>
          <h2>Use Proof from ChatGPT or Claude</h2>
          <p>
            Check a passage, compare it with your sources, or find research.
            Open the saved report to read the evidence.
          </p>
        </div>
      </div>
      {publicGuide ? (
        <div className="proof-mcp-url">
          <p>
            Remote MCP connects your chat to Proof. Setup is available when your
            Proof deployment has MCP enabled.
          </p>
          <a href="/app/integrations#connect">
            Open connection settings{" "}
            <ArrowUpRight size={17} aria-hidden="true" />
          </a>
        </div>
      ) : enabled ? (
        <div className="proof-mcp-url">
          <label htmlFor="proof-mcp-url">Your Proof connection URL</label>
          <div className="proof-mcp-copy">
            <input
              id="proof-mcp-url"
              readOnly
              value={configuration!.mcpUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" onClick={() => void copyUrl()}>
              {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
              {copied ? "Copied" : "Copy URL"}
            </button>
          </div>
          <p role="status">
            {copyError ||
              (copied
                ? "Connection URL copied."
                : "Use this URL for the remote MCP server. Sign in with your Proof account.")}
          </p>
        </div>
      ) : (
        <p className="proof-mcp-unavailable" role="status">
          {configuration
            ? "MCP connections are not enabled on this deployment yet. Your workspace owner needs to finish setup before you can connect."
            : "Checking this deployment's connection settings..."}
        </p>
      )}
      <div className="proof-mcp-platforms">
        <article>
          <h3>ChatGPT</h3>
          {!publicGuide &&
            enabled &&
            configuration?.platforms &&
            !configuration.platforms.includes("chatgpt") && (
              <p className="proof-mcp-unavailable">
                ChatGPT is not enabled on this deployment.
              </p>
            )}
          <ol>
            <li>
              Open ChatGPT on the web. If your workspace permits custom apps,
              enable developer mode in Apps settings.
            </li>
            <li>
              Choose Apps, then Create. Name the app Proof and enter the
              connection URL.
            </li>
            <li>
              Select OAuth, scan the tools, and sign in to Proof. Review the
              permissions, then create the app.
            </li>
            <li>
              Select Proof in a chat and ask it to check the exact passage you
              provide.
            </li>
          </ol>
          <p className="proof-mcp-note">
            Starting checks requires full MCP tool access. Your ChatGPT plan and
            workspace permissions determine whether this is available.
          </p>
          <a
            href="https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt"
            target="_blank"
            rel="noopener noreferrer"
          >
            ChatGPT setup guide <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </article>
        <article>
          <h3>Claude</h3>
          {!publicGuide &&
            enabled &&
            configuration?.platforms &&
            !configuration.platforms.includes("claude") && (
              <p className="proof-mcp-unavailable">
                Claude is not enabled on this deployment.
              </p>
            )}
          <ol>
            <li>Open Customize, then Connectors in Claude.</li>
            <li>
              Choose Add custom connector and enter the Proof connection URL. A
              team owner may need to add it first.
            </li>
            <li>
              Connect and sign in with your Proof account. Review the requested
              permissions.
            </li>
            <li>
              Enable Proof for the conversation from the chat's connectors menu.
            </li>
          </ol>
          <p className="proof-mcp-note">
            If advanced settings request client details, get the registered
            client information from your workspace owner.
          </p>
          <a
            href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
            target="_blank"
            rel="noopener noreferrer"
          >
            Claude setup guide <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </article>
      </div>
      <div className="proof-mcp-example">
        <p>Try this in your chat</p>
        <blockquote>
          "Proof, check the factual claims in this passage. Show the evidence
          and anything you could not verify: [paste your passage]"
        </blockquote>
      </div>
      <p className="proof-mcp-note">
        For a source check, upload the original files to Proof and choose which
        sources to share in connection settings. Disconnect there to revoke
        platform access. Proof checks the text you submit and keeps uncertainty
        visible.
      </p>
      <details className="proof-mcp-help">
        <summary>Can't connect?</summary>
        <p>
          Use the URL from your signed-in Proof workspace. Remote connectors
          need a reachable HTTPS server. If the connection option is missing,
          check your chat account and workspace permissions. If sign-in fails or
          expires, reconnect or ask your workspace owner to verify the OAuth
          setup.
        </p>
      </details>
    </div>
  );
}

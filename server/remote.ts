import https from "node:https";
import { lookup } from "node:dns/promises";

export function publicIPv4(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
    return false;
  const [a, b, c] = p;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export async function remoteFile(
  input: string,
  hops = 0,
): Promise<{ buffer: Buffer; url: string; type: string }> {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    hops > 4
  )
    throw new Error("Use a public HTTPS document link.");
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some((a) => !publicIPv4(a.address)))
    throw new Error("This address is not a public document server.");
  const address = addresses[0].address;
  const response = await new Promise<{
    buffer: Buffer;
    type: string;
    location?: string;
  }>((resolve, reject) => {
    const req = https.get(
      url,
      {
        family: 4,
        lookup: (_host, _opts, cb) => cb(null, address, 4),
        headers: {
          "User-Agent": "Proof/0.2 academic-source-review",
          Accept: "application/pdf,text/html,text/plain,*/*",
        },
      },
      (res) => {
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode)
        ) {
          res.resume();
          resolve({
            buffer: Buffer.alloc(0),
            type: "",
            location: res.headers.location,
          });
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume();
          reject(
            new Error(
              `Document server returned HTTP ${res.statusCode}. Upload the file if it needs a login.`,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 12 * 1024 * 1024) {
            req.destroy(new Error("Document exceeds 12 MB."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            buffer: Buffer.concat(chunks),
            type: String(res.headers["content-type"] || ""),
          }),
        );
        res.on("error", reject);
      },
    );
    const timer = setTimeout(
      () =>
        req.destroy(
          new Error("Document download timed out. Try uploading the file."),
        ),
      25000,
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
  });
  if (response.location)
    return remoteFile(new URL(response.location, url).href, hops + 1);
  return { ...response, url: url.href };
}

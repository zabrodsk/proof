// Repair UTF-8 filenames decoded as Latin-1 by older multipart uploads.
// Only replace titles with a recognizable encoding error and a valid decode.
export function readableDocumentTitle(title: string): string {
  if (!/[ÃÂÅ][\u0080-\u00bf]/u.test(title)) return title;
  if ([...title].some((character) => character.codePointAt(0)! > 255)) return title;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from([...title], (character) => character.charCodeAt(0)),
    );
  } catch {
    return title;
  }
}

export const limits = {
  fileBytes: 64 * 1024 * 1024,
  pages: 1000,
  characters: 8_000_000,
  bibliographyEntries: 500,
  draftCharacters: 150_000,
  small: { claims: 10, providerCalls: 50, candidates: 4 },
  standard: { claims: 100, providerCalls: 500, candidates: 8 },
};
export const versions = {
  parser: "proof-pages-2",
  prompt: "proof-assessment-1",
  policy: "proof-policy-1",
  embedding: "Xenova/bge-small-en-v1.5",
};
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const notFound = () =>
  new HttpError(404, "Record not found in this workspace.");

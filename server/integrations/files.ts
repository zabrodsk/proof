import type { ImportInput } from "../../shared/integrations/contracts.js";
export function decodeFile(
  item: Extract<ImportInput["items"][number], { kind: "file" }>,
) {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      item.base64,
    )
  )
    throw Error("Invalid file bytes.");
  const buffer = Buffer.from(item.base64, "base64");
  if (!buffer.length || buffer.length > 12 * 1024 * 1024)
    throw Error("Files must be between 1 byte and 12 MB.");
  const extension = item.filename.toLowerCase().split(".").pop();
  const expected: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    md: "text/markdown",
  };
  if (expected[extension || ""] !== item.contentType)
    throw Error("The filename and content type do not agree.");
  if (
    extension === "pdf" &&
    !buffer.subarray(0, 1024).toString().includes("%PDF-")
  )
    throw Error("Invalid PDF bytes.");
  if (extension === "docx" && buffer.subarray(0, 2).toString() !== "PK")
    throw Error("Invalid DOCX bytes.");
  if (["txt", "md"].includes(extension || ""))
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  return buffer;
}

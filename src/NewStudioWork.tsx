import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FileText,
  LoaderCircle,
  Upload,
  X,
} from "lucide-react";
import "./studio-document.css";
import StudioWorkIcon, { workIconOptions } from "./StudioWorkIcon";
import type { WorkIconName } from "./studio-api";

export default function NewStudioWork({
  initialMode = "upload",
  busy,
  onCreate,
  onCancel,
}: {
  initialMode?: "upload" | "paste";
  busy: boolean;
  onCreate: (
    title: string,
    text: string,
    icon: WorkIconName,
    retrieveSources: boolean,
  ) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<WorkIconName>("folder");
  const [pickerOpen, setPickerOpen] = useState(false);
  const iconTrigger = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState("");
  const [retrieveSources, setRetrieveSources] = useState(true);
  const [filename, setFilename] = useState("");
  const [mode, setMode] = useState<"upload" | "paste">(initialMode);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | undefined>(undefined);
  const titleRef = useRef(title);
  titleRef.current = title;
  useEffect(() => () => request.current?.abort(), []);
  async function importFile(file: File) {
    if (busy || importing) return;
    setError("");
    if (!/\.(pdf|docx|txt|md)$/i.test(file.name)) {
      setError("Choose a PDF, Word .docx, text, or Markdown file.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("Choose a file smaller than 12 MB.");
      return;
    }
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setImporting(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/documents/import", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Could not read this document.");
      if (typeof result.text !== "string" || !result.text.trim())
        throw Error("No readable text found in this file.");
      if (result.text.length > 100000)
        throw Error(
          "This document is too long. Upload a section with up to 100,000 characters.",
        );
      setText(result.text);
      setFilename(file.name);
      if (!titleRef.current.trim())
        setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 300));
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setImporting(false);
    }
  }
  return (
    <form
      className="ps-new-work"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() && !busy && !importing)
          onCreate(title.trim(), text, icon, retrieveSources);
      }}
    >
      <label className="ps-field-label" htmlFor="new-work-title">
        Work title
      </label>
      <div
        className="ps-new-work-name"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setPickerOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && pickerOpen) {
            event.preventDefault();
            event.stopPropagation();
            setPickerOpen(false);
            iconTrigger.current?.focus();
          }
        }}
      >
        <button
          type="button"
          ref={iconTrigger}
          className="ps-new-work-icon-trigger"
          aria-label="Choose project icon"
          aria-expanded={pickerOpen}
          aria-controls="ps-new-work-icon-picker"
          disabled={busy || importing}
          onClick={() => setPickerOpen((open) => !open)}
        >
          <StudioWorkIcon name={icon} size={21} />
          <ChevronDown size={13} />
        </button>
        <input
          autoFocus
          id="new-work-title"
          className="ps-field ps-new-work-title"
          placeholder="Give your work a name"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={300}
          disabled={busy || importing}
          required
        />
        {pickerOpen && (
          <div
            id="ps-new-work-icon-picker"
            className="ps-new-work-icon-picker"
            role="group"
            aria-label="Project icons"
          >
            {workIconOptions.map((option) => (
              <button
                key={option.name}
                type="button"
                title={option.label}
                aria-label={`${option.label} icon`}
                aria-pressed={icon === option.name}
                onClick={() => {
                  setIcon(option.name);
                  setPickerOpen(false);
                  iconTrigger.current?.focus();
                }}
              >
                <option.Icon size={22} strokeWidth={1.6} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="ps-attachment-label">
        <span>Document</span>
        <span>Optional</span>
      </div>
      <div className="ps-import-tabs" aria-label="Document input">
        <button
          type="button"
          className={mode === "upload" ? "active" : ""}
          aria-pressed={mode === "upload"}
          onClick={() => setMode("upload")}
          disabled={importing || busy}
        >
          <Upload size={16} /> Upload document
        </button>
        <button
          type="button"
          className={mode === "paste" ? "active" : ""}
          aria-pressed={mode === "paste"}
          onClick={() => setMode("paste")}
          disabled={importing || busy}
        >
          <FileText size={16} /> Paste text
        </button>
      </div>
      {mode === "upload" && (
        <>
          <input
            ref={inputRef}
            type="file"
            className="ps-upload-input"
            aria-label="Choose document file"
            accept=".pdf,.docx,.txt,.md"
            disabled={busy || importing}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importFile(file);
            }}
          />
          {(!filename || importing) && (
            <button
              type="button"
              className={`ps-upload-drop ${dragging ? "dragging" : ""}`}
              disabled={busy || importing}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                if (!busy && !importing) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const files = event.dataTransfer.files;
                if (files.length > 1) {
                  setError("Add one document at a time.");
                  return;
                }
                if (files[0]) void importFile(files[0]);
              }}
            >
              <span className="ps-upload-icon">
                {importing ? (
                  <LoaderCircle size={26} className="ps-import-spinner" />
                ) : (
                  <Upload size={26} />
                )}
              </span>
              <strong>
                {importing
                  ? "Reading your document..."
                  : filename
                    ? "Choose a different document"
                    : "Drop your document here"}
              </strong>
              <span>
                {importing
                  ? "Extracting the text for your preview."
                  : "or click to browse"}
              </span>
              <small>PDF, DOCX, TXT or Markdown · Up to 12 MB</small>
            </button>
          )}
        </>
      )}
      {error && (
        <p className="ps-live-error" role="alert">
          {error}
        </p>
      )}
      {filename && (
        <div className="ps-import-file">
          <span className="ps-import-file-check">
            <CheckCircle2 size={20} />
          </span>
          <span>
            {filename}
            <small>
              {text.trim().split(/\s+/).filter(Boolean).length} words extracted
            </small>
          </span>
          {mode === "upload" && (
            <button
              type="button"
              className="ps-import-replace"
              disabled={busy || importing}
              onClick={() => inputRef.current?.click()}
            >
              Change
            </button>
          )}
          <button
            type="button"
            className="ps-icon-button"
            aria-label="Remove imported document"
            disabled={busy || importing}
            onClick={() => {
              setFilename("");
              setText("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {(mode === "paste" || text) && (
        <div className="ps-import-preview">
          <label className="ps-field-label" htmlFor="new-work-text">
            {filename ? "Review the extracted text" : "Your document"}
          </label>
          <textarea
            id="new-work-text"
            placeholder="Paste your writing here..."
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={100000}
            disabled={busy || importing}
          />
          <small>
            {text.trim().split(/\s+/).filter(Boolean).length} words · You can
            edit this before creating your work.
          </small>
        </div>
      )}
      <p className="ps-editor-hint">
        References in your document are automatically added to Your sources. You
        can add more sources afterward.
      </p>
      <label className="ps-setup-consent">
        <input
          type="checkbox"
          checked={retrieveSources}
          onChange={(event) => setRetrieveSources(event.target.checked)}
          disabled={busy || importing}
        />
        <span>
          Allow Proof to look up cited works and retrieve available source text
          using external services.
        </span>
      </label>
      <div className="ps-actions">
        <button
          type="button"
          className="ps-outline"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="ps-primary"
          disabled={busy || importing || !title.trim()}
        >
          {busy ? "Creating..." : "Create work"}
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}

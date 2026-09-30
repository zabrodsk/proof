import {
  BookOpen,
  FileText,
  FlaskConical,
  Folder,
  GraduationCap,
  Lightbulb,
  NotebookPen,
} from "lucide-react";
import type { WorkIconName } from "./studio-api";

export const workIconOptions = [
  { name: "folder", label: "Folder", Icon: Folder },
  { name: "document", label: "Document", Icon: FileText },
  { name: "book", label: "Book", Icon: BookOpen },
  { name: "notes", label: "Notes", Icon: NotebookPen },
  { name: "research", label: "Research", Icon: FlaskConical },
  { name: "study", label: "Study", Icon: GraduationCap },
  { name: "idea", label: "Idea", Icon: Lightbulb },
] as const;

export default function StudioWorkIcon({
  name,
  size,
}: {
  name?: WorkIconName;
  size: number;
}) {
  const Icon =
    workIconOptions.find((option) => option.name === name)?.Icon ?? FileText;
  return <Icon size={size} strokeWidth={1.6} aria-hidden="true" />;
}

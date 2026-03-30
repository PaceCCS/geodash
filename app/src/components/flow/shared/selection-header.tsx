import { Button } from "@/components/ui/button";
import { formatShortcutForDisplay } from "@/contexts/keybind-provider";

type SelectionHeaderProps = {
  kindLabel: string;
  title: string;
  query: string;
  onEdit?: () => void;
  editLabel?: string;
  editShortcut?: string;
};

export function SelectionHeader({
  kindLabel,
  title,
  query,
  onEdit,
  editLabel = "Edit",
  editShortcut,
}: SelectionHeaderProps) {
  const shortcutLabel = editShortcut
    ? formatShortcutForDisplay(editShortcut)
    : null;

  return (
    <div className="px-4 py-3 border-b border-border sticky top-0 bg-background">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {kindLabel}
          </p>
          <p className="text-sm font-medium break-words">{title}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
            {query}
          </p>
        </div>
        {onEdit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 gap-2"
            onClick={onEdit}
          >
            <span>{editLabel}</span>
            {shortcutLabel ? (
              <kbd className="bg-muted text-muted-foreground pointer-events-none inline-flex h-5 items-center rounded border px-1.5 font-mono text-[10px] font-medium select-none">
                {shortcutLabel}
              </kbd>
            ) : null}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

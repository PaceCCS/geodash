import { RotateCcw } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAppSettings } from "@/hooks/use-app-settings";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const preferredDirectory = useAppSettings(
    (state) => state.preferredDirectory,
  );
  const useLastSelectionParent = useAppSettings(
    (state) => state.useLastSelectionParent,
  );
  const setPreferredDirectory = useAppSettings(
    (state) => state.setPreferredDirectory,
  );
  const setUseLastSelectionParent = useAppSettings(
    (state) => state.setUseLastSelectionParent,
  );
  const resetSettings = useAppSettings((state) => state.resetSettings);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
      <div className="border-b border-border px-6 py-2">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <Button type="button" variant="outline" onClick={resetSettings}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Restore defaults
          </Button>
        </div>
      </div>

      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <section className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-border" />
            <h2 className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              General
            </h2>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <SettingRow
              title="Preferred directory"
              description="The starting folder used when a directory or file picker opens. Leave empty to use the default location."
            >
              <Input
                value={preferredDirectory}
                onChange={(event) => setPreferredDirectory(event.target.value)}
                placeholder="~/"
                className="w-full md:w-96"
              />
            </SettingRow>

            <SettingRow
              title="Use last project parent"
              description="After selecting a directory, use its parent folder as the next preferred directory. Useful when related projects live side-by-side."
            >
              <Switch
                checked={useLastSelectionParent}
                onCheckedChange={setUseLastSelectionParent}
                aria-label="Use parent of last selected directory as preferred directory"
              />
            </SettingRow>
          </div>
        </section>
      </main>
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border px-6 py-6 last:border-b-0 md:flex-row md:items-center md:justify-between">
      <div className="max-w-2xl space-y-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

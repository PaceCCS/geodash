"use client";

import { FilePlus, Settings } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Button } from "./ui/button";
import { CmdOrCtrl } from "./ui/command";

import {
  formatShortcutForDisplay,
  useCommands,
} from "@/contexts/keybind-provider";
import type { DialogAPI } from "@/contexts/keybind-provider";

export function GlobalCommandDialog() {
  const {
    isCommandPaletteOpen,
    openPalette,
    closePalette,
    commands,
    runCommand,
  } = useCommands([
    {
      id: "new",
      label: "New",
      run: (dialog: DialogAPI) => {
        console.log("New document");
        dialog.close();
      },
      group: "Suggestions",
      icon: <FilePlus />,
    },
    {
      id: "settings",
      label: "Settings",
      run: (dialog: DialogAPI) => {
        console.log("Settings");
        dialog.close();
      },
      shortcut: "Mod+S",
      group: "Settings",
      icon: <Settings />,
    },
  ]);

  const groups = Array.from(
    commands.reduce<Map<string | undefined, typeof commands>>((map, cmd) => {
      const key = cmd.group;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(cmd);
      return map;
    }, new Map()),
  );

  return (
    <>
      <Button
        variant="ghost"
        aria-label="Open command dialog"
        onClick={openPalette}
        size="sm"
      >
        View Commands
        <span className="text-muted-foreground text-sm">
          <kbd className="bg-muted text-muted-foreground pointer-events-none inline-flex h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100 select-none">
            <span className="text-xs">
              <CmdOrCtrl />
            </span>
            J
          </kbd>
        </span>
      </Button>

      <CommandDialog
        open={isCommandPaletteOpen}
        onOpenChange={(open) => (open ? openPalette() : closePalette())}
      >
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {groups.map(([groupName, groupCommands]) => (
            <CommandGroup key={groupName ?? "ungrouped"} heading={groupName}>
              {groupCommands.map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  onSelect={() => runCommand(cmd, { closeAfter: true })}
                >
                  {cmd.icon}
                  <span>{cmd.label}</span>
                  {cmd.shortcut ? (
                    <CommandShortcut>
                      {formatShortcutForDisplay(cmd.shortcut)}
                    </CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}

"use client";

import {
  FilePlus,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

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
import { useSidebar } from "@/components/ui/sidebar";
import { useRightSidebar } from "@/contexts/right-sidebar-context";

export function GlobalCommandDialog() {
  const { open: leftOpen, toggleSidebar: toggleLeft } = useSidebar();
  const { open: rightOpen, toggle: toggleRight } = useRightSidebar();

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
    {
      id: "toggle-left-sidebar",
      label: leftOpen ? "Close Left Sidebar" : "Open Left Sidebar",
      run: (dialog: DialogAPI) => {
        toggleLeft();
        dialog.close();
      },
      shortcut: "Mod+B",
      group: "View",
      icon: leftOpen ? <PanelLeftClose /> : <PanelLeftOpen />,
    },
    {
      id: "toggle-right-sidebar",
      label: rightOpen ? "Close Right Sidebar" : "Open Right Sidebar",
      run: (dialog: DialogAPI) => {
        toggleRight();
        dialog.close();
      },
      shortcut: "Mod+.",
      group: "View",
      icon: rightOpen ? <PanelRightClose /> : <PanelRightOpen />,
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

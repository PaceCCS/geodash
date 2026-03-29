"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ShortcutString = string;

export type KeybindHandler = (event: KeyboardEvent) => void;

export type KeybindOptions = {
  preventDefault?: boolean;
  stopPropagation?: boolean;
  enabled?: boolean | (() => boolean);
  priority?: number;
};

export type RegisteredKeybind = {
  shortcut: ShortcutString;
  handler: KeybindHandler;
  options: Required<Omit<KeybindOptions, "enabled">> & {
    enabled?: KeybindOptions["enabled"];
  };
};

export type DialogAPI = {
  open: () => void;
  close: () => void;
  toggle: () => void;
};

export type CommandItem = {
  id: string;
  label: string;
  run: (dialog: DialogAPI) => void | Promise<void>;
  shortcut?: ShortcutString;
  group?: string;
  icon?: React.ReactNode;
};

export type KeybindContextValue = {
  bind: (
    shortcut: ShortcutString,
    handler: KeybindHandler,
    options?: KeybindOptions
  ) => () => void;
  registerCommand: (command: CommandItem) => () => void;
  commands: CommandItem[];
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
};

function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
}

export function normalizeShortcut(shortcut: ShortcutString): {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
} {
  const tokens = shortcut
    .split("+")
    .map((t) => t.trim())
    .filter(Boolean);

  let ctrlKey = false;
  let metaKey = false;
  let altKey = false;
  let shiftKey = false;
  let keyToken = "";

  for (const tokenRaw of tokens) {
    const token = tokenRaw.toLowerCase();
    if (token === "mod") {
      if (isMacPlatform()) metaKey = true;
      else ctrlKey = true;
    } else if (token === "cmd" || token === "meta") {
      metaKey = true;
    } else if (token === "ctrl" || token === "control") {
      ctrlKey = true;
    } else if (token === "alt" || token === "option") {
      altKey = true;
    } else if (token === "shift") {
      shiftKey = true;
    } else {
      keyToken = tokenRaw;
    }
  }

  return { key: keyToken, ctrlKey, metaKey, altKey, shiftKey };
}

function eventMatchesShortcut(e: KeyboardEvent, shortcut: ShortcutString) {
  const s = normalizeShortcut(shortcut);
  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const shortcutKey = s.key.length === 1 ? s.key.toLowerCase() : s.key;
  return (
    !!s.ctrlKey === !!e.ctrlKey &&
    !!s.metaKey === !!e.metaKey &&
    !!s.altKey === !!e.altKey &&
    !!s.shiftKey === !!e.shiftKey &&
    (shortcutKey === "" || eventKey === shortcutKey)
  );
}

const KeybindContext = createContext<KeybindContextValue | null>(null);

export function useKeybindContext() {
  const ctx = useContext(KeybindContext);
  if (!ctx)
    throw new Error("useKeybindContext must be used within a KeybindProvider");
  return ctx;
}

export function useKeybind(
  shortcut: ShortcutString,
  handler: KeybindHandler,
  options?: KeybindOptions
) {
  const { bind } = useKeybindContext();
  useEffect(
    () => bind(shortcut, handler, options),
    [bind, shortcut, handler, options]
  );
}

export default function KeybindProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const toggleCommandPalette = useCallback(
    () => setCommandPaletteOpen((v) => !v),
    []
  );

  const keybindsRef = useRef<RegisteredKeybind[]>([]);
  const [commands, setCommands] = useState<CommandItem[]>([]);

  const bind = useCallback<KeybindContextValue["bind"]>(
    (shortcut, handler, options) => {
      const reg: RegisteredKeybind = {
        shortcut,
        handler,
        options: {
          preventDefault: options?.preventDefault ?? true,
          stopPropagation: options?.stopPropagation ?? false,
          priority: options?.priority ?? 0,
          enabled: options?.enabled,
        },
      };

      keybindsRef.current = [...keybindsRef.current, reg].sort(
        (a, b) => b.options.priority - a.options.priority
      );

      return () => {
        keybindsRef.current = keybindsRef.current.filter((r) => r !== reg);
      };
    },
    []
  );

  const commandUnbindsRef = useRef<Map<string, () => void>>(new Map());

  const registerCommand = useCallback<KeybindContextValue["registerCommand"]>(
    (command) => {
      setCommands((prev) => {
        const idx = prev.findIndex((c) => c.id === command.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = command;
          return next;
        }
        return [...prev, command];
      });

      const prevUnbind = commandUnbindsRef.current.get(command.id);
      if (prevUnbind) prevUnbind();
      commandUnbindsRef.current.delete(command.id);

      if (command.shortcut) {
        const unbind = bind(command.shortcut, () => {
          command.run({
            open: () => setCommandPaletteOpen(true),
            close: () => setCommandPaletteOpen(false),
            toggle: toggleCommandPalette,
          });
        });
        commandUnbindsRef.current.set(command.id, unbind);
      }

      return () => {
        setCommands((prev) => prev.filter((c) => c.id !== command.id));
        const unbind = commandUnbindsRef.current.get(command.id);
        if (unbind) unbind();
        commandUnbindsRef.current.delete(command.id);
      };
    },
    [bind, toggleCommandPalette]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      for (let i = 0; i < keybindsRef.current.length; i++) {
        const reg = keybindsRef.current[i];
        const enabled =
          typeof reg.options.enabled === "function"
            ? reg.options.enabled()
            : reg.options.enabled ?? true;
        if (!enabled) continue;
        if (eventMatchesShortcut(e, reg.shortcut)) {
          if (reg.options.preventDefault) e.preventDefault();
          if (reg.options.stopPropagation) e.stopPropagation();
          reg.handler(e);
          break;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const unbind = bind(
      "Mod+J",
      () => {
        toggleCommandPalette();
      },
      { preventDefault: true, priority: 10 }
    );
    return () => unbind();
  }, [bind, toggleCommandPalette]);

  const value = useMemo<KeybindContextValue>(
    () => ({
      bind,
      registerCommand,
      commands,
      isCommandPaletteOpen,
      setCommandPaletteOpen,
      toggleCommandPalette,
    }),
    [
      bind,
      registerCommand,
      commands,
      isCommandPaletteOpen,
      toggleCommandPalette,
    ]
  );

  return (
    <KeybindContext.Provider value={value}>{children}</KeybindContext.Provider>
  );
}

export function useCommands(initial?: CommandItem[] | (() => CommandItem[])) {
  const {
    registerCommand,
    setCommandPaletteOpen,
    toggleCommandPalette,
    isCommandPaletteOpen,
    commands,
  } = useKeybindContext();
  const unregistersRef = useRef<Array<() => void>>([]);

  const register = useCallback(
    (command: CommandItem | CommandItem[]) => {
      const items = Array.isArray(command) ? command : [command];
      for (const item of items) {
        const off = registerCommand(item);
        unregistersRef.current.push(off);
      }
    },
    [registerCommand]
  );

  const clear = useCallback(() => {
    for (const off of unregistersRef.current) off();
    unregistersRef.current = [];
  }, []);

  const resolvedItems = initial
    ? typeof initial === "function"
      ? initial()
      : initial
    : [];

  const commandsKey = resolvedItems
    .map((c) => `${c.id}:${c.label}`)
    .join("|");

  useEffect(() => {
    if (resolvedItems.length === 0) return;
    register(resolvedItems);
    return () => clear();
  }, [commandsKey, register, clear]);

  useEffect(() => clear, [clear]);

  const closePalette = useCallback(
    () => setCommandPaletteOpen(false),
    [setCommandPaletteOpen]
  );
  const openPalette = useCallback(
    () => setCommandPaletteOpen(true),
    [setCommandPaletteOpen]
  );

  const runCommand = useCallback(
    async (cmd: CommandItem, opts?: { closeAfter?: boolean }) => {
      await cmd.run({
        open: openPalette,
        close: closePalette,
        toggle: toggleCommandPalette,
      });
      if (opts?.closeAfter) closePalette();
    },
    [openPalette, closePalette, toggleCommandPalette]
  );

  return {
    register,
    clear,
    isCommandPaletteOpen,
    openPalette,
    closePalette,
    togglePalette: toggleCommandPalette,
    commands,
    runCommand,
  } as const;
}

export function formatShortcutForDisplay(shortcut: ShortcutString): string {
  const s = normalizeShortcut(shortcut);
  const isMac = isMacPlatform();

  const partsMac: string[] = [];
  const partsWin: string[] = [];

  if (isMac) {
    if (s.metaKey) partsMac.push("\u2318");
    if (s.shiftKey) partsMac.push("\u21E7");
    if (s.altKey) partsMac.push("\u2325");
    if (s.ctrlKey) partsMac.push("\u2303");
  } else {
    if (s.ctrlKey) partsWin.push("Ctrl");
    if (s.shiftKey) partsWin.push("Shift");
    if (s.altKey) partsWin.push("Alt");
    if (s.metaKey) partsWin.push("Meta");
  }

  const keyLabelRaw = s.key;
  let keyLabel = keyLabelRaw;
  if (keyLabel.length === 1) keyLabel = keyLabel.toUpperCase();
  if (keyLabelRaw.toLowerCase() === "escape") keyLabel = "Esc";
  if (keyLabelRaw.toLowerCase().startsWith("arrow")) {
    keyLabel = keyLabelRaw.replace("Arrow", "");
  }

  if (isMac) {
    return [...partsMac, keyLabel].filter(Boolean).join("");
  }
  return [...partsWin, keyLabel].filter(Boolean).join(" + ");
}

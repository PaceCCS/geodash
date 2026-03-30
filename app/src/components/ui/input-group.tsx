"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        "group/input-group flex h-9 w-full items-center rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-aria-invalid:border-destructive has-aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupAddon({
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  align?: "start" | "end" | "inline-start" | "inline-end";
}) {
  return (
    <div
      data-slot="input-group-addon"
      data-align={align}
      className={cn(
        "flex shrink-0 items-center",
        (align === "start" || align === "inline-start") && "order-first",
        (align === "end" || align === "inline-end") && "order-last",
        className,
      )}
      {...props}
    />
  );
}

const InputGroupInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<typeof Input>
>(({ className, ...props }, ref) => (
  <Input
    ref={ref}
    className={cn(
      "h-full flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0",
      className,
    )}
    {...props}
  />
));
InputGroupInput.displayName = "InputGroupInput";

const InputGroupButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(({ className, ...props }, ref) => (
  <Button
    ref={ref}
    className={cn(
      "h-full rounded-none border-0 shadow-none first:rounded-l-md last:rounded-r-md",
      className,
    )}
    {...props}
  />
));
InputGroupButton.displayName = "InputGroupButton";

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="input-group-text"
      className={cn(
        "flex h-full items-center border-l border-border/70 bg-muted/40 px-3 text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupButton,
  InputGroupText,
};

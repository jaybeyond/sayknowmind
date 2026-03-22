"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Check, Loader2, Circle } from "lucide-react";

export type AgentStep = {
  title: string;
  description: string;
  status: "pending" | "running" | "done";
};

interface AgentStepsProps {
  steps: AgentStep[];
  defaultOpen?: boolean;
}

export function AgentSteps({ steps, defaultOpen = false }: AgentStepsProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  if (steps.length === 0) return null;

  const doneCount = steps.filter((s) => s.status === "done").length;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            !open && "-rotate-90"
          )}
        />
        <span>
          {doneCount}/{steps.length} steps completed
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 pl-1">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <div className="mt-0.5">
                {step.status === "done" && (
                  <Check className="size-3.5 text-green-500" />
                )}
                {step.status === "running" && (
                  <Loader2 className="size-3.5 text-blue-500 animate-spin" />
                )}
                {step.status === "pending" && (
                  <Circle className="size-3.5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <p
                  className={cn(
                    "font-medium text-xs",
                    step.status === "done" && "text-muted-foreground"
                  )}
                >
                  {step.title}
                </p>
                {step.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {step.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

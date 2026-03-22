"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Bot, Sparkles } from "lucide-react";
import { toast } from "sonner";

const chatModes = [
  { id: "simple", label: "Simple", description: "Direct answers", icon: Bot },
  { id: "agentic", label: "Agentic", description: "Multi-step reasoning", icon: Sparkles },
] as const;

export function AITab() {
  const [chatMode, setChatMode] = useState("simple");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [showOpenai, setShowOpenai] = useState(false);
  const [showAnthropic, setShowAnthropic] = useState(false);

  useEffect(() => {
    setChatMode(localStorage.getItem("sayknowmind-chat-mode") ?? "simple");
    setOpenaiKey(localStorage.getItem("sayknowmind-openai-key") ?? "");
    setAnthropicKey(localStorage.getItem("sayknowmind-anthropic-key") ?? "");
  }, []);

  const handleModeChange = (id: string) => {
    localStorage.setItem("sayknowmind-chat-mode", id);
    setChatMode(id);
    toast.success(`Chat mode set to ${id}`);
  };

  const handleSaveKeys = () => {
    localStorage.setItem("sayknowmind-openai-key", openaiKey);
    localStorage.setItem("sayknowmind-anthropic-key", anthropicKey);
    toast.success("API keys saved");
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Default chat mode</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose how the AI assistant responds by default
          </p>
        </div>
        <div className="flex gap-3">
          {chatModes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => handleModeChange(mode.id)}
              className={cn(
                "flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors",
                chatMode === mode.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              )}
            >
              <mode.icon className="size-5" />
              <span className="text-sm font-medium">{mode.label}</span>
              <span className="text-xs text-muted-foreground">
                {mode.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">API keys</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            API keys are stored locally and never sent to our servers
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="openai-key">
            OpenAI API Key
          </label>
          <div className="relative">
            <Input
              id="openai-key"
              type={showOpenai ? "text" : "password"}
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-..."
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowOpenai(!showOpenai)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showOpenai ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="anthropic-key">
            Anthropic API Key
          </label>
          <div className="relative">
            <Input
              id="anthropic-key"
              type={showAnthropic ? "text" : "password"}
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowAnthropic(!showAnthropic)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showAnthropic ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
        </div>

        <Button onClick={handleSaveKeys}>Save API keys</Button>
      </div>
    </div>
  );
}

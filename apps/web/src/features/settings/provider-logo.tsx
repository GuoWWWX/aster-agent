import anthropic from "@iconify-icons/simple-icons/anthropic";
import baidu from "@iconify-icons/simple-icons/baidu";
import cloudflare from "@iconify-icons/simple-icons/cloudflare";
import deepseek from "@iconify-icons/simple-icons/deepseek";
import google from "@iconify-icons/simple-icons/google";
import huggingface from "@iconify-icons/simple-icons/huggingface";
import kimi from "@iconify-icons/simple-icons/kimi";
import meta from "@iconify-icons/simple-icons/meta";
import minimax from "@iconify-icons/simple-icons/minimax";
import mistral from "@iconify-icons/simple-icons/mistralai";
import modelscope from "@iconify-icons/simple-icons/modelscope";
import nvidia from "@iconify-icons/simple-icons/nvidia";
import ollama from "@iconify-icons/simple-icons/ollama";
import openai from "@iconify-icons/simple-icons/openai";
import openrouter from "@iconify-icons/simple-icons/openrouter";
import qwen from "@iconify-icons/simple-icons/qwen";
import replicate from "@iconify-icons/simple-icons/replicate";
import x from "@iconify-icons/simple-icons/x";
import { Icon, type IconifyIcon } from "@iconify/react";
import { Check, ChevronDown } from "lucide-react";
import { useState, type ReactElement } from "react";

import type { ModelProviderIcon } from "@agent/protocol";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";

import "./provider-logo.css";

export type ProviderIconOption = {
  brandIcon?: IconifyIcon;
  label: string;
  mark: string;
  value: ModelProviderIcon;
};

export const PROVIDER_ICON_OPTIONS: readonly ProviderIconOption[] = [
  { label: "自动首字母", mark: "Aa", value: "auto" },
  { brandIcon: openai, label: "OpenAI", mark: "AI", value: "openai" },
  { brandIcon: anthropic, label: "Anthropic", mark: "A", value: "anthropic" },
  { brandIcon: google, label: "Google Gemini", mark: "G", value: "google" },
  { brandIcon: x, label: "xAI", mark: "x", value: "xai" },
  { brandIcon: deepseek, label: "DeepSeek", mark: "DS", value: "deepseek" },
  { brandIcon: qwen, label: "通义千问", mark: "Q", value: "qwen" },
  { brandIcon: kimi, label: "Moonshot / Kimi", mark: "K", value: "moonshot" },
  { label: "智谱", mark: "智", value: "zhipu" },
  { brandIcon: minimax, label: "MiniMax", mark: "MM", value: "minimax" },
  { brandIcon: baidu, label: "百度千帆", mark: "百", value: "baidu" },
  { brandIcon: mistral, label: "Mistral AI", mark: "M", value: "mistral" },
  { brandIcon: meta, label: "Meta Llama", mark: "M", value: "meta" },
  { brandIcon: huggingface, label: "Hugging Face", mark: "HF", value: "huggingface" },
  { brandIcon: ollama, label: "Ollama", mark: "O", value: "ollama" },
  { brandIcon: modelscope, label: "魔搭 ModelScope", mark: "模", value: "modelscope" },
  { label: "硅基流动", mark: "SF", value: "siliconflow" },
  { brandIcon: openrouter, label: "OpenRouter", mark: "OR", value: "openrouter" },
  { brandIcon: cloudflare, label: "Cloudflare AI", mark: "CF", value: "cloudflare" },
  { brandIcon: nvidia, label: "NVIDIA NIM", mark: "NV", value: "nvidia" },
  { brandIcon: replicate, label: "Replicate", mark: "R", value: "replicate" },
  { label: "AiHubMix", mark: "AH", value: "aihubmix" },
  { label: "New API", mark: "NA", value: "new-api" },
  { label: "One API", mark: "OA", value: "one-api" },
];

function optionFor(icon: ModelProviderIcon | undefined): ProviderIconOption {
  return PROVIDER_ICON_OPTIONS.find((option) => option.value === (icon ?? "auto"))
    ?? PROVIDER_ICON_OPTIONS[0]!;
}

export function providerIconLabel(icon: ModelProviderIcon | undefined): string {
  return optionFor(icon).label;
}

export function providerInitials(providerName: string): string {
  const normalized = providerName.trim();
  if (normalized.length === 0) return "?";

  const ideographs = [...normalized].filter((character) => /[\u3400-\u9fff]/u.test(character));
  if (ideographs.length > 0) return ideographs.slice(0, 2).join("");

  const words = normalized
    .replace(/[^a-zA-Z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();

  const compact = normalized.replace(/[^a-zA-Z0-9]+/gu, "");
  return (compact || normalized).slice(0, 2).toUpperCase();
}

export function ProviderLogo({
  className,
  icon,
  providerName,
  size = "medium",
}: {
  className?: string | undefined;
  icon?: ModelProviderIcon | undefined;
  providerName: string;
  size?: "compact" | "small" | "medium" | undefined;
}): ReactElement {
  const selectedIcon = icon ?? "auto";
  const option = optionFor(selectedIcon);
  const mark = selectedIcon === "auto" ? providerInitials(providerName) : option.mark;
  return (
    <span
      aria-hidden="true"
      className={[
        "provider-logo",
        `provider-logo--${selectedIcon}`,
        `provider-logo--${size}`,
        className,
      ].filter(Boolean).join(" ")}
    >
      {option.brandIcon === undefined ? mark : <Icon icon={option.brandIcon} />}
    </span>
  );
}

export function ProviderIconPicker({
  icon,
  providerName,
  onIconChange,
}: {
  icon: ModelProviderIcon;
  providerName: string;
  onIconChange: (icon: ModelProviderIcon) => void;
}): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = optionFor(icon);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={`供应商图标：${selectedOption.label}`}
          className="provider-icon-picker__trigger"
          type="button"
        >
          <ProviderLogo icon={icon} providerName={providerName} size="small" />
          <span>{selectedOption.label}</span>
          <ChevronDown aria-hidden="true" size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="provider-icon-picker__content"
        collisionPadding={8}
        side="bottom"
        sideOffset={5}
      >
        <div aria-label="选择供应商图标" className="provider-icon-picker__options" role="listbox">
          {PROVIDER_ICON_OPTIONS.map((option) => {
            const isSelected = option.value === icon;
            return (
              <button
                key={option.value}
                aria-selected={isSelected}
                className="provider-icon-picker__option"
                data-selected={isSelected}
                role="option"
                title={option.label}
                type="button"
                onClick={() => {
                  onIconChange(option.value);
                  setIsOpen(false);
                }}
              >
                <ProviderLogo icon={option.value} providerName={providerName} size="small" />
                <span>{option.label}</span>
                <Check aria-hidden="true" size={14} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

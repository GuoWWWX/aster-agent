import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Search,
} from "lucide-react";
import { useRef, useState, type ChangeEvent, type ReactElement } from "react";

import { IconButton } from "../../components/ui/icon-button.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import type {
  AgentAvatar as AgentAvatarValue,
  AgentAvatarIcon,
  AgentAvatarPreset,
  AgentStatus,
} from "../../stores/agent-directory-store.js";
import { AgentAvatar, AGENT_AVATAR_ICON_OPTIONS } from "../team/agent-avatar.js";
import { AGENT_AVATAR_PRESET_OPTIONS } from "../team/agent-character-avatar.js";

export const AGENT_AVATAR_PICKER_PAGE_SIZE = 24;

type AgentAvatarIconOption = (typeof AGENT_AVATAR_ICON_OPTIONS)[number];

export function filterAgentAvatarIconOptions(query: string): AgentAvatarIconOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return [...AGENT_AVATAR_ICON_OPTIONS];
  return AGENT_AVATAR_ICON_OPTIONS.filter((option) =>
    `${option.label} ${option.id}`.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function paginateAgentAvatarOptions<T>(
  options: readonly T[],
  requestedPage: number,
  pageSize = AGENT_AVATAR_PICKER_PAGE_SIZE,
): {
  items: T[];
  page: number;
  totalPages: number;
} {
  const totalPages = Math.max(1, Math.ceil(options.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  return { items: options.slice(start, start + pageSize), page, totalPages };
}

export function AgentAvatarPicker({
  avatar,
  onIconChange,
  onPresetChange,
  onFileChange,
  status,
  uploadError,
}: {
  avatar: AgentAvatarValue;
  onIconChange: (icon: AgentAvatarIcon) => void;
  onPresetChange: (preset: AgentAvatarPreset) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  status?: AgentStatus;
  uploadError: string | null;
}): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState<"presets" | "icons">("presets");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions: { id: string; label: string; avatar: Exclude<AgentAvatarValue, { kind: "image" }> }[] = collection === "presets"
    ? AGENT_AVATAR_PRESET_OPTIONS.filter(option => `${option.label} ${option.id}`.toLocaleLowerCase().includes(normalizedQuery))
      .map(option => ({ ...option, avatar: { kind: "preset", preset: option.id } }))
    : filterAgentAvatarIconOptions(query).map(option => ({ ...option, avatar: { kind: "icon", icon: option.id } }));
  const pageData = paginateAgentAvatarOptions(filteredOptions, page);
  const selectedLabel = avatar.kind === "image"
    ? avatar.fileName
    : avatar.kind === "preset" ? AGENT_AVATAR_PRESET_OPTIONS.find(option => option.id === avatar.preset)!.label
    : AGENT_AVATAR_ICON_OPTIONS.find((option) => option.id === avatar.icon)?.label ?? "预设图标";

  function updateOpen(nextOpen: boolean): void {
    setIsOpen(nextOpen);
    if (!nextOpen) {
      setPage(1);
      setQuery("");
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={updateOpen}>
      <PopoverTrigger asChild>
        <button
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={`Agent 头像：${selectedLabel}，点击选择`}
          className="flex min-h-14 min-w-0 items-center gap-2 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-2.5 text-left text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] outline-none transition-colors hover:border-[#93c5fd] hover:bg-[var(--app-hover)] focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]"
          type="button"
        >
          <AgentAvatar
            avatar={avatar}
            size="large"
            {...(status === undefined ? {} : { status })}
          />
          <span className="min-w-0 flex-1">
            <strong className="block truncate font-semibold">{selectedLabel}</strong>
            <small className="block truncate text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
              内置角色、图标或上传图片
            </small>
          </span>
          <ChevronDown aria-hidden="true" className="shrink-0 text-[var(--app-muted-foreground)]" size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="选择 Agent 头像"
        className="w-[340px] overflow-hidden rounded-[var(--app-radius-large)] border border-[var(--app-border)] bg-[var(--app-panel)] p-0 text-[var(--app-foreground)] shadow-xl"
        collisionPadding={8}
        side="bottom"
        sideOffset={5}
      >
        <div className="border-b border-[var(--app-border)] p-2">
          <div className="flex w-full min-w-0 items-center">
            <label className="app-search-field flex h-8 min-w-0 flex-1 items-center gap-1.5">
              <Search aria-hidden="true" className="shrink-0 text-[var(--app-muted-foreground)]" size={14} />
              <input
                aria-label="搜索 Agent 头像"
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-[length:var(--app-font-size-control)] outline-none placeholder:text-[var(--app-muted-foreground)]"
                placeholder="搜索名称或 ID"
                value={query}
                onChange={(event) => {
                  setPage(1);
                  setQuery(event.target.value);
                }}
              />
            </label>
            <input
              ref={fileInputRef}
              accept="image/svg+xml,image/png,image/jpeg,image/webp,.svg,.png,.jpg,.jpeg,.webp"
              className="sr-only"
              type="file"
              onChange={onFileChange}
            />
            <div className="ml-[5px] flex shrink-0 items-center gap-[5px]">
              <span aria-hidden="true" className="h-5 w-px bg-[var(--app-border)]" />
              <IconButton
                label="选择 SVG 或图片"
                size="compact"
                variant="quiet"
                onClick={() => fileInputRef.current?.click()}
              >
                <FolderOpen aria-hidden="true" size={15} />
              </IconButton>
            </div>
          </div>
          {uploadError === null ? null : (
            <p className="m-0 mt-[5px] text-[length:var(--app-font-size-auxiliary)] text-[var(--app-destructive)]" role="alert">
              {uploadError}
            </p>
          )}
        </div>

        <div role="group" aria-label="头像类型" className="mx-2 mt-2 flex gap-[5px]">
          {(["presets", "icons"] as const).map(value => <button key={value} type="button"
            aria-label={value === "presets" ? "角色头像" : "图标"} aria-pressed={collection === value} data-selected={collection === value}
            className="flex-1 rounded-[var(--app-radius)] px-2 py-1.5 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)] data-[selected=true]:bg-[var(--app-selection)] data-[selected=true]:text-[var(--app-selection-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]"
            onClick={() => { setCollection(value); setPage(1); setQuery(""); }}>
            {value === "presets" ? "角色头像" : "图标"}
          </button>)}
        </div>

        <div className="flex min-h-8 items-center justify-between px-2.5 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
          <span>{filteredOptions.length} 个{collection === "presets" ? "角色头像" : "图标"}</span>
          <span>第 {pageData.page} / {pageData.totalPages} 页</span>
        </div>

        {pageData.items.length === 0 ? (
          <p className="m-0 grid min-h-40 place-items-center px-4 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">
            没有匹配的头像
          </p>
        ) : (
          <div
            aria-label={collection === "presets" ? "Agent 角色头像列表" : "Agent 图标列表"}
            className="grid grid-cols-4 gap-[5px] px-2 pb-2"
            role="listbox"
          >
            {pageData.items.map((option) => {
              const selected = avatar.kind === option.avatar.kind && (avatar.kind === "icon" ? avatar.icon === option.id : avatar.kind === "preset" && avatar.preset === option.id);
              return (
                <button
                  key={option.id}
                  aria-label={option.label}
                  aria-selected={selected}
                  className={`group relative flex ${collection === "presets" ? "h-20" : "h-14"} min-w-0 flex-col items-center justify-center gap-1 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-1 text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)] outline-none transition-colors hover:border-[#93c5fd] hover:bg-[var(--app-hover)] focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)] data-[selected=true]:border-[var(--app-selection-border)] data-[selected=true]:bg-[var(--app-selection)] data-[selected=true]:text-[var(--app-selection-foreground)]`}
                  data-selected={selected}
                  role="option"
                  title={`${option.label} (${option.id})`}
                  type="button"
                  onClick={() => {
                    if (option.avatar.kind === "icon") onIconChange(option.avatar.icon);
                    else onPresetChange(option.avatar.preset);
                    updateOpen(false);
                  }}
                >
                  <AgentAvatar avatar={option.avatar} size={collection === "presets" ? "large" : "compact"} />
                  <span className="w-full truncate">{option.label}</span>
                  {selected ? (
                    <Check aria-hidden="true" className="absolute right-1 top-1" size={11} />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        <footer className="flex h-10 items-center justify-between border-t border-[var(--app-border)] px-2">
          <span className="text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
            每页 {AGENT_AVATAR_PICKER_PAGE_SIZE} 个
          </span>
          <div className="flex items-center gap-[5px]">
            <IconButton
              disabled={pageData.page <= 1}
              label="上一页图标"
              size="compact"
              variant="quiet"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft aria-hidden="true" size={14} />
            </IconButton>
            <IconButton
              disabled={pageData.page >= pageData.totalPages}
              label="下一页图标"
              size="compact"
              variant="quiet"
              onClick={() => setPage((current) => Math.min(pageData.totalPages, current + 1))}
            >
              <ChevronRight aria-hidden="true" size={14} />
            </IconButton>
          </div>
        </footer>
      </PopoverContent>
    </Popover>
  );
}

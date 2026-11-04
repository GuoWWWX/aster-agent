import { Check, ChevronDown } from "lucide-react";
import { useMemo, useRef, useState, type ReactElement } from "react";
import { type DiscoveredModel } from "@agent/protocol";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "../../../components/ui/popover.js";

export function ModelIdPicker({
  discoveredModels,
  modelId,
  onValueChange,
}: {
  discoveredModels: readonly DiscoveredModel[];
  modelId: string;
  onValueChange: (value: string) => void;
}): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredModels = useMemo(() => discoveredModels.filter((model) =>
    normalizedSearchQuery.length === 0 || [model.modelId, model.ownedBy ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearchQuery))
  ), [discoveredModels, normalizedSearchQuery]);

  function updateOpen(nextOpen: boolean, nextSearchQuery = ""): void {
    if (nextOpen) {
      setContentWidth(pickerRef.current?.getBoundingClientRect().width ?? null);
      setSearchQuery(nextSearchQuery);
    }
    setIsOpen(nextOpen);
  }

  return (
    <Popover open={isOpen} onOpenChange={updateOpen}>
      <PopoverAnchor asChild>
        <div ref={pickerRef} className="settings-model-id-picker">
          <input
            aria-autocomplete={discoveredModels.length > 0 ? "list" : undefined}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-label="模型 ID"
            autoComplete="off"
            placeholder="模型 ID"
            role="combobox"
            title={discoveredModels.length > 0 ? "输入或从当前供应商已获取的模型中选择" : "模型 ID"}
            value={modelId}
            onChange={(event) => {
              const value = event.target.value;
              onValueChange(value);
              if (discoveredModels.length > 0) updateOpen(true, value);
            }}
            onFocus={() => {
              if (discoveredModels.length > 0) updateOpen(true);
            }}
          />
          <PopoverTrigger asChild>
            <button
              aria-label="选择当前供应商的模型"
              className="settings-model-id-picker__toggle"
              disabled={discoveredModels.length === 0}
              title={discoveredModels.length === 0 ? "请先获取当前供应商的模型" : "选择当前供应商的模型"}
              type="button"
            >
              <ChevronDown aria-hidden="true" size={15} />
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="settings-model-id-picker__content"
        onPointerDownOutside={(event) => {
          if (event.target instanceof Node && pickerRef.current?.contains(event.target)) {
            event.preventDefault();
          }
        }}
        side="bottom"
        style={contentWidth === null ? undefined : { width: `${contentWidth}px` }}
      >
        <div className="settings-model-id-picker__summary">
          当前供应商已获取 {discoveredModels.length} 个模型
        </div>
        <div className="settings-model-id-picker__options" role="listbox" aria-label="当前供应商的模型">
          {filteredModels.map((model) => (
            <button
              key={model.modelId}
              aria-selected={model.modelId === modelId}
              data-selected={model.modelId === modelId}
              role="option"
              type="button"
              onClick={() => {
                onValueChange(model.modelId);
                updateOpen(false);
              }}
            >
              <span>
                <strong>{model.modelId}</strong>
                {model.ownedBy !== null ? <small>{model.ownedBy}</small> : null}
              </span>
              {model.modelId === modelId ? <Check aria-hidden="true" size={15} /> : null}
            </button>
          ))}
          {filteredModels.length === 0 ? (
            <p>没有匹配的模型</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

import { Check, CirclePlus, Pencil, RotateCcw, Trash2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

import {
  isGemini3ReasoningModel,
  isReasoningOptionEnabled,
  isReasoningOptionSupportedByApiFormat,
  modelReasoningEffortSchema,
  modelReasoningOptionKey,
  modelReasoningOptionSchema,
  type ModelApiFormat,
  type ModelReasoningOption,
} from "@agent/protocol";

import {
  defaultReasoningOptions,
  reasoningOptionApiValue,
  reasoningOptionDisplayName,
  reasoningOptionLabel,
} from "./model-reasoning-options.js";

type ModelReasoningOptionsEditorProps = {
  apiFormat: ModelApiFormat;
  modelId: string;
  modelName: string;
  options: readonly ModelReasoningOption[];
  onChange: (options: ModelReasoningOption[]) => void;
};

type ReasoningOptionDraft = {
  apiValue: string;
  displayName: string;
};

type PendingReasoningOption = {
  id: string;
  draft: ReasoningOptionDraft;
  enabled: boolean;
};

type ReasoningOptionDragPreview = {
  height: number;
  isCompact: boolean;
  left: number;
  option: ModelReasoningOption;
  top: number;
  width: number;
};

type ReasoningOptionDropIndicator = {
  left: number;
  top: number;
  width: number;
};

const reasoningOptionDragStartDistance = 8;
const reasoningOptionLongPressDelay = 260;

function getReasoningOptionDragButtonMask(button: number): number | null {
  if (button === 0) return 1;
  if (button === 2) return 2;
  return null;
}

function optionFromDraft(
  apiFormat: ModelApiFormat,
  modelId: string,
  draft: ReasoningOptionDraft,
  enabled: boolean,
): ModelReasoningOption | string {
  const apiValue = draft.apiValue.trim();
  const displayName = draft.displayName.trim();
  if (apiValue.length === 0 || displayName.length === 0) {
    return "请填写接口参数和显示名称。";
  }

  const option = (() => {
    if (
      apiFormat === "anthropic-messages"
      || (apiFormat === "google-gemini" && !isGemini3ReasoningModel(modelId))
    ) {
      if (!/^-?\d+$/.test(apiValue)) return null;
      return {
        displayName,
        enabled,
        kind: "token_budget" as const,
        value: Number(apiValue),
      };
    }

    const effort = modelReasoningEffortSchema.safeParse(apiValue);
    return effort.success
      ? {
        displayName,
        enabled,
        kind: "effort" as const,
        value: effort.data,
      }
      : {
        displayName,
        enabled,
        kind: "custom_effort" as const,
        value: apiValue,
      };
  })();

  if (option === null) return "当前 API 格式的推理强度参数必须是整数。";
  const parsed = modelReasoningOptionSchema.safeParse(option);
  if (!parsed.success) return "推理强度参数或显示名称不符合格式要求。";
  if (!isReasoningOptionSupportedByApiFormat(apiFormat, parsed.data, modelId)) {
    return "该推理强度不适用于当前 API 格式。";
  }
  return parsed.data;
}

export function ModelReasoningOptionsEditor({
  apiFormat,
  modelId,
  modelName,
  onChange,
  options,
}: ModelReasoningOptionsEditorProps): ReactElement {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<ReasoningOptionDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingOptions, setPendingOptions] = useState<PendingReasoningOption[]>([]);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<ReasoningOptionDragPreview | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dropIndicator, setDropIndicator] = useState<ReasoningOptionDropIndicator | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragLongPressTimerRef = useRef<number | null>(null);
  const dragButtonMaskRef = useRef(0);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const dragPointerOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const pendingDragKeyRef = useRef<string | null>(null);
  const draggingKeyRef = useRef<string | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const nextPendingOptionIdRef = useRef(0);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => () => {
    if (dragLongPressTimerRef.current !== null) {
      window.clearTimeout(dragLongPressTimerRef.current);
    }
  }, []);

  function applyOptions(nextOptions: ModelReasoningOption[]): void {
    optionsRef.current = nextOptions;
    onChange(nextOptions);
  }

  function clearLongPressTimer(): void {
    if (dragLongPressTimerRef.current === null) return;
    window.clearTimeout(dragLongPressTimerRef.current);
    dragLongPressTimerRef.current = null;
  }

  function setDropTarget(nextDropIndex: number | null): void {
    dropIndexRef.current = nextDropIndex;
    setDropIndex(nextDropIndex);
    setDropIndicator(nextDropIndex === null ? null : getDropIndicator(nextDropIndex));
  }

  function clearDragState(): void {
    clearLongPressTimer();
    dragButtonMaskRef.current = 0;
    dragPointerIdRef.current = null;
    dragStartPointRef.current = null;
    dragPointerOffsetRef.current = null;
    pendingDragKeyRef.current = null;
    draggingKeyRef.current = null;
    dropIndexRef.current = null;
    setDraggingKey(null);
    setDragPreview(null);
    setDropIndex(null);
    setDropIndicator(null);
  }

  function getDropIndicator(targetDropIndex: number): ReasoningOptionDropIndicator | null {
    const list = listRef.current;
    if (list === null) return null;

    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-reasoning-option-key]'));
    const current = optionsRef.current;
    const targetOption = current[targetDropIndex];
    const targetRow = targetOption === undefined
      ? rows.at(-1)
      : rows.find((row) => row.dataset.reasoningOptionKey === modelReasoningOptionKey(targetOption));
    if (targetRow === undefined) return null;

    const rect = targetRow.getBoundingClientRect();
    return {
      left: rect.left + 3,
      top: targetOption === undefined ? rect.bottom + 2 : rect.top - 3,
      width: rect.width - 6,
    };
  }

  function moveOptionToDropIndex(
    current: readonly ModelReasoningOption[],
    sourceKey: string,
    targetDropIndex: number,
  ): ModelReasoningOption[] {
    const sourceIndex = current.findIndex((option) => modelReasoningOptionKey(option) === sourceKey);
    if (sourceIndex < 0 || targetDropIndex === sourceIndex || targetDropIndex === sourceIndex + 1) {
      return [...current];
    }

    const next = [...current];
    const [source] = next.splice(sourceIndex, 1);
    if (source === undefined) return [...current];
    const insertionIndex = sourceIndex < targetDropIndex ? targetDropIndex - 1 : targetDropIndex;
    next.splice(insertionIndex, 0, source);
    return next;
  }

  function commitDrag(): void {
    const sourceKey = draggingKeyRef.current;
    const targetDropIndex = dropIndexRef.current;
    if (sourceKey !== null && targetDropIndex !== null) {
      applyOptions(moveOptionToDropIndex(optionsRef.current, sourceKey, targetDropIndex));
    }
    clearDragState();
  }

  function releasePointerCapture(event: PointerEvent<HTMLElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function cancelDrag(event?: PointerEvent<HTMLElement>): void {
    if (event !== undefined) releasePointerCapture(event);
    clearDragState();
  }

  function cancelEditing(): void {
    setEditingKey(null);
    setEditingDraft(null);
  }

  function startEditing(option: ModelReasoningOption): void {
    const key = modelReasoningOptionKey(option);
    setEditingKey(key);
    setEditingDraft({
      apiValue: reasoningOptionApiValue(option),
      displayName: reasoningOptionDisplayName(option),
    });
    setError(null);
  }

  function finishEditing(): void {
    if (editingKey === null || editingDraft === null) return;
    const current = optionsRef.current.find((option) => modelReasoningOptionKey(option) === editingKey);
    if (current === undefined) {
      cancelEditing();
      return;
    }

    const updated = optionFromDraft(apiFormat, modelId, editingDraft, isReasoningOptionEnabled(current));
    if (typeof updated === "string") {
      setError(updated);
      return;
    }

    const nextKey = modelReasoningOptionKey(updated);
    if (optionsRef.current.some((option) => (
      modelReasoningOptionKey(option) !== editingKey && modelReasoningOptionKey(option) === nextKey
    ))) {
      setError("该接口参数已在此模型中配置。");
      return;
    }

    applyOptions(optionsRef.current.map((option) => (
      modelReasoningOptionKey(option) === editingKey ? updated : option
    )));
    cancelEditing();
    setError(null);
  }

  function updatePendingOption(
    pendingId: string,
    update: (pending: PendingReasoningOption) => PendingReasoningOption,
  ): void {
    setPendingOptions((current) => current.map((pending) => (
      pending.id === pendingId ? update(pending) : pending
    )));
  }

  function discardPendingOption(pendingId: string): void {
    setPendingOptions((current) => current.filter((pending) => pending.id !== pendingId));
    setError(null);
  }

  function finishPendingOption(pendingId: string): void {
    const pending = pendingOptions.find((candidate) => candidate.id === pendingId);
    if (pending === undefined) return;

    const option = optionFromDraft(apiFormat, modelId, pending.draft, pending.enabled);
    if (typeof option === "string") {
      setError(option);
      return;
    }

    const key = modelReasoningOptionKey(option);
    if (optionsRef.current.some((candidate) => modelReasoningOptionKey(candidate) === key)) {
      setError("该接口参数已在此模型中配置。");
      return;
    }

    applyOptions([...optionsRef.current, option]);
    setPendingOptions((current) => current.filter((candidate) => candidate.id !== pendingId));
    setError(null);
  }

  function toggleEnabled(option: ModelReasoningOption): void {
    const key = modelReasoningOptionKey(option);
    applyOptions(optionsRef.current.map((candidate) => (
      modelReasoningOptionKey(candidate) === key
        ? { ...candidate, enabled: !isReasoningOptionEnabled(candidate) }
        : candidate
    )));
  }

  function removeOption(option: ModelReasoningOption): void {
    const key = modelReasoningOptionKey(option);
    applyOptions(optionsRef.current.filter((candidate) => modelReasoningOptionKey(candidate) !== key));
    if (editingKey === key) {
      cancelEditing();
    }
    setError(null);
  }

  function addOption(): void {
    if (optionsRef.current.length + pendingOptions.length >= 16) {
      setError("每个模型最多配置 16 个推理强度。");
      return;
    }
    const id = `pending-${nextPendingOptionIdRef.current}`;
    nextPendingOptionIdRef.current += 1;
    setPendingOptions((current) => [...current, {
      id,
      draft: { apiValue: "", displayName: "" },
      enabled: true,
    }]);
    setError(null);
  }

  function resetOptions(): void {
    applyOptions(defaultReasoningOptions(apiFormat, modelId));
    cancelEditing();
    setPendingOptions([]);
    setError(null);
  }

  function handleEditingKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      finishEditing();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  }

  function handlePendingOptionKeyDown(event: KeyboardEvent<HTMLInputElement>, pendingId: string): void {
    if (event.key === "Enter") {
      event.preventDefault();
      finishPendingOption(pendingId);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      discardPendingOption(pendingId);
    }
  }

  function activateDrag(
    sourceElement: HTMLElement,
    pointerId: number,
    optionKey: string,
    clientX: number,
    clientY: number,
  ): void {
    if (dragPointerIdRef.current !== pointerId || pendingDragKeyRef.current !== optionKey) return;
    const option = optionsRef.current.find((candidate) => modelReasoningOptionKey(candidate) === optionKey);
    if (option === undefined || !sourceElement.isConnected) {
      clearDragState();
      return;
    }

    const rect = sourceElement.getBoundingClientRect();
    dragLongPressTimerRef.current = null;
    const pointerOffset = {
      x: Math.min(Math.max(clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(clientY - rect.top, 0), rect.height),
    };
    dragPointerOffsetRef.current = pointerOffset;
    pendingDragKeyRef.current = null;
    draggingKeyRef.current = optionKey;
    setDraggingKey(optionKey);
    setDropTarget(null);
    setDragPreview({
      height: rect.height,
      isCompact: rect.height > 36,
      left: clientX - pointerOffset.x,
      option,
      top: clientY - pointerOffset.y,
      width: rect.width,
    });
  }

  function beginPotentialDrag(event: PointerEvent<HTMLElement>, optionKey: string): void {
    const target = event.target;
    const dragButtonMask = getReasoningOptionDragButtonMask(event.button);
    if (
      dragButtonMask === null
      || !event.isPrimary
      || editingKey === optionKey
      || dragPointerIdRef.current !== null
      || (target instanceof Element && target.closest("button, input, textarea, select, a, [contenteditable=\"true\"]") !== null)
    ) {
      return;
    }

    const sourceElement = event.currentTarget;
    const pointerId = event.pointerId;
    const clientX = event.clientX;
    const clientY = event.clientY;
    event.preventDefault();
    dragButtonMaskRef.current = dragButtonMask;
    dragPointerIdRef.current = pointerId;
    dragStartPointRef.current = { x: clientX, y: clientY };
    pendingDragKeyRef.current = optionKey;
    sourceElement.setPointerCapture(pointerId);
    clearLongPressTimer();
    dragLongPressTimerRef.current = window.setTimeout(() => {
      activateDrag(sourceElement, pointerId, optionKey, clientX, clientY);
    }, reasoningOptionLongPressDelay);
  }

  function resolveDropIndex(sourceKey: string, clientY: number): number | null {
    const list = listRef.current;
    if (list === null) return null;
    const current = optionsRef.current;
    const sourceIndex = current.findIndex((option) => modelReasoningOptionKey(option) === sourceKey);
    if (sourceIndex < 0) return null;

    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-reasoning-option-key]"));
    let targetDropIndex = current.length;
    for (const row of rows) {
      const targetKey = row.dataset.reasoningOptionKey;
      if (targetKey === undefined) continue;
      const targetIndex = current.findIndex((option) => modelReasoningOptionKey(option) === targetKey);
      if (targetIndex < 0) continue;
      const rect = row.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        targetDropIndex = targetIndex;
        break;
      }
      targetDropIndex = targetIndex + 1;
    }

    return targetDropIndex === sourceIndex || targetDropIndex === sourceIndex + 1
      ? null
      : targetDropIndex;
  }

  function scrollListNearPointer(clientY: number): void {
    const list = listRef.current;
    if (list === null) return;
    const rect = list.getBoundingClientRect();
    if (clientY < rect.top + 24) {
      list.scrollTop -= 12;
    } else if (clientY > rect.bottom - 24) {
      list.scrollTop += 12;
    }
  }

  function moveDrag(event: PointerEvent<HTMLElement>): void {
    const sourceKey = draggingKeyRef.current;
    if (dragPointerIdRef.current !== event.pointerId) return;

    if (sourceKey === null) {
      const startPoint = dragStartPointRef.current;
      if (
        startPoint !== null
        && Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y) > reasoningOptionDragStartDistance
      ) {
        const pendingKey = pendingDragKeyRef.current;
        if (pendingKey === null) return;
        clearLongPressTimer();
        activateDrag(event.currentTarget, event.pointerId, pendingKey, event.clientX, event.clientY);
        const activatedKey = draggingKeyRef.current;
        if (activatedKey === null) return;
        event.preventDefault();
        scrollListNearPointer(event.clientY);
        setDropTarget(resolveDropIndex(activatedKey, event.clientY));
      }
      return;
    }

    event.preventDefault();
    const dragButtonMask = dragButtonMaskRef.current;
    if (dragButtonMask === 0 || (event.buttons & dragButtonMask) !== dragButtonMask) {
      commitDrag();
      return;
    }

    const offset = dragPointerOffsetRef.current;
    if (offset !== null) {
      setDragPreview((current) => current === null ? current : {
        ...current,
        left: event.clientX - offset.x,
        top: event.clientY - offset.y,
      });
    }
    scrollListNearPointer(event.clientY);
    setDropTarget(resolveDropIndex(sourceKey, event.clientY));
  }

  function stopDrag(event: PointerEvent<HTMLElement>): void {
    if (dragPointerIdRef.current !== event.pointerId) return;
    commitDrag();
    releasePointerCapture(event);
  }

  const enabledCount = options.filter(isReasoningOptionEnabled).length
    + pendingOptions.filter((option) => option.enabled).length;
  const visibleOptionCount = options.length + pendingOptions.length;

  return (
    <section className="settings-reasoning-options" aria-label={`${modelName}的推理强度`}>
      <div className="settings-reasoning-options__heading">
        <div className="settings-reasoning-options__heading-copy">
          <strong>推理强度</strong>
          <span>{enabledCount} / {visibleOptionCount} 已启用</span>
        </div>
        <div className="settings-reasoning-options__heading-actions">
          <button
            className="settings-reasoning-options__header-action"
            type="button"
            onClick={addOption}
          >
            <CirclePlus aria-hidden="true" size={14} />
            添加
          </button>
          <button
            className="settings-reasoning-options__header-action settings-reasoning-options__header-action--reset"
            type="button"
            onClick={resetOptions}
          >
            <RotateCcw aria-hidden="true" size={13} />
            重置
          </button>
        </div>
      </div>

      <div className="settings-reasoning-options__list" ref={listRef} role="list" aria-label="推理强度列表">
        {options.map((option, optionIndex) => {
          const optionKey = modelReasoningOptionKey(option);
          const isEditing = editingKey === optionKey;
          const isEnabled = isReasoningOptionEnabled(option);
          return (
            <article
              key={optionKey}
              className="settings-reasoning-option"
              data-drop-after={dropIndex === options.length && optionIndex === options.length - 1}
              data-drop-before={dropIndex === optionIndex}
              data-dragging={draggingKey === optionKey}
              data-editing={isEditing}
              data-reasoning-option-key={optionKey}
              role="listitem"
              onLostPointerCapture={cancelDrag}
              onPointerCancel={cancelDrag}
              onPointerDown={(event) => beginPotentialDrag(event, optionKey)}
              onPointerMove={moveDrag}
              onPointerUp={stopDrag}
              onContextMenu={(event) => event.preventDefault()}
            >
              <input
                aria-label={`启用 ${reasoningOptionLabel(option)}`}
                checked={isEnabled}
                className="settings-reasoning-option__checkbox"
                type="checkbox"
                onChange={() => toggleEnabled(option)}
              />

              {isEditing && editingDraft !== null ? (
                <div className="settings-reasoning-option__field" data-editing="true">
                  <input
                    aria-label="推理强度显示名称"
                    placeholder="显示名称"
                    value={editingDraft.displayName}
                    onChange={(event) => setEditingDraft((current) => (
                      current === null ? current : { ...current, displayName: event.target.value }
                    ))}
                    onKeyDown={handleEditingKeyDown}
                  />
                  <span aria-hidden="true" className="settings-reasoning-option__separator" />
                  <input
                    aria-label="推理强度接口参数"
                    placeholder="推理强度（接口参数）"
                    value={editingDraft.apiValue}
                    onChange={(event) => setEditingDraft((current) => (
                      current === null ? current : { ...current, apiValue: event.target.value }
                    ))}
                    onKeyDown={handleEditingKeyDown}
                  />
                </div>
              ) : (
                <div className="settings-reasoning-option__field" title={reasoningOptionLabel(option)}>
                  <span>{reasoningOptionDisplayName(option)}</span>
                  <span aria-hidden="true" className="settings-reasoning-option__separator" />
                  <span>{reasoningOptionApiValue(option)}</span>
                </div>
              )}

              <button
                aria-label={isEditing ? `完成编辑 ${reasoningOptionLabel(option)}` : `编辑 ${reasoningOptionLabel(option)}`}
                className="settings-reasoning-option__action"
                title={isEditing ? "完成编辑" : "编辑"}
                type="button"
                onClick={() => isEditing ? finishEditing() : startEditing(option)}
              >
                {isEditing ? <Check aria-hidden="true" size={14} /> : <Pencil aria-hidden="true" size={14} />}
              </button>
              <button
                aria-label={`删除 ${reasoningOptionLabel(option)}`}
                className="settings-reasoning-option__action settings-reasoning-option__action--delete"
                title="删除"
                type="button"
                onClick={() => removeOption(option)}
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            </article>
          );
        })}
        {pendingOptions.map((pending) => (
          <article
            key={pending.id}
            className="settings-reasoning-option"
            data-editing="true"
            role="listitem"
          >
            <input
              aria-label="启用新增推理强度"
              checked={pending.enabled}
              className="settings-reasoning-option__checkbox"
              type="checkbox"
              onChange={() => updatePendingOption(pending.id, (current) => ({
                ...current,
                enabled: !current.enabled,
              }))}
            />
            <div className="settings-reasoning-option__field" data-editing="true">
              <input
                aria-label="新增推理强度显示名称"
                placeholder="显示名称"
                value={pending.draft.displayName}
                onChange={(event) => updatePendingOption(pending.id, (current) => ({
                  ...current,
                  draft: { ...current.draft, displayName: event.target.value },
                }))}
                onKeyDown={(event) => handlePendingOptionKeyDown(event, pending.id)}
              />
              <span aria-hidden="true" className="settings-reasoning-option__separator" />
              <input
                aria-label="新增推理强度接口参数"
                placeholder="推理强度（接口参数）"
                value={pending.draft.apiValue}
                onChange={(event) => updatePendingOption(pending.id, (current) => ({
                  ...current,
                  draft: { ...current.draft, apiValue: event.target.value },
                }))}
                onKeyDown={(event) => handlePendingOptionKeyDown(event, pending.id)}
              />
            </div>
            <button
              aria-label="完成新增推理强度"
              className="settings-reasoning-option__action"
              title="完成"
              type="button"
              onClick={() => finishPendingOption(pending.id)}
            >
              <Check aria-hidden="true" size={14} />
            </button>
            <button
              aria-label="删除新增推理强度"
              className="settings-reasoning-option__action settings-reasoning-option__action--delete"
              title="删除"
              type="button"
              onClick={() => discardPendingOption(pending.id)}
            >
              <Trash2 aria-hidden="true" size={14} />
            </button>
          </article>
        ))}
        {visibleOptionCount === 0 ? <p className="settings-reasoning-options__empty">尚未配置推理强度</p> : null}
      </div>

      {dragPreview === null ? null : createPortal(
        <>
          <div
            aria-hidden="true"
            className="settings-reasoning-option__drag-preview"
            data-compact={dragPreview.isCompact}
            style={{
              height: `${dragPreview.height}px`,
              left: `${dragPreview.left}px`,
              top: `${dragPreview.top}px`,
              width: `${dragPreview.width}px`,
            }}
          >
            <span
              className="settings-reasoning-option__drag-preview-checkbox"
              data-enabled={isReasoningOptionEnabled(dragPreview.option)}
            >
              {isReasoningOptionEnabled(dragPreview.option) ? <Check aria-hidden="true" size={12} /> : null}
            </span>
            <div className="settings-reasoning-option__field">
              <span>{reasoningOptionDisplayName(dragPreview.option)}</span>
              <span aria-hidden="true" className="settings-reasoning-option__separator" />
              <span>{reasoningOptionApiValue(dragPreview.option)}</span>
            </div>
            <span className="settings-reasoning-option__drag-preview-action"><Pencil aria-hidden="true" size={14} /></span>
            <span className="settings-reasoning-option__drag-preview-action"><Trash2 aria-hidden="true" size={14} /></span>
          </div>
          {dropIndicator === null ? null : (
            <div
              aria-hidden="true"
              className="settings-reasoning-option__drop-indicator"
              style={{
                left: `${dropIndicator.left}px`,
                top: `${dropIndicator.top}px`,
                width: `${dropIndicator.width}px`,
              }}
            />
          )}
        </>,
        document.body,
      )}

      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  );
}

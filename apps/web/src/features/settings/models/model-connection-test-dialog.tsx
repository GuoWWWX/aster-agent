import { TestTube2, X } from "lucide-react";
import { type ReactElement } from "react";
import type { ModelSettingsController } from "./use-model-settings-controller.js";

export function ModelConnectionTestDialog({ controller }: {
  controller: Pick<ModelSettingsController,
    | "configuredModelDrafts"
    | "setIsModelTestDialogOpen"
    | "modelTestSelection"
    | "setModelTestSelection"
    | "testableModels"
    | "selectedTestableModelCount"
    | "isAnyModelTesting"
    | "toggleModelTestSelection"
    | "testSelectedModels"
  >;
}): ReactElement {
  const {
    configuredModelDrafts,
    setIsModelTestDialogOpen,
    modelTestSelection,
    setModelTestSelection,
    testableModels,
    selectedTestableModelCount,
    isAnyModelTesting,
    toggleModelTestSelection,
    testSelectedModels,
  } = controller;
  return (
    <section
      aria-labelledby="settings-model-test-dialog-title"
      aria-modal="true"
      className="settings-model-test-dialog"
      role="dialog"
    >
      <header>
        <div>
          <h3 id="settings-model-test-dialog-title">测试模型</h3>
          <p>选择要测试的模型，测试会向每个模型发送一条最小请求。</p>
        </div>
        <button
          aria-label="关闭测试模型弹窗"
          className="settings-model-test-dialog__close"
          title="关闭"
          type="button"
          onClick={() => setIsModelTestDialogOpen(false)}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>
      <div className="settings-model-test-dialog__body">
        <label className="settings-model-test-dialog__select-all">
          <input
            checked={testableModels.length > 0 && selectedTestableModelCount === testableModels.length}
            type="checkbox"
            onChange={(event) => setModelTestSelection(event.target.checked
              ? testableModels.map((model) => model.id)
              : [])}
          />
          <span>全选模型</span>
          <small>{selectedTestableModelCount} / {testableModels.length}</small>
        </label>
        <div className="settings-model-test-dialog__list" role="group" aria-label="可测试模型">
          {configuredModelDrafts.map((model) => {
            const modelId = model.modelId.trim();
            const isSelectable = modelId.length > 0;
            return (
              <label className="settings-model-test-dialog__option" key={model.id}>
                <input
                  checked={isSelectable && modelTestSelection.includes(model.id)}
                  disabled={!isSelectable}
                  type="checkbox"
                  onChange={() => toggleModelTestSelection(model.id)}
                />
                <span>
                  <strong>{model.displayName || "未命名模型"}</strong>
                  <small>{modelId || "请先填写模型 ID"}</small>
                </span>
              </label>
            );
          })}
        </div>
      </div>
      <footer>
        <button
          className="settings-secondary-button"
          type="button"
          onClick={() => setIsModelTestDialogOpen(false)}
        >
          取消
        </button>
        <button
          className="settings-primary-button"
          disabled={selectedTestableModelCount === 0 || isAnyModelTesting}
          type="button"
          onClick={() => void testSelectedModels()}
        >
          <TestTube2 aria-hidden="true" size={14} />
          测试 {selectedTestableModelCount} 个模型
        </button>
      </footer>
    </section>
  );
}

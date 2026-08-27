/* eslint-disable no-restricted-imports, no-useless-assignment -- migrated node:test assertions run under Vitest. */
import assert from "node:assert/strict";
import { it } from "vitest";
import { TableCellCompositionGuard } from "./table-cell-edit.js";

it("组合输入期间 Escape 后的 blur 和 compositionend 都不会提交", () => {
  const guard = new TableCellCompositionGuard();
  const original = "原值";
  let draft = original;
  let commits = 0;

  guard.start();
  if (guard.acceptsInput) draft = "输入中";
  guard.cancel();
  draft = original;

  // Escape 会触发 blur，但 cancelling 仍被视为组合态。
  if (!guard.composing) commits++;
  // 浏览器可能在 blur 后补发 input/compositionend，迟到的内容必须忽略。
  if (guard.acceptsInput) draft = "迟到输入";
  if (guard.end() === "complete") commits++;

  assert.equal(draft, original);
  assert.equal(commits, 0);
  assert.equal(guard.composing, false);
});

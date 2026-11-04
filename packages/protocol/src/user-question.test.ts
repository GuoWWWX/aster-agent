import { expect, it } from "vitest";
import { answerUserQuestionInputSchema, userQuestionPromptSchema } from "./user-question.js";
it("supports one recommended choice and accepts legacy choices without a recommendation", () => {
  const prompt = { id: "scope", title: "范围", question: "选哪个？", options: [{ label: "完整检查", description: "覆盖所有页面", recommended: true }, { label: "重点检查", description: "只检查设置" }] };
  expect(userQuestionPromptSchema.parse(prompt).options[0]?.recommended).toBe(true);
  expect(userQuestionPromptSchema.parse({ ...prompt, options: [{ label: "旧选项" }] }).options).toHaveLength(1);
  expect(userQuestionPromptSchema.safeParse({ ...prompt, options: prompt.options.map(option => ({ ...option, recommended: true })) }).success).toBe(false);
});
it("accepts answer attachments and rejects duplicate or invalid attachment IDs", () => {
  const input = { questionId: "00000000-0000-4000-8000-000000000001", answers: { scope: "参考截图" }, attachmentIds: ["00000000-0000-4000-8000-000000000002"] };
  expect(answerUserQuestionInputSchema.parse(input).attachmentIds).toEqual(input.attachmentIds);
  expect(answerUserQuestionInputSchema.safeParse({ ...input, attachmentIds: [...input.attachmentIds, ...input.attachmentIds] }).success).toBe(false);
  expect(answerUserQuestionInputSchema.safeParse({ ...input, attachmentIds: ["bad"] }).success).toBe(false);
});

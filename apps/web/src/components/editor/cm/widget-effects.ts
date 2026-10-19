import { StateEffect } from "@codemirror/state";

export const editMermaidSourceEffect = StateEffect.define<number>();

export const editTableSourceEffect = StateEffect.define<number>();

export const selectWholeTableEffect = StateEffect.define<number | null>();

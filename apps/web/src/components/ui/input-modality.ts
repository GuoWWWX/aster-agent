const navigationKeys = new Set(["Tab", "Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

/** A native portal is a second document, but uses the same input method as its parent. */
export function trackInputModality(documents: readonly Document[]): () => void {
  const set = (modality: string): void => {
    for (const doc of documents) {
      if (doc.documentElement.dataset.inputModality !== modality) doc.documentElement.dataset.inputModality = modality;
    }
  };
  set(documents[0]?.documentElement.dataset.inputModality ?? "pointer");
  const pointer = (): void => set("pointer");
  const keyboard = (event: KeyboardEvent): void => {
    if (navigationKeys.has(event.key)) set("keyboard");
  };
  for (const doc of documents) {
    doc.addEventListener("pointerdown", pointer, true);
    doc.addEventListener("mousedown", pointer, true);
    doc.addEventListener("keydown", keyboard, true);
  }
  return () => {
    for (const doc of documents) {
      doc.removeEventListener("pointerdown", pointer, true);
      doc.removeEventListener("mousedown", pointer, true);
      doc.removeEventListener("keydown", keyboard, true);
    }
    // A fallback outside the provider must recover the browser's own keyboard focus.
    if (documents.length === 1) delete documents[0]!.documentElement.dataset.inputModality;
  };
}

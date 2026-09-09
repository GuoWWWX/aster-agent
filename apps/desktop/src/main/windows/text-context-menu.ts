import { Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from "electron";

export function textContextMenuItems(
  params: Pick<ContextMenuParams, "isEditable" | "selectionText" | "editFlags">,
): MenuItemConstructorOptions[] {
  const copy: MenuItemConstructorOptions = {
    label: "复制", role: "copy", enabled: params.editFlags.canCopy,
  };
  if (!params.isEditable) return params.selectionText.length > 0 ? [copy] : [];
  return [
    { label: "剪切", role: "cut", enabled: params.editFlags.canCut },
    copy,
    { label: "粘贴", role: "paste", enabled: params.editFlags.canPaste },
  ];
}

export function installTextContextMenu(window: BrowserWindow): void {
  window.webContents.on("context-menu", (_event, params) => {
    const items = textContextMenuItems(params);
    if (items.length === 0) return;
    Menu.buildFromTemplate(items).popup({ window });
  });
}

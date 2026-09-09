import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openProjectDirectory } from "./open-project-directory.js";

describe("openProjectDirectory", () => {
  it("opens only a registered existing directory and reports shell failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-open-project-"));
    const getProject = vi.fn(() => ({ id: "project", name: "Demo", rootPath: directory }));
    const openPath = vi.fn().mockResolvedValue("");
    try {
      await openProjectDirectory({ getProject }, "project", openPath);
      expect(getProject).toHaveBeenCalledWith("project");
      expect(openPath).toHaveBeenCalledWith(await realpath(directory));
      openPath.mockResolvedValue("OS error");
      await expect(openProjectDirectory({ getProject }, "project", openPath)).rejects.toThrow("无法在资源管理器打开");
      openPath.mockClear();
      const file = join(directory, "file.txt");
      await writeFile(file, "test");
      getProject.mockReturnValue({ id: "project", name: "Demo", rootPath: file });
      await expect(openProjectDirectory({ getProject }, "project", openPath)).rejects.toThrow("文件夹");
      getProject.mockImplementation(() => { throw new Error("Unknown project"); });
      await expect(openProjectDirectory({ getProject }, "unknown", openPath)).rejects.toThrow("Unknown project");
      expect(openPath).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

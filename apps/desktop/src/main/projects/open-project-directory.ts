import { realpath, stat } from "node:fs/promises";
import type { ProjectRegistry } from "./project-registry.js";

export async function openProjectDirectory(
  registry: Pick<ProjectRegistry, "getProject">,
  projectId: string,
  openPath: (path: string) => Promise<string>,
): Promise<void> {
  const path = await realpath(registry.getProject(projectId).rootPath);
  if (!(await stat(path)).isDirectory()) throw new Error("项目目录不存在或已不是文件夹");
  if (await openPath(path)) throw new Error("无法在资源管理器打开项目目录");
}

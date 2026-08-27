import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectRegistry } from "./project-registry.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) =>
      rm(rootPath, { force: true, recursive: true })
    )
  );
});

async function createProjectFixture(): Promise<string> {
  const rootPath = await mkdtemp(path.join(tmpdir(), "agent-project-registry-"));
  temporaryRoots.push(rootPath);
  await mkdir(path.join(rootPath, "apps", "web"), { recursive: true });
  await writeFile(path.join(rootPath, "README.md"), "# fixture\n", "utf8");
  await writeFile(path.join(rootPath, "apps", "web", "main.ts"), "export {};\n", "utf8");

  return rootPath;
}

async function writeJavaFixture(
  rootPath: string,
  name: string,
  declaration: string
): Promise<void> {
  await writeFile(path.join(rootPath, name), declaration, "utf8");
}

describe("ProjectRegistry", () => {
  it("registers a directory once and lists its direct children safely", async () => {
    const rootPath = await createProjectFixture();
    const registry = new ProjectRegistry();

    const project = await registry.registerDirectory(rootPath);
    const duplicateProject = await registry.registerDirectory(rootPath);
    const rootListing = await registry.listEntries({
      directoryPath: "",
      projectId: project.id
    });
    const nestedListing = await registry.listEntries({
      directoryPath: "apps",
      projectId: project.id
    });

    expect(duplicateProject.id).toBe(project.id);
    expect(registry.listProjects()).toEqual([project]);
    expect(registry.setProjectPinned(project.id, true)).toMatchObject({
      isPinned: true,
    });
    expect(registry.listProjects()).toEqual([
      expect.objectContaining({ id: project.id, isPinned: true }),
    ]);
    expect(rootListing.entries).toEqual([
      expect.objectContaining({ kind: "directory", name: "apps", path: "apps" }),
      expect.objectContaining({ kind: "file", name: "README.md", path: "README.md" })
    ]);
    expect(nestedListing.entries).toEqual([
      expect.objectContaining({ kind: "directory", name: "web", path: "apps/web" })
    ]);
    for (const entry of [...rootListing.entries, ...nestedListing.entries]) {
      expect(Number.isNaN(Date.parse(entry.modifiedAt ?? ""))).toBe(false);
    }
  });

  it("rejects path traversal and unknown project identifiers", async () => {
    const rootPath = await createProjectFixture();
    const registry = new ProjectRegistry();
    const project = await registry.registerDirectory(rootPath);

    await expect(
      registry.listEntries({
        directoryPath: "../outside",
        projectId: project.id
      })
    ).rejects.toThrow();
    await expect(
      registry.listEntries({
        directoryPath: "",
        projectId: "00000000-0000-4000-8000-000000000099"
      })
    ).rejects.toThrow("not registered");
  });

  it("mounts a conversation workspace without adding it to the project list", async () => {
    const rootPath = await createProjectFixture();
    const registry = new ProjectRegistry();
    const conversationId = "00000000-0000-4000-8000-000000000010";

    const workspace = await registry.mountConversationWorkspace(conversationId, rootPath);
    const listing = await registry.listEntries({
      directoryPath: "apps/web",
      projectId: workspace.id
    });

    expect(workspace).toMatchObject({ id: conversationId, rootPath });
    expect(registry.listProjects()).toEqual([]);
    expect(listing.entries).toContainEqual(expect.objectContaining({
      kind: "file",
      name: "main.ts",
      path: "apps/web/main.ts"
    }));
    registry.unmountConversationWorkspace(conversationId);
    expect(() => registry.getProject(conversationId)).toThrow("not registered");
  });

  it("inherits an authorized workspace for a side conversation", async () => {
    const rootPath = await createProjectFixture();
    const registry = new ProjectRegistry();
    const sourceConversationId = "00000000-0000-4000-8000-000000000010";
    const targetConversationId = "00000000-0000-4000-8000-000000000011";

    await registry.mountConversationWorkspace(sourceConversationId, rootPath);
    registry.inheritConversationWorkspace(sourceConversationId, targetConversationId);

    const listing = await registry.listEntries({
      directoryPath: "apps/web",
      projectId: targetConversationId
    });
    expect(registry.getProject(targetConversationId)).toMatchObject({
      id: targetConversationId,
      rootPath
    });
    expect(listing.entries).toContainEqual(expect.objectContaining({
      kind: "file",
      name: "main.ts",
      path: "apps/web/main.ts"
    }));
    expect(registry.listProjects()).toEqual([]);
  });

  it("identifies Java top-level declaration kinds for file-tree icons", async () => {
    const rootPath = await createProjectFixture();
    await Promise.all([
      writeJavaFixture(rootPath, "Service.java", "public class Service {}"),
      writeJavaFixture(rootPath, "Contract.java", "public interface Contract {}"),
      writeJavaFixture(rootPath, "Status.java", "public enum Status { READY }"),
      writeJavaFixture(rootPath, "Point.java", "public record Point(int x, int y) {}"),
      writeJavaFixture(rootPath, "Marker.java", "public @interface Marker {}"),
      writeJavaFixture(
        rootPath,
        "Actual.java",
        "// interface Fake {}\nclass Helper {}\npublic class Actual {}"
      )
    ]);
    const registry = new ProjectRegistry();
    const project = await registry.registerDirectory(rootPath);

    const listing = await registry.listEntries({ directoryPath: "", projectId: project.id });
    const javaKinds = Object.fromEntries(
      listing.entries
        .filter((entry) => entry.name.endsWith(".java"))
        .map((entry) => [entry.name, entry.javaDeclarationKind])
    );

    expect(javaKinds).toEqual({
      "Actual.java": "class",
      "Contract.java": "interface",
      "Marker.java": "annotation",
      "Point.java": "record",
      "Service.java": "class",
      "Status.java": "enum"
    });
  });

  it("reads text previews and marks binary files without decoding them", async () => {
    const rootPath = await createProjectFixture();
    await writeFile(path.join(rootPath, "binary.class"), Buffer.from([0, 1, 2, 3]));
    const registry = new ProjectRegistry();
    const project = await registry.registerDirectory(rootPath);

    await expect(
      registry.readFile({ path: "README.md", projectId: project.id })
    ).resolves.toMatchObject({
      content: "# fixture\n",
      isBinary: false,
      name: "README.md",
      path: "README.md",
      truncated: false
    });
    await expect(
      registry.readFile({ path: "binary.class", projectId: project.id })
    ).resolves.toMatchObject({
      content: null,
      isBinary: true,
      name: "binary.class"
    });
    await expect(
      registry.readFile({ path: "../outside.txt", projectId: project.id })
    ).rejects.toThrow();
  });

  it("reads bounded Markdown preview images relative to the source file", async () => {
    const rootPath = await createProjectFixture();
    await mkdir(path.join(rootPath, "docs"), { recursive: true });
    await writeFile(path.join(rootPath, "docs", "diagram.png"), Buffer.from([1, 2, 3, 4]));
    const registry = new ProjectRegistry();
    const project = await registry.registerDirectory(rootPath);

    await expect(registry.readPreviewImage({
      path: "./diagram.png?cache=1",
      projectId: project.id,
      sourcePath: "docs/README.md",
    })).resolves.toEqual({
      data: Buffer.from([1, 2, 3, 4]).toString("base64"),
      mimeType: "image/png",
    });
    await expect(registry.readPreviewImage({
      path: "https://example.com/diagram.png",
      projectId: project.id,
      sourcePath: "docs/README.md",
    })).rejects.toThrow();
    await expect(registry.readPreviewImage({
      path: "../outside.png",
      projectId: project.id,
      sourcePath: "README.md",
    })).rejects.toThrow();
  });

  it("rejects preview images larger than the IPC limit", async () => {
    const rootPath = await createProjectFixture();
    await writeFile(path.join(rootPath, "large.png"), Buffer.alloc(8 * 1024 * 1024 + 1));
    const registry = new ProjectRegistry();
    const project = await registry.registerDirectory(rootPath);

    await expect(registry.readPreviewImage({
      path: "large.png",
      projectId: project.id,
      sourcePath: "README.md",
    })).rejects.toThrow(/size limit/i);
  });

  it("creates files and directories without overwriting existing entries", async () => {
    const rootPath = await createProjectFixture();
    const registry = new ProjectRegistry();
    const project = await registry.registerDirectory(rootPath);

    await expect(registry.createEntry({
      kind: "directory",
      path: "apps/web/components",
      projectId: project.id,
    })).resolves.toEqual({
      kind: "directory",
      name: "components",
      path: "apps/web/components",
    });
    await expect(registry.createEntry({
      kind: "file",
      path: "apps/web/components/button.tsx",
      projectId: project.id,
    })).resolves.toEqual({
      kind: "file",
      name: "button.tsx",
      path: "apps/web/components/button.tsx",
    });
    await expect(registry.readFile({
      path: "apps/web/components/button.tsx",
      projectId: project.id,
    })).resolves.toMatchObject({ content: "", isBinary: false });
    await expect(registry.createEntry({
      kind: "file",
      path: "README.md",
      projectId: project.id,
    })).rejects.toThrow();
  });
});

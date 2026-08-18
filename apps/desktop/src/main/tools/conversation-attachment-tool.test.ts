import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import { ConversationAttachmentTool } from "./conversation-attachment-tool.js";

const temporaryDirectories: string[] = [];
const databases: AgentDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-attachment-tool-"));
  temporaryDirectories.push(root);
  const projectRoot = path.join(root, "project");
  await mkdir(projectRoot, { recursive: true });
  const textPath = path.join(projectRoot, "notes.txt");
  const imagePath = path.join(projectRoot, "pixel.png");
  await writeFile(textPath, "0123456789", "utf8");
  await writeFile(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nksAAAAASUVORK5CYII=",
      "base64"
    )
  );

  const database = new AgentDatabase(":memory:");
  databases.push(database);
  const projects = new ProjectRegistry(database);
  const project = await projects.registerDirectory(projectRoot);
  const conversation = database.createConversation(project.id);
  const store = new ConversationAttachmentStore(
    database,
    projects,
    path.join(root, "managed")
  );
  const [textAttachment, imageAttachment] = await store.importFiles(
    conversation.id,
    [textPath, imagePath]
  );
  if (textAttachment === undefined || imageAttachment === undefined) {
    throw new Error("Attachment fixtures were not imported.");
  }
  return {
    conversation,
    imageAttachment,
    textAttachment,
    tool: new ConversationAttachmentTool(store)
  };
}

describe("ConversationAttachmentTool", () => {
  it("returns a bounded text range and an empty range past the end", async () => {
    const { conversation, textAttachment, tool } = await createFixture();

    expect(JSON.parse(tool.execute(conversation.id, JSON.stringify({
      attachment_id: textAttachment.id,
      limit: 4,
      offset: 3
    })).content)).toEqual({
      ok: true,
      value: {
        content: "3456",
        endOffset: 7,
        name: "notes.txt",
        startOffset: 3,
        totalCharacters: 10,
        truncated: true
      }
    });
    expect(JSON.parse(tool.execute(conversation.id, JSON.stringify({
      attachment_id: textAttachment.id,
      offset: 99
    })).content)).toMatchObject({
      ok: true,
      value: { content: "", endOffset: 10, startOffset: 10, truncated: false }
    });
  });

  it("serves concurrent attachment ranges without mixing offsets or content", async () => {
    const { conversation, textAttachment, tool } = await createFixture();
    const results = await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        Promise.resolve(tool.execute(conversation.id, JSON.stringify({
          attachment_id: textAttachment.id,
          limit: 1,
          offset: index % 10,
        }))),
      ),
    );

    for (const [index, result] of results.entries()) {
      const payload = JSON.parse(result.content) as {
        value: { content: string; startOffset: number };
      };
      const offset = index % 10;
      expect(result.isError).toBe(false);
      expect(payload.value).toEqual({
        content: String(offset),
        endOffset: offset + 1,
        name: "notes.txt",
        startOffset: offset,
        totalCharacters: 10,
        truncated: offset < 9,
      });
    }
  });

  it("rejects invalid identifiers, invalid ranges, and image attachments", async () => {
    const { conversation, imageAttachment, tool } = await createFixture();

    expect(tool.execute(conversation.id, "{\"attachment_id\":\"invalid\"}")).toMatchObject({
      isError: true
    });
    expect(tool.execute(conversation.id, JSON.stringify({
      attachment_id: imageAttachment.id,
      offset: -1
    }))).toMatchObject({ isError: true });
    const imageResult = tool.execute(conversation.id, JSON.stringify({
      attachment_id: imageAttachment.id
    }));
    expect(imageResult.isError).toBe(true);
    const imagePayload = JSON.parse(imageResult.content) as {
      agentError: { code: string; retryable: boolean };
      error: string;
      ok: boolean;
    };
    expect(imagePayload).toMatchObject({
      agentError: {
        code: "VALIDATION_FAILED",
        retryable: false,
      },
      ok: false
    });
    expect(imagePayload.error).toContain("提交的数据无效");
  });
});

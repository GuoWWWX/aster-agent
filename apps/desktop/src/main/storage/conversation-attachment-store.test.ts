import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "./agent-database.js";
import { ConversationAttachmentStore } from "./conversation-attachment-store.js";
import { ConversationDeletionService } from "./conversation-deletion-service.js";

const temporaryDirectories: string[] = [];
const databases: AgentDatabase[] = [];
const DOCX_FIXTURE_BASE64 = "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";

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

async function createFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-attachments-"));
  temporaryDirectories.push(directory);
  const projectRoot = path.join(directory, "project");
  const managedRoot = path.join(directory, "managed");
  await mkdir(projectRoot, { recursive: true });

  const database = new AgentDatabase(path.join(directory, "agent.sqlite"));
  databases.push(database);
  const projects = new ProjectRegistry(database);
  const project = await projects.registerDirectory(projectRoot);
  const conversation = database.createConversation(project.id);
  const store = new ConversationAttachmentStore(database, projects, managedRoot);
  return { conversation, database, managedRoot, projectRoot, store };
}

function createPdfFixture(): Buffer {
  const stream = "BT /F1 12 Tf 72 720 Td (Hello PDF) Tj ET";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object) => {
    const offset = Buffer.byteLength(pdf);
    pdf += object;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += [
    "xref",
    "0 6",
    "0000000000 65535 f ",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    "<< /Size 6 /Root 1 0 R >>",
    "startxref",
    String(xrefOffset),
    "%%EOF",
    ""
  ].join("\n");
  return Buffer.from(pdf);
}

describe("ConversationAttachmentStore", () => {
  it("snapshots project text and uploaded images, then binds them to one message", async () => {
    const { conversation, database, projectRoot, store } = await createFixture();
    const textPath = path.join(projectRoot, "notes.md");
    const imagePath = path.join(path.dirname(projectRoot), "pixel.png");
    await writeFile(textPath, `# Notes\n${"context line\n".repeat(5_000)}`, "utf8");
    await writeFile(
      imagePath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nksAAAAASUVORK5CYII=",
        "base64"
      )
    );

    const attachments = await store.importFiles(conversation.id, [textPath, imagePath]);

    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      kind: "file",
      messageId: null,
      name: "notes.md",
      projectPath: "notes.md",
      source: "project",
      truncated: true
    });
    expect(attachments[1]).toMatchObject({
      kind: "image",
      messageId: null,
      name: "pixel.png",
      projectPath: null,
      source: "upload"
    });

    const modelAttachments = store.toModelAttachments(
      conversation.id,
      attachments.map((attachment) => attachment.id),
      true
    );
    expect(modelAttachments[0]).toMatchObject({ kind: "text", truncated: true });
    expect(modelAttachments[0]?.kind === "text" && modelAttachments[0].content)
      .toContain("read_attachment");
    expect(modelAttachments[1]).toMatchObject({ kind: "image" });
    expect(modelAttachments[1]?.kind === "image" && modelAttachments[1].data)
      .toMatch(/^[A-Za-z0-9+/]+=*$/u);

    const run = database.createRunWithUserMessage(
      conversation.id,
      "分析附件",
      "test-model",
      attachments.map((attachment) => attachment.id)
    );
    expect(run.userMessage.attachments.map((attachment) => attachment.messageId))
      .toEqual([run.userMessage.id, run.userMessage.id]);
    expect(database.listDraftConversationAttachments(conversation.id)).toEqual([]);
    expect(database.listContextMessages(conversation.id)[0]?.attachmentIds)
      .toEqual(attachments.map((attachment) => attachment.id));
    expect(() => database.removeDraftConversationAttachment(
      conversation.id,
      attachments[0]!.id
    )).toThrow("sent");

    const segment = store.readText(conversation.id, attachments[0]!.id, 10, 40);
    expect(segment).toMatchObject({ startOffset: 10, truncated: true });
    expect(segment.content.length).toBe(40);
    const assistantMessageId = "00000000-0000-4000-8000-000000000099";
    database.appendAssistantTurn({
      content: "附件分析完成",
      conversationId: conversation.id,
      messageId: assistantMessageId,
      modelId: "test-model",
      runId: run.runId,
      toolCalls: [],
    });
    database.finishRun(run.runId, "completed", null);

    const originalStoredPath = database.getConversationAttachment(
      conversation.id,
      attachments[0]!.id
    ).storedPath;
    const fork = database.forkConversation(conversation.id, "sibling", assistantMessageId);
    const forkAttachmentIds = database.listContextMessages(fork.id)[0]?.attachmentIds ?? [];
    expect(forkAttachmentIds).toHaveLength(2);
    expect(forkAttachmentIds).not.toEqual(attachments.map((attachment) => attachment.id));
    const forkUserMessage = database.listTimeline(fork.id).find(
      (item) => item.kind === "message" && item.role === "user",
    );
    expect(forkUserMessage?.kind).toBe("message");
    if (forkUserMessage?.kind !== "message") throw new Error("Expected a forked user message.");
    expect(forkUserMessage.attachments.map((attachment) => attachment.id))
      .toEqual(forkAttachmentIds);
    expect(forkUserMessage.attachments.every(
      (attachment) => attachment.messageId === forkUserMessage.id,
    )).toBe(true);
    expect(store.toModelAttachments(fork.id, forkAttachmentIds, false)[0])
      .toMatchObject({ kind: "text", name: "notes.md" });

    const deletion = new ConversationDeletionService(database, store, new ProjectRegistry(database));
    await deletion.requestDeletion(fork.id);
    await expect(access(originalStoredPath)).resolves.toBeUndefined();
    await deletion.requestDeletion(conversation.id);
    await expect(access(originalStoredPath)).rejects.toThrow();
  });

  it("keeps project source metadata when a selected file resolves through a workspace link", async () => {
    const { conversation, projectRoot, store } = await createFixture();
    const linkedProjectRoot = `${projectRoot}-linked`;
    temporaryDirectories.push(linkedProjectRoot);
    await writeFile(path.join(projectRoot, "notes.md"), "# Notes", "utf8");
    await symlink(projectRoot, linkedProjectRoot, process.platform === "win32" ? "junction" : "dir");

    const [attachment] = await store.importFiles(conversation.id, [
      path.join(linkedProjectRoot, "notes.md"),
    ]);

    expect(attachment).toMatchObject({ projectPath: "notes.md", source: "project" });
  });

  it("does not expose inherited side-fork attachments as drafts", async () => {
    const { conversation, database, projectRoot, store } = await createFixture();
    const imagePath = path.join(projectRoot, "context.png");
    await writeFile(
      imagePath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nksAAAAASUVORK5CYII=",
        "base64",
      ),
    );

    const [attachment] = await store.importFiles(conversation.id, [imagePath]);
    if (attachment === undefined) throw new Error("Attachment fixture is unavailable.");
    const run = database.createRunWithUserMessage(
      conversation.id,
      "分析图片",
      "test-model",
      [attachment.id],
    );
    database.appendAssistantTurn({
      content: "图片已分析",
      conversationId: conversation.id,
      messageId: "00000000-0000-4000-8000-000000000197",
      modelId: "test-model",
      runId: run.runId,
      toolCalls: [],
    });
    database.finishRun(run.runId, "completed", null);

    const sideConversation = database.forkConversation(conversation.id, "side");

    expect(database.listDraftConversationAttachments(sideConversation.id)).toEqual([]);
    const inheritedAttachmentIds = database.listContextMessages(sideConversation.id)
      .flatMap((message) => message.attachmentIds);
    expect(inheritedAttachmentIds).toHaveLength(1);
    expect(inheritedAttachmentIds[0]).not.toBe(attachment.id);
    expect(database.getConversationAttachment(
      sideConversation.id,
      inheritedAttachmentIds[0]!,
    )).toMatchObject({ kind: "image" });

    const [sideDraft] = await store.importFiles(sideConversation.id, [imagePath]);
    if (sideDraft === undefined) throw new Error("Side draft fixture is unavailable.");
    expect(database.listDraftConversationAttachments(sideConversation.id).map(
      (candidate) => candidate.id,
    )).toEqual([sideDraft.id]);
  });

  it("removes draft files from both SQLite and managed storage", async () => {
    const { conversation, database, store } = await createFixture();
    const sourcePath = path.join(os.tmpdir(), `agent-upload-${conversation.id}.txt`);
    temporaryDirectories.push(sourcePath);
    await writeFile(sourcePath, "temporary upload", "utf8");
    const [attachment] = await store.importFiles(conversation.id, [sourcePath]);
    if (attachment === undefined) throw new Error("Attachment fixture was not imported.");
    const storedPath = database.getConversationAttachment(
      conversation.id,
      attachment.id
    ).storedPath;

    await store.removeDraft(conversation.id, attachment.id);

    expect(database.listDraftConversationAttachments(conversation.id)).toEqual([]);
    await expect(access(storedPath)).rejects.toThrow();
  });

  it("extracts searchable text from PDF and DOCX snapshots", async () => {
    const { conversation, projectRoot, store } = await createFixture();
    const pdfPath = path.join(projectRoot, "sample.pdf");
    const docxPath = path.join(projectRoot, "sample.docx");
    await writeFile(pdfPath, createPdfFixture());
    await writeFile(docxPath, Buffer.from(DOCX_FIXTURE_BASE64, "base64"));

    const attachments = await store.importFiles(conversation.id, [pdfPath, docxPath]);
    const modelAttachments = store.toModelAttachments(
      conversation.id,
      attachments.map((attachment) => attachment.id),
      false
    );

    expect(modelAttachments[0]?.kind === "text" && modelAttachments[0].content)
      .toContain("Hello PDF");
    expect(modelAttachments[1]?.kind === "text" && modelAttachments[1].content)
      .toContain("This XML has a byte order mark.");
  });

  it("imports clipboard bytes into the managed snapshot store without a source path", async () => {
    const { conversation, database, store } = await createFixture();
    const attachment = await store.importBytes(conversation.id, {
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nksAAAAASUVORK5CYII=",
        "base64",
      ),
      mimeType: "image/png",
      name: "clipboard-image.png",
    });

    expect(attachment).toMatchObject({
      kind: "image",
      name: "clipboard-image.png",
      projectPath: null,
      source: "upload",
    });
    const stored = database.getConversationAttachment(conversation.id, attachment.id);
    await expect(access(stored.storedPath)).resolves.toBeUndefined();
    const [modelAttachment] = store.toModelAttachments(conversation.id, [attachment.id], true);
    expect(modelAttachment).toMatchObject({ kind: "image", mimeType: "image/png" });
    expect(modelAttachment?.kind === "image" ? modelAttachment.data : null).toMatch(/^[A-Za-z0-9+/]+=*$/u);
  });
});

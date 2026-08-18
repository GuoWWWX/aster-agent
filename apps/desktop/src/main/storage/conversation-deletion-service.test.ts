import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "./agent-database.js";
import { ConversationAttachmentStore } from "./conversation-attachment-store.js";
import {
  ConversationDeletionService,
  type ConversationDeletionFileStore,
} from "./conversation-deletion-service.js";

const databases: AgentDatabase[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true })
  ));
});

async function createFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-deletion-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "agent.sqlite");
  const managedRoot = path.join(directory, "managed");
  const projectRoot = path.join(directory, "project");
  await mkdir(projectRoot, { recursive: true });
  const database = new AgentDatabase(databasePath);
  databases.push(database);
  const projects = new ProjectRegistry(database);
  const project = await projects.registerDirectory(projectRoot);
  const attachments = new ConversationAttachmentStore(database, projects, managedRoot);
  return { attachments, database, databasePath, managedRoot, project, projectRoot, projects };
}

async function importTextAttachment(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  conversationId: string,
  name = "notes.txt",
): Promise<string> {
  const sourcePath = path.join(fixture.projectRoot, name);
  await writeFile(sourcePath, "deletion fixture", "utf8");
  const [attachment] = await fixture.attachments.importFiles(conversationId, [sourcePath]);
  if (attachment === undefined) throw new Error("Attachment fixture was not imported.");
  return fixture.database.getConversationAttachment(conversationId, attachment.id).storedPath;
}

describe("ConversationDeletionService", () => {
  it("hides a conversation before removing its files and database tree", async () => {
    const fixture = await createFixture();
    const conversation = fixture.database.createConversation(fixture.project.id);
    const storedPath = await importTextAttachment(fixture, conversation.id);
    const service = new ConversationDeletionService(
      fixture.database,
      fixture.attachments,
      fixture.projects,
    );

    await expect(service.requestDeletion(conversation.id)).resolves.toBe("completed");

    expect(fixture.database.listConversations()).toEqual([]);
    expect(fixture.database.listIncompleteConversationDeletionTasks()).toEqual([]);
    expect(() => fixture.database.getConversation(conversation.id)).toThrow("not found");
    await expect(access(storedPath)).rejects.toThrow();
  });

  it("retains a shared snapshot until its final conversation reference is deleted", async () => {
    const fixture = await createFixture();
    const conversation = fixture.database.createConversation(fixture.project.id);
    const storedPath = await importTextAttachment(fixture, conversation.id);
    const attachmentId = fixture.database.listDraftConversationAttachments(conversation.id)[0]?.id;
    if (attachmentId === undefined) throw new Error("Attachment fixture is unavailable.");
    const run = fixture.database.createRunWithUserMessage(
      conversation.id,
      "使用附件",
      "test-model",
      [attachmentId],
    );
    fixture.database.finishRun(run.runId, "completed", null);
    const fork = fixture.database.forkConversation(conversation.id);
    const service = new ConversationDeletionService(
      fixture.database,
      fixture.attachments,
      fixture.projects,
    );

    await service.requestDeletion(fork.id);
    await expect(access(storedPath)).resolves.toBeUndefined();
    await service.requestDeletion(conversation.id);
    await expect(access(storedPath)).rejects.toThrow();
  });

  it("persists a retryable task when file deletion fails and resumes it after restart", async () => {
    const fixture = await createFixture();
    const conversation = fixture.database.createConversation(fixture.project.id);
    const storedPath = await importTextAttachment(fixture, conversation.id);
    const failingFiles: ConversationDeletionFileStore = {
      deleteUnreferencedConversationFiles: () => Promise.reject(
        Object.assign(new Error("attachment is locked"), { code: "EACCES" }),
      ),
    };
    const service = new ConversationDeletionService(
      fixture.database,
      failingFiles,
      fixture.projects,
    );

    await expect(service.requestDeletion(conversation.id)).resolves.toBe("pending");
    expect(fixture.database.listConversations()).toEqual([]);
    const [failedTask] = fixture.database.listIncompleteConversationDeletionTasks();
    expect(failedTask?.conversationIds).toEqual([conversation.id]);
    expect(failedTask?.lastError).toContain("attachment is locked");
    expect(failedTask?.retryCount).toBe(1);
    expect(failedTask?.status).toBe("failed");
    fixture.database.close();
    databases.splice(databases.indexOf(fixture.database), 1);

    const reopenedDatabase = new AgentDatabase(fixture.databasePath);
    databases.push(reopenedDatabase);
    const reopenedProjects = new ProjectRegistry(reopenedDatabase);
    const reopenedAttachments = new ConversationAttachmentStore(
      reopenedDatabase,
      reopenedProjects,
      fixture.managedRoot,
    );
    const resumed = new ConversationDeletionService(
      reopenedDatabase,
      reopenedAttachments,
      reopenedProjects,
    );

    await resumed.resumeIncompleteTasks();

    expect(reopenedDatabase.listIncompleteConversationDeletionTasks()).toEqual([]);
    expect(() => reopenedDatabase.getConversation(conversation.id)).toThrow("not found");
    await expect(access(storedPath)).rejects.toThrow();
  });

  it("finishes after restart when files were deleted before the database transaction", async () => {
    const fixture = await createFixture();
    const conversation = fixture.database.createConversation(fixture.project.id);
    const storedPath = await importTextAttachment(fixture, conversation.id);
    const task = fixture.database.createConversationDeletionTask(conversation.id);
    expect(fixture.database.beginConversationDeletionTask(task.id)?.status).toBe("running");
    await fixture.attachments.deleteUnreferencedConversationFiles(
      task.conversationIds,
      task.filePaths,
    );
    await expect(access(storedPath)).rejects.toThrow();
    fixture.database.close();
    databases.splice(databases.indexOf(fixture.database), 1);

    const reopenedDatabase = new AgentDatabase(fixture.databasePath);
    databases.push(reopenedDatabase);
    const reopenedProjects = new ProjectRegistry(reopenedDatabase);
    const reopenedAttachments = new ConversationAttachmentStore(
      reopenedDatabase,
      reopenedProjects,
      fixture.managedRoot,
    );
    const resumed = new ConversationDeletionService(
      reopenedDatabase,
      reopenedAttachments,
      reopenedProjects,
    );

    await resumed.resumeIncompleteTasks();
    await resumed.resumeIncompleteTasks();

    expect(reopenedDatabase.listIncompleteConversationDeletionTasks()).toEqual([]);
    expect(() => reopenedDatabase.getConversation(conversation.id)).toThrow("not found");
  });

  it("resumes after restart when the task was persisted before file deletion", async () => {
    const fixture = await createFixture();
    const conversation = fixture.database.createConversation(fixture.project.id);
    const storedPath = await importTextAttachment(fixture, conversation.id);
    fixture.database.createConversationDeletionTask(conversation.id);
    fixture.database.close();
    databases.splice(databases.indexOf(fixture.database), 1);

    const reopenedDatabase = new AgentDatabase(fixture.databasePath);
    databases.push(reopenedDatabase);
    const reopenedProjects = new ProjectRegistry(reopenedDatabase);
    const reopenedAttachments = new ConversationAttachmentStore(
      reopenedDatabase,
      reopenedProjects,
      fixture.managedRoot,
    );
    const resumed = new ConversationDeletionService(
      reopenedDatabase,
      reopenedAttachments,
      reopenedProjects,
    );

    await resumed.resumeIncompleteTasks();

    expect(reopenedDatabase.listIncompleteConversationDeletionTasks()).toEqual([]);
    expect(() => reopenedDatabase.getConversation(conversation.id)).toThrow("not found");
    await expect(access(storedPath)).rejects.toThrow();
  });

  it("routes retention cleanup through the same recoverable deletion workflow", async () => {
    const fixture = await createFixture();
    const expired = fixture.database.createConversation(fixture.project.id);
    const expiredChild = fixture.database.forkConversation(expired.id);
    fixture.database.setConversationArchived(expired.id, true);
    const cutoff = new Date(Date.now() + 5).toISOString();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const retained = fixture.database.createConversation(fixture.project.id);
    fixture.database.setConversationArchived(retained.id, true);
    const service = new ConversationDeletionService(
      fixture.database,
      fixture.attachments,
      fixture.projects,
    );

    await service.deleteExpiredArchivedConversations(cutoff);

    expect(() => fixture.database.getConversation(expired.id)).toThrow("not found");
    expect(() => fixture.database.getConversation(expiredChild.id)).toThrow("not found");
    expect(fixture.database.getConversation(retained.id).isArchived).toBe(true);
  });
});

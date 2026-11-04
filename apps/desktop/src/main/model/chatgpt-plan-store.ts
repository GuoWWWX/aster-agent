import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readJsonConfiguration, writeJsonDocument } from "../settings/json-configuration-file.js";

const connectionSchema = z.object({
  providerId: z.string().uuid(),
  clientId: z.string().min(1),
  label: z.string().min(1).max(100),
  subject: z.string().nullable(),
  email: z.string().nullable(),
  idToken: z.string().nullable(),
  accessToken: z.string().nullable(),
  refreshToken: z.string().nullable(),
  expiresAt: z.number().nonnegative(),
  scopes: z.array(z.string()),
}).strict();

export type ChatGptConnection = z.infer<typeof connectionSchema>;
const dataSchema = z.object({
  hostId: z.string().startsWith("urn:uuid:"),
  connections: z.array(connectionSchema).max(100),
}).strict();
const fileSchema = z.object({ version: z.literal(1), encryptedData: z.string() }).strict();

export class ChatGptPlanStore {
  public constructor(private readonly filePath: string) {}

  public hostId(): string {
    return this.read().hostId;
  }

  public list(): ChatGptConnection[] {
    return this.read().connections;
  }

  public find(providerId: string): ChatGptConnection | undefined {
    return this.list().find((connection) => connection.providerId === providerId);
  }

  public save(connection: ChatGptConnection): void {
    const record = connectionSchema.parse(connection);
    const state = this.read();
    this.write({ ...state, connections: [...state.connections.filter((item) => item.providerId !== record.providerId), record] });
  }

  private read(): z.infer<typeof dataSchema> {
    if (!safeStorage.isEncryptionAvailable()
      || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) {
      throw new Error("系统安全存储不可用，无法保存 ChatGPT 授权。");
    }
    const file = readJsonConfiguration(this.filePath, fileSchema, { version: 1, encryptedData: "" });
    if (file.encryptedData !== "") {
      return dataSchema.parse(JSON.parse(safeStorage.decryptString(Buffer.from(file.encryptedData, "base64"))));
    }
    const state = { hostId: `urn:uuid:${randomUUID()}`, connections: [] };
    this.write(state);
    return state;
  }

  private write(state: z.infer<typeof dataSchema>): void {
    const value = dataSchema.parse(state);
    writeJsonDocument(this.filePath, {
      version: 1,
      encryptedData: safeStorage.encryptString(JSON.stringify(value)).toString("base64"),
    });
  }
}

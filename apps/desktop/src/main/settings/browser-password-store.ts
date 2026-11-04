import { safeStorage } from "electron";
import { unlinkSync } from "node:fs";
import { z } from "zod";
import { browserCredentialSchema, type BrowserCredential, type BrowserSavedPassword } from "@agent/protocol";
import { readJsonConfiguration, writeJsonDocument } from "./json-configuration-file.js";

const passwordFileSchema = z.object({ version: z.literal(1), encryptedData: z.string() }).strict();
const credentialsSchema = z.array(browserCredentialSchema).max(1000);

export class BrowserPasswordStore {
  public constructor(private readonly filePath: string) {}

  public isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
      && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
  }

  public get(origin: string): BrowserCredential | null {
    if (!this.isAvailable()) return null;
    return this.read().find((credential) => credential.origin === origin) ?? null;
  }
  public list(): BrowserSavedPassword[] {
    if (!this.isAvailable()) throw new Error("系统密码加密不可用，无法读取已保存密码。");
    return this.read().map(({ origin, username }) => ({ origin, username }));
  }

  public save(input: BrowserCredential): void {
    const credential = browserCredentialSchema.parse(input);
    if (!this.isAvailable()) throw new Error("系统密码加密不可用，未保存密码。");
    const credentials = credentialsSchema.parse([
      credential, ...this.read().filter((saved) => saved.origin !== credential.origin),
    ]);
    writeJsonDocument(this.filePath, {
      version: 1,
      encryptedData: safeStorage.encryptString(JSON.stringify(credentials)).toString("base64"),
    });
  }

  public clear(): void {
    try { unlinkSync(this.filePath); } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }

  private read(): BrowserCredential[] {
    const file = readJsonConfiguration(this.filePath, passwordFileSchema, { version: 1, encryptedData: "" });
    if (file.encryptedData === "") return [];
    return credentialsSchema.parse(JSON.parse(safeStorage.decryptString(Buffer.from(file.encryptedData, "base64"))));
  }
}

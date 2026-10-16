import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { htmlPreviewRequestSchema, htmlPreviewSchema, type HtmlPreview, type HtmlPreviewRequest } from "@agent/protocol";
import { htmlPreviewDocument } from "./html-preview-document.js";

import { containedPreviewPath, readHtmlPreviewFile, HTML_PREVIEW_MAX_BYTES as MAX_BYTES } from "./html-preview-file.js";
const TYPES: Record<string, string> = { ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const POLICY = "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
type Entry = { owner: string; preview: HtmlPreview; server: Server; references: number };

/** A separate loopback origin for each preview, with no application bridge.
 * Only the entry document and static web assets inside its workspace are served.
 */
export class HtmlPreviewServer {
  private readonly entries = new Map<string, Entry>();
  private disposed = false;
  private generation = 0;
  private pending = 0;
  public constructor(private readonly workspaceRoot: (conversationId: string) => Promise<string>) {}

  public async create(request: HtmlPreviewRequest): Promise<HtmlPreview> {
    const input = htmlPreviewRequestSchema.parse(request);
    if (input.kind !== "code" && input.kind !== "file") throw new Error("Invalid preview source.");
    if (this.disposed) throw new Error("HTML 预览服务已关闭。");
    if (this.entries.size + this.pending >= 64) throw new Error("预览数量已达上限，请关闭其他预览后重试。");
    this.pending += 1;
    const generation = this.generation;
    try {
      const root = input.kind === "file" ? await realpath(await this.workspaceRoot(input.conversationId)) : null;
      const file = input.kind === "file" && root !== null ? await readHtmlPreviewFile(root, input.path) : null;
      const entryPath = file?.path ?? null;
      const source = input.kind === "code" ? input.html : file!.source;
      if (Buffer.byteLength(source) > MAX_BYTES || source.includes("\0")) throw new Error("HTML 文件格式无效或过大。");
      if (this.disposed || generation !== this.generation) throw new Error("HTML 预览服务已关闭。");
      const relativeEntry = root === null || entryPath === null ? "index.html" : path.relative(root, entryPath).split(path.sep).join("/");
      const id = randomUUID();
      const token = randomUUID();
      const document = htmlPreviewDocument(source, id);
      let port = 0;
      const server = createServer((req, res) => { void this.serve(req, res, { root, relativeEntry, source: document, token, port }).catch(() => { if (!res.headersSent) res.writeHead(404); res.end("Preview resource unavailable."); }); });
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
      if (this.disposed || generation !== this.generation) { server.close(); throw new Error("HTML 预览服务已关闭。"); }
      const address = server.address();
      if (address === null || typeof address === "string") { server.close(); throw new Error("无法启动 HTML 预览。"); }
      port = address.port;
      const preview = htmlPreviewSchema.parse({ id, title: entryPath === null ? "HTML 示例" : path.basename(entryPath),
        url: `http://127.0.0.1:${port}/${token}/${relativeEntry.split("/").map(encodeURIComponent).join("/")}`, source });
      this.entries.set(id, { owner: input.conversationId, preview, server, references: 1 });
      server.unref();
      return preview;
    } finally { this.pending -= 1; }
  }

  public get(id: string, owner: string): HtmlPreview {
    const entry = this.entries.get(id);
    if (entry === undefined || entry.owner !== owner) throw new Error("预览不存在或不属于当前对话。");
    return entry.preview;
  }
  public retain(id: string, owner: string): void { this.get(id, owner); this.entries.get(id)!.references += 1; }
  public release(id: string, owner: string): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    this.get(id, owner);
    entry.references -= 1;
    if (entry.references <= 0) { this.entries.delete(id); entry.server.closeAllConnections(); entry.server.close(); }
  }
  public closeAll(): void {
    this.generation += 1;
    for (const entry of this.entries.values()) { entry.server.closeAllConnections(); entry.server.close(); }
    this.entries.clear();
  }
  public dispose(): void { this.disposed = true; this.closeAll(); }

  private async serve(req: IncomingMessage, res: ServerResponse, context: { root: string | null; relativeEntry: string; source: string; token: string; port: number }): Promise<void> {
    if (req.headers.host !== `127.0.0.1:${context.port}` || (req.method !== "GET" && req.method !== "HEAD")) { res.writeHead(403); res.end(); return; }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${context.port}`);
    const pathname = decodeURIComponent(url.pathname);
    const prefix = `/${context.token}/`;
    if (!pathname.startsWith(prefix)) { res.writeHead(404); res.end(); return; }
    const relative = pathname.slice(prefix.length);
    const isEntry = relative === context.relativeEntry;
    const type = isEntry ? "text/html; charset=utf-8" : TYPES[path.extname(relative).toLowerCase()];
    if (type === undefined || (!isEntry && context.root === null)) { res.writeHead(404); res.end(); return; }
    let body: string | Buffer;
    if (isEntry) body = context.source;
    else {
      const file = await containedPreviewPath(context.root!, relative);
      if ((await stat(file)).size > 10_000_000) throw new Error("Asset too large.");
      body = await readFile(file);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Security-Policy": POLICY, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*" });
    res.end(req.method === "HEAD" ? undefined : body);
  }
}

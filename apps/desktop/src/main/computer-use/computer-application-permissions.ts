import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { computerApplicationSchema, type ComputerApplication, type ComputerUseConfiguration } from "@agent/protocol";

export type ComputerAccessDecision = "deny" | "session" | "permanent";
export interface ComputerPermissionStore {
  getConfiguration(): ComputerUseConfiguration;
  saveConfiguration(input: ComputerUseConfiguration): ComputerUseConfiguration;
}
export class ComputerApplicationPermissions {
  private readonly temporary = new Map<string, ComputerApplication>();
  private readonly denied = new Set<string>();
  public constructor(private readonly store: ComputerPermissionStore,
    private readonly prompt: (application: ComputerApplication, signal: AbortSignal) => Promise<ComputerAccessDecision>) {}
  public clearSession(): void { this.temporary.clear(); this.denied.clear(); }
  public describe(executablePath: string): ComputerApplication {
    const canonical = realpathSync(executablePath);
    const known = [...this.store.getConfiguration().applications, ...this.store.getConfiguration().blockedApplications, ...this.temporary.values()]
      .find((value) => value.executablePath.toLowerCase() === canonical.toLowerCase());
    return known === undefined ? computerApplicationSchema.parse({ id: randomUUID(), name: path.win32.basename(canonical, ".exe"), executablePath: canonical, enabled: true }) : { ...known, enabled: true };
  }
  public state(application: ComputerApplication): "allowed" | "blocked" | "ask" {
    const configuration = this.store.getConfiguration();
    const matches = (candidate: ComputerApplication): boolean => candidate.enabled && candidate.executablePath.toLowerCase() === application.executablePath.toLowerCase();
    if (!configuration.enabled || configuration.blockedApplications.some(matches)) return "blocked";
    if (configuration.accessMode === "all" || configuration.applications.some(matches) || this.temporary.has(application.executablePath.toLowerCase())) return "allowed";
    return "ask";
  }
  public grants(): ComputerApplication[] { return [...this.store.getConfiguration().applications, ...this.temporary.values()]; }
  public async authorize(application: ComputerApplication, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const state = this.state(application);
    if (state !== "ask") return state === "allowed";
    const key = application.executablePath.toLowerCase();
    if (this.denied.has(key)) return false;
    const decision = await this.prompt(application, signal);
    signal.throwIfAborted();
    if (this.state(application) === "blocked") return false;
    if (decision === "deny") { this.denied.add(key); return false; }
    if (decision === "permanent") {
      const configuration = this.store.getConfiguration();
      const existing = configuration.applications.find((value) => value.executablePath.toLowerCase() === key);
      const grant = { ...application, id: existing?.id ?? application.id, enabled: true };
      this.store.saveConfiguration({ ...configuration, applications: [...configuration.applications.filter((value) => value.executablePath.toLowerCase() !== key), grant] });
    } else { this.temporary.set(key, { ...application, enabled: true }); }
    return true;
  }
}

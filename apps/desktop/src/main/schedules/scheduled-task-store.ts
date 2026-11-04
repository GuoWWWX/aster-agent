import { scheduledTaskStateSchema, type ScheduledTask } from "@agent/protocol";
import { readJsonConfiguration, writeJsonConfiguration } from "../settings/json-configuration-file.js";

export class ScheduledTaskStore {
  public constructor(private readonly filePath: string) {}
  public read(): ScheduledTask[] {
    return readJsonConfiguration(this.filePath, scheduledTaskStateSchema, { version: 1, tasks: [] }).tasks;
  }
  public write(tasks: ScheduledTask[]): void {
    writeJsonConfiguration(this.filePath, scheduledTaskStateSchema, { version: 1, tasks });
  }
}

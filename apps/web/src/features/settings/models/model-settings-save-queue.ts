import type {
  ModelRuntimeStatus,
  SaveModelConfigurationInput,
  SetDefaultModelInput,
} from "@agent/protocol";
import type { AgentClient } from "../../../runtime/index.js";
import { rememberModelStatus } from "../../../runtime/model-status-cache.js";

const queues = new WeakMap<AgentClient, ModelSettingsSaveQueue>();
const NEW_PROVIDER = "new-provider";

/** Writes outlive an editor mount; failed complete drafts stay in memory only. */
class ModelSettingsSaveQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly failedDrafts = new Map<string, SaveModelConfigurationInput>();
  private readonly createdProviders = new WeakMap<object, string>();

  constructor(private readonly agentClient: AgentClient) {}

  private enqueue(operation: () => Promise<ModelRuntimeStatus>): Promise<ModelRuntimeStatus> {
    const pending = this.tail.then(operation).then(status => rememberModelStatus(this.agentClient, status));
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  saveProvider(input: SaveModelConfigurationInput, creationOwner?: object): Promise<ModelRuntimeStatus> {
    const snapshot = structuredClone(input);
    let effectiveInput = snapshot;
    return this.enqueue(async () => {
      const createdId = creationOwner === undefined ? undefined : this.createdProviders.get(creationOwner);
      if (snapshot.providerId === undefined && createdId !== undefined) effectiveInput = { ...snapshot, providerId: createdId };
      const isFirstCreation = snapshot.providerId === undefined && creationOwner !== undefined && createdId === undefined;
      const knownProviderIds = isFirstCreation
        ? new Set((await this.agentClient.getModelStatus()).models.map(model => model.providerId))
        : null;
      const status = await this.agentClient.saveModelConfiguration(effectiveInput);
      if (knownProviderIds !== null && creationOwner !== undefined) {
        const createdIds = new Set(status.models.filter(model => !knownProviderIds.has(model.providerId)).map(model => model.providerId));
        const createdId = createdIds.size === 1 ? [...createdIds][0] : undefined;
        if (createdId !== undefined) this.createdProviders.set(creationOwner, createdId);
      }
      return status;
    }).then(status => {
      this.failedDrafts.delete(effectiveInput.providerId ?? NEW_PROVIDER);
      this.failedDrafts.delete(snapshot.providerId ?? NEW_PROVIDER);
      return status;
    }, (reason: unknown) => {
      this.failedDrafts.set(effectiveInput.providerId ?? NEW_PROVIDER, effectiveInput);
      throw reason;
    });
  }

  deleteProvider(providerId: string): Promise<ModelRuntimeStatus> {
    return this.enqueue(() => this.agentClient.deleteModelProvider(providerId)).then(status => {
      this.failedDrafts.delete(providerId);
      return status;
    });
  }

  setDefaultModel(input: SetDefaultModelInput): Promise<ModelRuntimeStatus> {
    return this.enqueue(() => this.agentClient.setDefaultModel(input));
  }

  async waitForIdle(): Promise<void> {
    for (;;) {
      const pending = this.tail;
      await pending;
      if (pending === this.tail) return;
    }
  }

  failedDraftFor(providerId: string | null): SaveModelConfigurationInput | null {
    const input = this.failedDrafts.get(providerId ?? NEW_PROVIDER);
    return input === undefined ? null : structuredClone(input);
  }

  createdProviderFor(creationOwner: object): string | null {
    return this.createdProviders.get(creationOwner) ?? null;
  }

  lastFailedDraft(): SaveModelConfigurationInput | null {
    const input = [...this.failedDrafts.values()].at(-1);
    return input === undefined ? null : structuredClone(input);
  }
}

export function getModelSettingsSaveQueue(agentClient: AgentClient): ModelSettingsSaveQueue {
  let queue = queues.get(agentClient);
  if (queue === undefined) {
    queue = new ModelSettingsSaveQueue(agentClient);
    queues.set(agentClient, queue);
  }
  return queue;
}

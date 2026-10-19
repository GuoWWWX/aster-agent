import { useCallback, useEffect, useRef, useState } from "react";
import { type IntegrationConfiguration, integrationConfigurationSchema } from "@agent/protocol";
import { type AgentClient } from "../../../runtime/index.js";
import { useQueuedAutoSave } from "../use-queued-auto-save.js";
import { errorMessage } from "../configuration-state.js";

const EMPTY_INTEGRATION_CONFIGURATION: IntegrationConfiguration = {
  mcpServers: [],
  skillDirectories: [],
  skills: [],
  version: 1,
};

export function useIntegrationConfiguration(agentClient: AgentClient) {
  const [configuration, setConfiguration] = useState<IntegrationConfiguration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const latestSaveRevisionRef = useRef(0);

  useEffect(() => {
    let active = true;
    void agentClient.getIntegrationConfiguration().then(
      (value) => {
        if (active) setConfiguration(value);
      },
      (reason: unknown) => {
        if (active) setError(errorMessage(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [agentClient]);

  const update = useCallback((next: IntegrationConfiguration): void => {
    setError(null);
    setConfiguration(next);
    latestSaveRevisionRef.current += 1;
    setSaveRevision(latestSaveRevisionRef.current);
  }, []);

  const reload = useCallback(async (): Promise<IntegrationConfiguration | null> => {
    try {
      const next = await agentClient.getIntegrationConfiguration();
      setConfiguration(next);
      setError(null);
      return next;
    } catch (reason) {
      setError(errorMessage(reason));
      return null;
    }
  }, [agentClient]);

  const autoSave = useQueuedAutoSave({
    revision: saveRevision,
    save: (next: IntegrationConfiguration) => agentClient.saveIntegrationConfiguration(next),
    validate: (next: IntegrationConfiguration) => {
      const parsed = integrationConfigurationSchema.safeParse(next);
      return parsed.success ? parsed.data : null;
    },
    value: configuration ?? EMPTY_INTEGRATION_CONFIGURATION,
    onError: (reason) => setError(errorMessage(reason)),
    onSaved: (saved, revision) => {
      if (revision === latestSaveRevisionRef.current) setConfiguration(saved);
    },
  });

  return {
    autoSaveState: autoSave.state,
    configuration,
    error,
    flush: autoSave.flush,
    reload,
    setError,
    update,
  };
}

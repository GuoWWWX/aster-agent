import { useState, type ReactElement } from "react";

type Mode = "api-key" | "account";

export function ProviderAuthenticationSettings({ initialMode, onApiKeyMode, apiKey, account }: {
  initialMode: Mode;
  onApiKeyMode: () => void;
  apiKey: ReactElement;
  account: ReactElement;
}): ReactElement {
  const [mode, setMode] = useState(initialMode);
  return (
    <div className="grid min-w-0 gap-[5px]">
      <div aria-label="接入方式" className="settings-segmented" role="group">
        <button aria-pressed={mode === "api-key"} className="settings-secondary-button" type="button" onClick={() => {
          setMode("api-key");
          onApiKeyMode();
        }}>API Key</button>
        <button aria-pressed={mode === "account"} className="settings-secondary-button" type="button" onClick={() => setMode("account")}>账号登录</button>
      </div>
      <div hidden={mode !== "api-key"}>{apiKey}</div>
      <div hidden={mode !== "account"}>{account}</div>
    </div>
  );
}

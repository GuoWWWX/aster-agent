import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@agent/protocol";

import {
  createIpcHandlerRegistrar,
  DESKTOP_IPC_HANDLER_CHANNELS,
} from "./ipc-handler-registrar.js";

describe("IPC handler registrar", () => {
  it("keeps high-frequency browser bounds off the invoke handler registry", () => {
    expect(DESKTOP_IPC_HANDLER_CHANNELS).not.toContain(IPC_CHANNELS.managedBrowserSetBounds);
  });

  it("disposes the same desktop channels that it registers", () => {
    const handledChannels: string[] = [];
    const removedChannels: string[] = [];
    const registrar = createIpcHandlerRegistrar({
      handle: (channel: string) => handledChannels.push(channel),
      removeHandler: (channel: string) => removedChannels.push(channel),
    });

    for (const channel of DESKTOP_IPC_HANDLER_CHANNELS) {
      registrar.handle(channel, vi.fn());
    }
    registrar.assertRegisteredChannels(DESKTOP_IPC_HANDLER_CHANNELS);
    registrar.dispose();
    registrar.dispose();

    expect(handledChannels).toHaveLength(DESKTOP_IPC_HANDLER_CHANNELS.length);
    expect(new Set(handledChannels).size).toBe(DESKTOP_IPC_HANDLER_CHANNELS.length);
    expect(removedChannels).toEqual(handledChannels);
  });

  it("rejects duplicate registration and reports an incomplete set", () => {
    const registrar = createIpcHandlerRegistrar({
      handle: vi.fn(),
      removeHandler: vi.fn(),
    });
    const [firstChannel, secondChannel] = DESKTOP_IPC_HANDLER_CHANNELS;
    if (firstChannel === undefined || secondChannel === undefined) {
      throw new Error("Desktop IPC handler channels are missing.");
    }

    registrar.handle(firstChannel, vi.fn());

    expect(() => registrar.handle(firstChannel, vi.fn())).toThrow(
      `IPC handler is already registered: ${firstChannel}`,
    );
    expect(() =>
      registrar.assertRegisteredChannels([firstChannel, secondChannel]),
    ).toThrow(`Missing: ${secondChannel}`);
  });
});

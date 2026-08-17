import { describe, expect, it } from "vitest";

import { readSseDataStream } from "./sse-data-stream.js";

function streamFromChunks(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function utf8Chunks(values: readonly string[]): Uint8Array[] {
  const encoder = new TextEncoder();
  return values.map((value) => encoder.encode(value));
}

describe("readSseDataStream", () => {
  it("joins multiline data and keeps UTF-8 split across chunks", async () => {
    const values: string[] = [];
    const payload = new TextEncoder().encode(
      "data: {\"message\":\"中文\"}\r\n\r\ndata: [DONE]\r\n\r\n",
    );
    const firstUtf8Byte = payload.indexOf(0xe4);
    if (firstUtf8Byte < 0) throw new Error("Expected UTF-8 fixture bytes.");
    await readSseDataStream(
      streamFromChunks([
        payload.subarray(0, firstUtf8Byte + 1),
        payload.subarray(firstUtf8Byte + 1),
      ]),
      (data) => values.push(data),
    );

    expect(values).toEqual(['{"message":"中文"}', "[DONE]"]);
  });

  it("flushes events when a provider omits the blank separator", async () => {
    const values: string[] = [];
    await readSseDataStream(
      streamFromChunks(utf8Chunks([
        "data: first\n",
        "event: message\n",
        "data: second\n\n",
        "data: tail",
      ])),
      (data) => values.push(data),
    );

    expect(values).toEqual(["first", "second", "tail"]);
  });
});

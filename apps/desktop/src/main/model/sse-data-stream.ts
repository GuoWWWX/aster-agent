export async function readSseDataStream(
  stream: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  const flushData = (): void => {
    const data = dataLines.join("\n");
    dataLines = [];
    if (data.length > 0) onData(data);
  };

  const consumeLines = (isFinalChunk: boolean): void => {
    const lines = buffer.split("\n");
    buffer = isFinalChunk ? "" : lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        // A few OpenAI-compatible providers omit the blank line between events.
        flushData();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
        continue;
      }
      if (line.length === 0) flushData();
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");
    consumeLines(done);
    if (done) break;
  }
  flushData();
}

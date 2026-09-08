import { describe, expect, it } from "vitest";
import { terminalTokens } from "./terminal-tokens.js";

function classified(text: string, command = false) {
  return terminalTokens(text, command).filter((token) => token.kind !== "default")
    .map((token) => [text.slice(token.start, token.end), token.kind]);
}

describe("terminal lexical tokens", () => {
  it("separates executable, hostname, option and numeric argument", () => {
    expect(classified("ping baidu.com -n 4", true)).toEqual([
      ["ping", "command"], ["baidu.com", "address"], ["-n", "parameter"], ["4", "number"],
    ]);
  });
  it("handles common PowerShell and shell constructs without executing them", () => {
    const text = '$r = Test-Connection -TargetName "baidu.com"; echo $r | Select-Object -First 1 # note';
    expect(classified(text, true)).toEqual(expect.arrayContaining([
      ["$r", "variable"], ["Test-Connection", "command"], ['"baidu.com"', "string"],
      ["echo", "command"], ["Select-Object", "command"], ["# note", "comment"],
    ]));
    expect(classified("curl --retry=3 https://example.com/a && echo 'ok'", true)).toEqual(expect.arrayContaining([
      ["--retry", "parameter"], ["3", "number"], ["echo", "command"], ["'ok'", "string"],
    ]));
  });
  it("recognizes Chinese and English ping fields, IPs and units", () => {
    expect(classified("来自 198.18.1.58 的回复: 字节=32 时间<1ms TTL=128，丢失=0 (0%)"))
      .toEqual(expect.arrayContaining([["198.18.1.58", "address"], ["32", "number"], ["1ms", "number"], ["128", "number"], ["0%", "number"]]));
    expect(classified("Reply from 192.168.1.1: bytes=32 time=2ms TTL=128"))
      .toContainEqual(["192.168.1.1", "address"]);
    expect(classified("fe80::1%12 2001:db8::1 ::1"))
      .toEqual([["fe80::1%12", "address"], ["2001:db8::1", "address"], ["::1", "address"]]);
    expect(classified("来自192.168.1.1:443耗时2ms"))
      .toEqual([["192.168.1.1", "address"], ["443", "number"], ["2ms", "number"]]);
  });
  it("recognizes paths without calling version strings or invalid IPs addresses", () => {
    expect(classified('C:\\Code\\app.ts /tmp/result.log ./frontend/src/App.tsx'))
      .toEqual([["C:\\Code\\app.ts", "path"], ["/tmp/result.log", "path"], ["./frontend/src/App.tsx", "path"]]);
    expect(classified("v1.2.3 999.18.1.58 error_count IPv4").filter(([, kind]) => kind === "address")).toEqual([]);
  });
  it("preserves every character and bounds work for dense large output", () => {
    const text = '来自 198.18.1.58: time=1ms\r\n'.repeat(10_000);
    const tokens = terminalTokens(text, false);
    expect(tokens.map((token) => text.slice(token.start, token.end)).join("")).toBe(text);
    expect(tokens.length).toBeLessThanOrEqual(8_001);
  });
});

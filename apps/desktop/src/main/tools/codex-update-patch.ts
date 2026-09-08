/** Single-file Update patches only; exact, unambiguous context, no fuzzy edits. */
export function parseCodexUpdatePatch(patch: string): {
  path: string;
  apply: (content: string) => string;
} | null {
  const lines = patch.replace(/\r\n/gu, "\n").trimEnd().split("\n");
  if (!lines.some((line) => line.startsWith("*** Update File:"))) return null;
  if (lines.shift() !== "*** Begin Patch" || lines.pop() !== "*** End Patch") {
    throw new Error("Update 补丁必须包含完整的 Begin/End Patch 包装。");
  }
  const target = lines.shift()?.match(/^\*\*\* Update File: (.+)$/u)?.[1];
  if (!target || lines.some((line) => line.startsWith("*** ") && line !== "*** End of File")) {
    throw new Error("apply_patch 每次只能更新一个已有文件，不支持移动、新建或删除指令。");
  }
  const hunks: { before: string[]; after: string[]; atEnd: boolean }[] = [];
  for (const line of lines) {
    if (line === "@@" || line.startsWith("@@ ")) {
      hunks.push({ before: [], after: [], atEnd: false });
      continue;
    }
    const hunk = hunks.at(-1);
    if (!hunk || hunk.atEnd) throw new Error("Update 补丁缺少 @@ 或包含无效正文。");
    if (line === "*** End of File") {
      hunk.atEnd = true;
    } else if (line.startsWith(" ")) {
      hunk.before.push(line.slice(1));
      hunk.after.push(line.slice(1));
    } else if (line.startsWith("-")) {
      hunk.before.push(line.slice(1));
    } else if (line.startsWith("+")) {
      hunk.after.push(line.slice(1));
    } else {
      throw new Error("Update 补丁正文必须以空格、+ 或 - 开头。");
    }
  }
  if (!hunks.length || hunks.some((hunk) => !hunk.before.length)) {
    throw new Error("Update 补丁需要可精确匹配的源文件上下文。");
  }
  return {
    path: target,
    apply(content) {
      const newline = content.includes("\r\n") ? "\r\n" : "\n";
      const trailingNewline = content.endsWith("\n");
      const source = content.replace(/\r\n/gu, "\n").split("\n");
      if (trailingNewline) source.pop();
      let output: string[] = [];
      let cursor = 0;
      for (const hunk of hunks) {
        let match = -1;
        for (let index = cursor; index <= source.length - hunk.before.length; index += 1) {
          if (hunk.atEnd && index + hunk.before.length !== source.length) continue;
          if (!hunk.before.every((line, offset) => source[index + offset] === line)) continue;
          if (match !== -1) throw new Error("补丁上下文不唯一；请补充上下文后重试。");
          match = index;
        }
        if (match === -1) throw new Error("补丁上下文与当前文件不匹配；请重新读取文件。");
        output = output.concat(source.slice(cursor, match), hunk.after);
        cursor = match + hunk.before.length;
      }
      output = output.concat(source.slice(cursor));
      return output.join(newline) + (trailingNewline ? newline : "");
    },
  };
}

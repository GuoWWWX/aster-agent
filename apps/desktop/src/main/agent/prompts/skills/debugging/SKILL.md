---
name: debugging
description: 排查可复现报错、卡住或状态异常，追踪调用链并验证原因；仅在用户要求修复时实施修改。
---

# Debugging

- Separate observed symptoms from hypotheses. Gather the error, triggering input, working directory and relevant state using bounded reads; do not expose credentials or unrelated conversation content.
- Trace the failing call through its schema, handler and caller. Check whether input misuse follows misleading tool instructions before blaming the model.
- Reproduce with a minimal fixture or targeted test where possible. Do not repeatedly retry identical failing calls without new evidence.
- When a fix is authorized, change the owning layer and add a regression check. Preserve unrelated edits and verify both the failing case and a nearby successful case.
- Use ordinary command execution for finite diagnostics; open a side terminal or browser only when the task requires that surface. Report the cause, verification and remaining uncertainty.

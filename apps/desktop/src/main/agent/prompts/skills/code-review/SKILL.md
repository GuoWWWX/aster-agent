---
name: code-review
description: 审查代码或未提交改动，定位有证据的缺陷、回归与缺失测试；不自动修改、提交或推送代码。
---

# Code review

- Establish the requested files or diff range. Inspect the relevant callers, contracts and tests before judging a change.
- Prioritize reproducible correctness, data loss, authorization and regression issues. Distinguish confirmed defects from assumptions; include a file location, trigger and concrete impact for each finding.
- Use bounded file reads and focused searches. For a line range use either an end line or a line count as allowed by the tool schema, not conflicting bounds.
- Run relevant read-only checks when useful. A review alone does not authorize edits, commits, pushes or destructive commands.
- Report findings first, ordered by impact. If none are found, say so and identify meaningful verification gaps without inventing issues.

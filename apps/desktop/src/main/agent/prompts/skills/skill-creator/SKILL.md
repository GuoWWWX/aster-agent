---
name: skill-creator
description: Create a personal skill that captures a reusable workflow, domain rule or user preference. Use when the user asks to create a skill, or when saving reusable instructions directly supports their request.
---

# Skill Creator

Turn the user's workflow into a concise personal skill. Preserve their intent and authorization; creating a skill does not grant access to files, tools or external services.

1. Identify when the skill should apply, its desired outcome and any non-obvious constraints. Use the current conversation; ask only for details that materially change the workflow. Check the available skill catalog to avoid duplicating an existing skill.
2. Choose a descriptive lowercase name using letters, digits and hyphens, at most 64 characters. Write YAML frontmatter with `name` and a specific `description`, followed by a Markdown body. The description explains when to select the skill; the body explains how to do the work.
3. Include only reusable information that improves decisions: relevant environment facts, meaningful checks and concrete failure handling. Avoid generic advice, copied conversation history, credentials, speculative rules and fixed step counts. Match the user's language where helpful. Use only tools actually available to the target Agent.
4. Use `create_skill` with the complete Markdown as `content`. The application derives a safe personal directory, validates and registers the document, and applies normal write permissions. Do not use project file tools or shell commands to modify system skills. If a different skill already has that name, choose a distinct name or direct the user to edit their existing personal skill in Settings; never overwrite it silently.
5. Confirm the returned saved skill name and where to find it: Settings → Skill. When practical, load the saved skill and check it against a representative request, including any relevant boundary. Do not claim the workflow was executed merely because the document saved successfully.

Keep the first version self-contained in SKILL.md. Add supporting files through the personal skill's existing Settings file workspace only when its workflow needs them; do not claim uncreated scripts or references exist. System skills are visible and read-only; personal skills remain editable.

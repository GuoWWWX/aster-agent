---
name: imagegen
description: Generate or edit raster images from text, multiple reference images, or previously generated images. Use for photos, illustrations, mockups and image variants; prefer code tools for requested HTML/SVG animations.
---

# Image generation

Use `generate_images` after loading this Skill. It uses configured image models and saves output directly in the current conversation.

- Preserve the user's subject, composition, exact text and requested count. Add only details that clarify their intent. Describe each reference's role and what an edit must preserve.
- No reference: provide the full visual brief in `prompt`. With references: pass the current conversation's image attachment IDs in `referenceAttachmentIds`; do not paste base64, paths or provider credentials.
- Read reference images with `view_attachments` if needed to understand them. For edits of a generated image, reuse its returned attachment ID.
- `count` (1–10) creates variants of one prompt in one tool call; the backend handles providers that return fewer images per request. Different subjects require separate prompts. Respect the user's requested count; users can specify the count in their message.
- Prefer the current provider's configured image model; specify `providerId` and `modelId` only when the user chooses a different available image model. Image models are separate from the conversation model.
- Use the returned `displayRef` in a standalone Markdown paragraph, e.g. `[生成图片](artifact:...)`, between complete paragraphs of the final answer. Copy the exact reference; never invent one or place it inside a sentence, quote, list or code fence. The batch displays there as one enlargable row; without a reference it displays automatically. Do not repeat the reference, source images or raw base64. Keep the result brief and note fewer images or errors honestly.
- Check returned images with `view_attachments(paths=readPaths)` when visual correctness matters; use the exact returned paths. Retry or create extra paid variants only when needed for the user's request; never automatically repeat a failed or cancelled generation.

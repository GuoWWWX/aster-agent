---
name: image-view
description: 查看、展示或比较项目图片与上传、粘贴图片，直接在对话中预览；不用于网页交互或生成图片。
---

# Image inspection

- Use `view_attachments` with `paths` for one to four images per call. Workspace images use workspace-relative paths; pasted/uploaded snapshots use the `attachments/...` path supplied in image context. Use `./attachments/...` for a workspace directory with that name.
- If the path is unknown, locate image files with the available file discovery tool first. Do not guess snapshot filenames or pass attachment IDs as paths.
- The tool supplies model vision input and clickable inline thumbnails. Do not launch a server or browser just to display local images.
- Describe only visible details. For comparisons, keep the returned image order clear. If decoding or vision support fails, report the failure rather than inferring image contents from filenames.

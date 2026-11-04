# Provider brand assets

Checked on 2026-10-15. These files identify the services in the provider picker;
the marks belong to their respective owners. Existing monochrome marks continue
to use the bundled Simple Icons collection.

- `gemini.png`: Google Gemini's current four-color sparkle, from
  https://gemini.google/images/spark_4c.png (linked by https://gemini.google/overview/).
- `zai.svg`: Z.ai's favicon, from
  https://z-cdn.chatglm.cn/z-ai/static/logo.svg (linked by https://chat.z.ai/).

Both assets are bundled locally. Rendering a provider logo makes no request to
the vendor's website. The SVG is used as an image, without inline styles leaking
into the application. Uploaded provider logos retain priority over built-ins.

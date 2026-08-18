import { redactErrorIdentifiers } from "@agent/protocol";

const MAX_ERROR_DETAIL_LENGTH = 600;

export class ModelRequestError extends Error {
  public constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ModelRequestError";
  }
}

function compact(value: string): string {
  const normalized = redactErrorIdentifiers(value.replace(/\s+/g, " ").trim());
  return normalized.length <= MAX_ERROR_DETAIL_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_ERROR_DETAIL_LENGTH)}...`;
}

function gatewayTitle(value: string): string | null {
  const title = value.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (title === undefined) return null;
  const compactTitle = compact(title);
  return compactTitle.length > 0 ? compactTitle : null;
}

function errorMessageFromJson(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const error = (value as { error?: unknown }).error;
  if (typeof error === "string") return compact(error);
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return compact(message);
  }
  const message = (value as { message?: unknown }).message;
  return typeof message === "string" ? compact(message) : null;
}

/**
 * Returns an actionable provider error without exposing entire proxy/CDN HTML pages in chat.
 */
export async function readModelErrorBody(response: Response): Promise<string> {
  const body = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const isHtml = contentType.includes("text/html") || /^\s*<!doctype html/i.test(body);
  if (isHtml) {
    const title = gatewayTitle(body);
    return title === null
      ? "Model provider returned an HTML gateway error page."
      : `Model provider returned an HTML gateway error: ${title}`;
  }

  try {
    const jsonMessage = errorMessageFromJson(JSON.parse(body) as unknown);
    if (jsonMessage !== null) return jsonMessage;
  } catch {
    // Plain-text provider errors are handled below.
  }

  return compact(body) || "The model provider did not return error details.";
}

export async function createModelRequestError(response: Response): Promise<ModelRequestError> {
  const details = await readModelErrorBody(response);
  return new ModelRequestError(
    response.status,
    `Model request failed (${response.status}): ${details}`
  );
}

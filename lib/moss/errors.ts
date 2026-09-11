import type { RetrievalFallbackReason } from "./types";

const SECRET_PATTERNS = [
  /moss_access_key_[a-zA-Z0-9_-]+/gi,
  /project[_-]?key[=:\s]+[^\s]+/gi,
  /MOSS_PROJECT_KEY[=:\s]+[^\s]+/gi,
];

export function redactSecrets(text: string): string {
  let redacted = text;

  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }

  return redacted;
}

export function mossErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return redactSecrets(error.message);
  }

  return "Moss retrieval failed.";
}

export function classifyMossFailure(error: unknown): RetrievalFallbackReason {
  const message = mossErrorMessage(error).toLowerCase();

  if (message.includes("unauthorized") || message.includes("invalid credentials")) {
    return "unauthorized";
  }

  if (message.includes("index not found") || message.includes("does not exist")) {
    return "index_not_found";
  }

  if (message.includes("index not loaded") || message.includes("not loaded")) {
    return "index_not_loaded";
  }

  if (message.includes("timed out") || message.includes("timeout")) {
    return "timeout";
  }

  if (message.includes("missing") && message.includes("configuration")) {
    return "missing_configuration";
  }

  return "error";
}

export function publicMossError(error: unknown): string {
  const reason = classifyMossFailure(error);

  switch (reason) {
    case "unauthorized":
      return "Moss credentials were rejected.";
    case "index_not_found":
      return "Moss index was not found.";
    case "index_not_loaded":
      return "Moss index is not loaded.";
    case "timeout":
      return "Moss query timed out.";
    case "missing_configuration":
      return "Moss is not fully configured.";
    default:
      return "Moss retrieval failed.";
  }
}

export const REDACTION_CENSOR = "[REDACTED]";

export const sensitiveLogPaths = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "passwordHash",
  "password_hash",
  "sessionToken",
  "session_token",
  "sessionTokenHash",
  "session_token_hash",
  "csrfToken",
  "csrf_token",
  "csrfTokenHash",
  "csrf_token_hash",
  "publicCredential",
  "public_credential",
  "invitationToken",
  "invitation_token",
  "invitationTokenHash",
  "invitation_token_hash",
  "publicTokenHash",
  "public_token_hash",
  "checkinToken",
  "checkin_token",
  "checkinTokenHash",
  "checkin_token_hash",
  "tokenHash",
  "token_hash",
  "qrPayload",
  "qr_payload",
  "qrCredential",
  "qr_credential",
  "credential",
  "credentialSecret",
  "credential_secret",
  "hmacSecret",
  "hmac_secret",
  "DATABASE_URL",
  "databaseUrl",
  "database_url",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.set-cookie",
  "res.headers.set-cookie",
  "*.authorization",
  "*.cookie",
  "*.set-cookie",
  "*.password",
  "*.passwordHash",
  "*.password_hash",
  "*.sessionToken",
  "*.session_token",
  "*.sessionTokenHash",
  "*.session_token_hash",
  "*.csrfToken",
  "*.csrf_token",
  "*.csrfTokenHash",
  "*.csrf_token_hash",
  "*.publicCredential",
  "*.public_credential",
  "*.invitationToken",
  "*.invitation_token",
  "*.invitationTokenHash",
  "*.invitation_token_hash",
  "*.publicTokenHash",
  "*.public_token_hash",
  "*.checkinToken",
  "*.checkin_token",
  "*.checkinTokenHash",
  "*.checkin_token_hash",
  "*.tokenHash",
  "*.token_hash",
  "*.qrPayload",
  "*.qr_payload",
  "*.qrCredential",
  "*.qr_credential",
  "*.credential",
  "*.credentialSecret",
  "*.credential_secret",
  "*.hmacSecret",
  "*.hmac_secret",
  "*.DATABASE_URL",
  "*.databaseUrl",
  "*.database_url",
];

export const pinoRedactOptions = {
  paths: sensitiveLogPaths,
  censor: REDACTION_CENSOR,
};

const CREDENTIAL_PATH_PATTERNS = [
  /^\/api\/public\/invitations\/([^/?#]+)/i,
  /^\/api\/public\/checkin\/([^/?#]+)/i,
  /^\/i\/([^/?#]+)/i,
  /^\/c\/([^/?#]+)/i,
];

const SENSITIVE_QUERY_KEYS = new Set([
  "authorization",
  "credential",
  "invitationToken",
  "invitation_token",
  "checkinToken",
  "checkin_token",
  "qrPayload",
  "qr_payload",
  "token",
]);

export function sanitizeRequestUrl(url: string | undefined): string | undefined {
  if (!url) {
    return url;
  }

  try {
    const parsedUrl = new URL(url, "http://local.invalid");
    parsedUrl.pathname = sanitizeCredentialPath(parsedUrl.pathname);

    for (const key of [...parsedUrl.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key)) {
        parsedUrl.searchParams.set(key, REDACTION_CENSOR);
      }
    }

    return `${parsedUrl.pathname}${parsedUrl.search}`;
  } catch {
    return sanitizeCredentialPath(url.split("?")[0] ?? url);
  }
}

export function sanitizeCredentialPath(pathname: string): string {
  return CREDENTIAL_PATH_PATTERNS.reduce(
    (currentPathname, pattern) =>
      currentPathname.replace(pattern, (match, credential: string) =>
        match.replace(credential, REDACTION_CENSOR),
      ),
    pathname,
  );
}

type SerializedRequest = {
  id?: unknown;
  method?: unknown;
  url?: unknown;
  originalUrl?: unknown;
  headers?: Record<string, unknown>;
  remoteAddress?: unknown;
  remotePort?: unknown;
};

export function serializeRequestForLogging(request: SerializedRequest) {
  return {
    id: request.id,
    method: request.method,
    url: sanitizeRequestUrl(
      typeof request.url === "string" ? request.url : undefined,
    ),
    remoteAddress: request.remoteAddress,
    remotePort: request.remotePort,
    headers: request.headers,
  };
}

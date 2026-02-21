const REDACTED = '[REDACTED]';

// Patterns for high-signal secret forms commonly seen in logs.
const SECRET_KEY_PATTERN =
  '(?:access_token|refresh_token|id_token|token|api[_-]?key|apikey|client_secret|secret|password|authorization|x-api-key|private_key|session_token)';

const JSON_SECRET_PAIR_REGEX = new RegExp(
  `("(${SECRET_KEY_PATTERN})"\\s*:\\s*")([^"\\r\\n]{3,})(")`,
  'gi',
);
const AUTH_SCHEME_ASSIGNMENT_REGEX = /\bauthorization\b\s*([=:])\s*(?:Bearer|Basic)\s+[^\s,;&]+/gi;
const ASSIGNMENT_SECRET_PAIR_REGEX = new RegExp(
  `(\\b${SECRET_KEY_PATTERN}\\b\\s*[=:]\\s*)([^\\s,;&@]+)`,
  'gi',
);
const URL_SECRET_PARAM_REGEX = new RegExp(`([?&](?:${SECRET_KEY_PATTERN})=)([^&#\\s]+)`, 'gi');
const BEARER_REGEX = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi;
const BASIC_REGEX = /\bBasic\s+[A-Za-z0-9+/=]{8,}\b/gi;
const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const GITHUB_TOKEN_REGEX = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const GENERIC_SK_TOKEN_REGEX = /\bsk-[A-Za-z0-9]{20,}\b/g;

export function redactSensitiveData(input: string): string {
  if (!input) {
    return input;
  }

  let output = input;

  output = output.replace(JSON_SECRET_PAIR_REGEX, `$1${REDACTED}$4`);
  output = output.replace(AUTH_SCHEME_ASSIGNMENT_REGEX, `authorization$1${REDACTED}`);
  output = output.replace(ASSIGNMENT_SECRET_PAIR_REGEX, `$1${REDACTED}`);
  output = output.replace(URL_SECRET_PARAM_REGEX, `$1${REDACTED}`);

  output = output.replace(BEARER_REGEX, `Bearer ${REDACTED}`);
  output = output.replace(BASIC_REGEX, `Basic ${REDACTED}`);
  output = output.replace(JWT_REGEX, REDACTED);
  output = output.replace(GITHUB_TOKEN_REGEX, REDACTED);
  output = output.replace(GENERIC_SK_TOKEN_REGEX, REDACTED);

  return output;
}

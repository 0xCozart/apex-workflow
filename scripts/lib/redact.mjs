const SECRET_PATTERNS = [
  /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /\b((?:[A-Z0-9_]*_)?(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD))=([^\s"'`]+)/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,
  /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
];

export function redact(value) {
  let output = String(value ?? "");
  output = output.replace(SECRET_PATTERNS[0], "$1[REDACTED]");
  output = output.replace(SECRET_PATTERNS[1], "$1=[REDACTED]");
  for (const pattern of SECRET_PATTERNS.slice(2)) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}

export function tailRedacted(value, limit = 4000) {
  const text = redact(value);
  if (text.length <= limit) return { text, truncated: false };
  return {
    text: text.slice(text.length - limit),
    truncated: true,
  };
}

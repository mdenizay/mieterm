// The terminal stream crosses IPC as base64, because it is bytes rather than text: a pty
// read can land mid-way through a UTF-8 or escape sequence, and letting JSON decode it
// would corrupt exactly the multi-byte output people notice. xterm.js takes the bytes and
// does its own decoding.

export function decodeBase64(input: string): Uint8Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeText(input: string): string {
  const bytes = new TextEncoder().encode(input);
  // String.fromCharCode has an argument limit, so a large paste is chunked rather than
  // spread in one call.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

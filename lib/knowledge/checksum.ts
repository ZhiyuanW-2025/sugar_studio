export async function sha256Hex(input: Blob | Uint8Array) {
  const bytes = input instanceof Blob
    ? new Uint8Array(await input.arrayBuffer())
    : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

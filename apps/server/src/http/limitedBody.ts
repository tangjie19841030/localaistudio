/**
 * Read a request body with a HARD byte cap applied while streaming chunks in.
 * Content-Length is attacker-controlled (and absent under chunked transfer),
 * so c.req.arrayBuffer() + a post-hoc length check buffers unbounded memory
 * before the limit is ever enforced.
 */
export class PayloadTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`请求体超过 ${limitBytes} 字节上限`);
    this.name = "PayloadTooLargeError";
  }
}

export async function readLimitedBody(req: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number.parseInt(req.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PayloadTooLargeError(maxBytes);
  }
  const stream = req.body;
  if (!stream) {
    // No body stream (empty request): callers distinguish empty themselves.
    return Buffer.alloc(0);
  }
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new PayloadTooLargeError(maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    // Release the stream when bailing out (avoids dangling Hono body pumps).
    if (total > maxBytes) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

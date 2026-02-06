/**
 * Stream conversion helpers for Next.js Route Handlers.
 */
import type { Readable } from 'stream';

/**
 * Convert a Node.js Readable stream (e.g. PDFKit document) into a Web ReadableStream.
 * This allows streaming PDFs directly through Next.js Route Handlers without buffering.
 */
export function nodeStreamToWebReadableStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on('end', () => {
        controller.close();
      });
      nodeStream.on('error', (err: Error) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

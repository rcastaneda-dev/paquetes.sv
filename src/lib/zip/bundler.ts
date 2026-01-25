import archiver from 'archiver';
import { Readable, PassThrough } from 'stream';

/**
 * Creates a ZIP archive from multiple file buffers.
 * Returns a readable stream for efficient memory usage.
 */
export function createZipArchive(files: Array<{ name: string; data: Buffer }>): Readable {
  const archive = archiver('zip', {
    zlib: { level: 9 }, // Maximum compression
  });

  const passThrough = new PassThrough();
  archive.pipe(passThrough);

  // Add all files to the archive
  for (const file of files) {
    archive.append(file.data, { name: file.name });
  }

  // Finalize the archive
  archive.finalize();

  return passThrough;
}

/**
 * Helper to convert a stream to a buffer
 */
export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import archiver from 'archiver';

export async function GET(request: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const taskId = params.taskId;

    // Get task details
    const { data: task, error: taskError } = await supabaseServer
      .from('report_tasks')
      .select('id, pdf_path, school_codigo_ce, grado, status')
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Check if task is complete and has PDF
    if (task.status !== 'complete' || !task.pdf_path) {
      return NextResponse.json(
        { error: 'Task not complete or PDF not available' },
        { status: 400 }
      );
    }

    // Derive both tallas and etiquetas paths
    const tallasPath = task.pdf_path;
    const etiquetasPath = task.pdf_path.replace('-tallas.pdf', '-etiquetas.pdf');

    // Download both PDFs from Supabase Storage
    const [tallasResult, etiquetasResult] = await Promise.allSettled([
      supabaseServer.storage.from('reports').download(tallasPath),
      supabaseServer.storage.from('reports').download(etiquetasPath),
    ]);

    // Prepare buffers for any PDFs that exist
    const entries: { name: string; buffer: Buffer }[] = [];

    if (tallasResult.status === 'fulfilled' && tallasResult.value.data) {
      const buffer = Buffer.from(await tallasResult.value.data.arrayBuffer());
      entries.push({
        name: `${task.school_codigo_ce}-${task.grado}-tallas.pdf`,
        buffer,
      });
    }

    if (etiquetasResult.status === 'fulfilled' && etiquetasResult.value.data) {
      const buffer = Buffer.from(await etiquetasResult.value.data.arrayBuffer());
      entries.push({
        name: `${task.school_codigo_ce}-${task.grado}-etiquetas.pdf`,
        buffer,
      });
    }

    // If neither file could be downloaded, surface a clear 404
    if (entries.length === 0) {
      return NextResponse.json({ error: 'No PDFs found for this task' }, { status: 404 });
    }

    // Create ZIP archive and collect it into a single Buffer
    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];

      archive.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      archive.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      archive.on('error', err => {
        reject(err);
      });

      // Append all available PDFs to the archive
      for (const entry of entries) {
        archive.append(entry.buffer, { name: entry.name });
      }

      // Finalize the archive (triggers 'end' when done)
      void archive.finalize();
    });

    // Return ZIP file (convert Buffer to ArrayBuffer for NextResponse)
    const zipArrayBuffer: ArrayBuffer = zipBuffer.buffer.slice(
      zipBuffer.byteOffset,
      zipBuffer.byteOffset + zipBuffer.byteLength
    ) as ArrayBuffer;

    return new NextResponse(zipArrayBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${task.school_codigo_ce}-${task.grado}.zip"`,
      },
    });
  } catch (error) {
    console.error('Error downloading task PDFs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

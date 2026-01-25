import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const jobId = params.jobId;
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    // Get job details
    const { data: job, error: jobError } = await supabaseServer
      .from('report_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status !== 'complete') {
      return NextResponse.json({ error: 'Job not yet complete' }, { status: 400 });
    }

    // Case 1: legacy single ZIP
    if (job.zip_path && job.zip_path.endsWith('.zip')) {
      const { data: signedUrlData, error: urlError } = await supabaseServer
        .storage
        .from('reports')
        .createSignedUrl(job.zip_path, 3600); // 1 hour expiry

      if (urlError || !signedUrlData) {
        console.error('Error generating signed URL:', urlError);
        return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 });
      }

      return NextResponse.json({
        downloadUrl: signedUrlData.signedUrl,
        expiresIn: 3600,
      });
    }

    // Case 2: multi-part ZIPs (+ optional manifest)
    let manifestUrl: string | null = null;
    if (job.zip_path && job.zip_path.endsWith('.manifest.json')) {
      const { data: signedManifest, error: manifestErr } = await supabaseServer
        .storage
        .from('reports')
        .createSignedUrl(job.zip_path, 3600);
      if (manifestErr || !signedManifest) {
        console.error('Error generating signed manifest URL:', manifestErr);
      } else {
        manifestUrl = signedManifest.signedUrl;
      }
    }

    const { count: totalParts, error: countErr } = await supabaseServer
      .from('report_zip_parts')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId);

    if (countErr) {
      console.error('Error counting zip parts:', countErr);
      return NextResponse.json({ error: 'Failed to read ZIP parts' }, { status: 500 });
    }

    const { data: parts, error: partsErr } = await supabaseServer
      .from('report_zip_parts')
      .select('part_no, status, zip_path, pdf_count')
      .eq('job_id', jobId)
      .order('part_no', { ascending: true })
      .range(offset, offset + limit - 1);

    if (partsErr) {
      console.error('Error fetching zip parts:', partsErr);
      return NextResponse.json({ error: 'Failed to read ZIP parts' }, { status: 500 });
    }

    const downloadable = (parts ?? []).filter(p => p.status === 'complete' && p.zip_path);
    const signedParts = await Promise.all(
      downloadable.map(async p => {
        const { data: signed, error: err } = await supabaseServer
          .storage
          .from('reports')
          .createSignedUrl(p.zip_path as string, 3600);
        if (err || !signed) return null;
        return {
          partNo: p.part_no as number,
          pdfCount: (p.pdf_count as number) ?? 0,
          downloadUrl: signed.signedUrl,
        };
      })
    );

    const partsWithUrls = signedParts.filter(Boolean);
    const nextOffset = offset + limit < (totalParts ?? 0) ? offset + limit : null;

    if ((totalParts ?? 0) === 0 && !manifestUrl) {
      return NextResponse.json({ error: 'No ZIP parts available yet' }, { status: 404 });
    }

    return NextResponse.json({
      manifestUrl,
      totalParts: totalParts ?? 0,
      offset,
      limit,
      nextOffset,
      parts: partsWithUrls,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

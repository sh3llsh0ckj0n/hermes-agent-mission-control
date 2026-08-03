import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { hasValidInternalSecret } from '@/lib/security';

function gardenBlobUrl(): string | null {
  return process.env.GARDEN_BLOB_URL?.trim() || null;
}

export async function GET() {
  const blobUrl = gardenBlobUrl();
  if (!blobUrl) {
    return NextResponse.json({ error: 'Garden integration is not configured' }, { status: 503 });
  }

  try {
    const res = await fetch(blobUrl, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`jsonblob GET failed: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error('Garden GET error:', e);
    return NextResponse.json({ error: 'Failed to fetch garden' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const hasSession = process.env.NEXTAUTH_SECRET
    ? Boolean(await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null))
    : false;
  if (!hasValidInternalSecret(req.headers) && !hasSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const blobUrl = gardenBlobUrl();
  if (!blobUrl) {
    return NextResponse.json({ error: 'Garden integration is not configured' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const res = await fetch(blobUrl, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`jsonblob PUT failed: ${res.status}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Garden PUT error:', e);
    return NextResponse.json({ error: 'Failed to update garden' }, { status: 500 });
  }
}

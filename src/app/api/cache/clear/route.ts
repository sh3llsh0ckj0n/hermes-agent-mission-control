import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { hasValidInternalSecret } from '@/lib/security';

const prisma = new PrismaClient();
const CACHE_KEYS = ['notion_clients_monthly', 'mcf_monthly', 'ltv_monthly'];

export async function POST(req: Request) {
  if (!hasValidInternalSecret(req.headers)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const results = await Promise.all(
    CACHE_KEYS.map(key => prisma.dataStore.delete({ where: { key } }).then(() => ({ key, cleared: true })).catch(() => ({ key, cleared: false })))
  );
  return NextResponse.json({ results });
}

// GET is retained for existing internal tooling, but secrets are accepted only
// through headers so they are not exposed in URLs or request logs.
export async function GET(req: Request) {
  if (!hasValidInternalSecret(req.headers)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const results = await Promise.all(
    CACHE_KEYS.map(key => prisma.dataStore.delete({ where: { key } }).then(() => ({ key, cleared: true })).catch(() => ({ key, cleared: false })))
  );
  return NextResponse.json({ results });
}

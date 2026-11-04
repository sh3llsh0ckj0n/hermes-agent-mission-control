import { withHermesServiceUnavailable } from "@/lib/hermes-service";
import { prisma } from "@/lib/prisma";
import { handleTicketSubmit, type TicketSubmitDependencies } from "@/lib/ticket-submit";

const select = { id: true, kind: true, status: true, title: true, createdAt: true } as const;

const prismaDependencies: TicketSubmitDependencies = {
  findByIdempotencyKey: (idempotencyKey) =>
    prisma.agentRequest.findUnique({ where: { idempotencyKey }, select }),
  recentSubmissions: async (submitter, since) => {
    const where = { submitter, createdAt: { gte: since } };
    const [count, oldest] = await Promise.all([
      prisma.agentRequest.count({ where }),
      prisma.agentRequest.findFirst({
        where,
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);
    return { count, oldest: oldest?.createdAt ?? null };
  },
  create: (data) => prisma.agentRequest.create({ data, select }),
};

// POST { title, body?, assignee?, idempotencyKey } with
// Authorization: Bearer <TICKET_SUBMIT_TOKEN>. Always queues an
// approval-gated kanban.create on the primary board.
export async function POST(req: Request) {
  return withHermesServiceUnavailable(() => handleTicketSubmit(req, prismaDependencies));
}

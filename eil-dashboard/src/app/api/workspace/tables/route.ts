import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { PaperTableError, createPaperTable, listPaperTables } from "@/lib/cloudsql/paper-table-repository";
import { ColumnsSchema, TableNameSchema } from "@/lib/paper-table";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

/*
 * A repository's paper tables (docs/42): GET lists them, POST makes one.
 * Making a table reads nothing; its cells are read by .../[id]/fill.
 */

const CreateSchema = z.object({
  projectId: z.string().uuid(),
  name: TableNameSchema,
  columns: ColumnsSchema.default([]),
});

function unavailable() {
  return NextResponse.json({ error: "Tables need the Cloud SQL database." }, { status: 501 });
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Sign in to see your tables." }, { status: 401 });
  if (getDatabaseProvider() !== "cloud-sql") return unavailable();
  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
  if (!z.string().uuid().safeParse(projectId).success) return NextResponse.json({ error: "Choose a repository." }, { status: 400 });
  const tables = await listPaperTables(user.id, projectId);
  return NextResponse.json({ tables }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Sign in to make a table." }, { status: 401 });
  if (getDatabaseProvider() !== "cloud-sql") return unavailable();
  const parsed = CreateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Give the table a name of up to 120 characters." }, { status: 400 });
  try {
    const table = await createPaperTable(user.id, parsed.data.projectId, parsed.data.name, parsed.data.columns);
    return NextResponse.json({ table }, { status: 201 });
  } catch (error) {
    if (error instanceof PaperTableError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

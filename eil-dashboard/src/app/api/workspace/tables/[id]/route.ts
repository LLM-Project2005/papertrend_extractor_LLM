import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { PaperTableError, deletePaperTable, getPaperTable, updatePaperTable } from "@/lib/cloudsql/paper-table-repository";
import { ColumnsSchema, LeaveOutSchema, PutBackSchema, TableNameSchema } from "@/lib/paper-table";
import { tablePapers } from "@/lib/paper-table-server";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";
export const maxDuration = 60;

/*
 * One paper table (docs/42): GET opens it with its rows (the repository's
 * papers now) and the papers it leaves out; PATCH renames it, changes its
 * columns, or leaves papers out and puts them back; DELETE removes it.
 */

const IdSchema = z.string().uuid();
const UpdateSchema = z
  .object({ name: TableNameSchema.optional(), columns: ColumnsSchema.optional(), leaveOut: LeaveOutSchema.optional(), putBack: PutBackSchema.optional() })
  .refine((change) => Object.values(change).some((value) => value !== undefined), "Nothing to change.");

type Params = { params: Promise<{ id: string }> };

type Guarded = { error: Response } | { user: { id: string }; id: string };

async function guard(request: Request, params: Params["params"]): Promise<Guarded> {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return { error: NextResponse.json({ error: "Sign in to use tables." }, { status: 401 }) };
  if (getDatabaseProvider() !== "cloud-sql") return { error: NextResponse.json({ error: "Tables need the Cloud SQL database." }, { status: 501 }) };
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return { error: NextResponse.json({ error: "That table was not found." }, { status: 404 }) };
  return { user, id };
}

function failure(error: unknown): Response {
  if (error instanceof PaperTableError) return NextResponse.json({ error: error.message }, { status: error.status });
  throw error;
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const checked = await guard(request, params);
  if ("error" in checked) return checked.error;
  try {
    const table = await getPaperTable(checked.user.id, checked.id);
    const { rows, more, leftOutRows } = await tablePapers(checked.user.id, table.projectId, table.leftOut);
    return NextResponse.json({ table, rows, more, leftOutRows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const checked = await guard(request, params);
  if ("error" in checked) return checked.error;
  const parsed = UpdateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "A name of up to 120 characters, at most 80 columns, and a reason of up to 200 characters." }, { status: 400 });
  }
  try {
    return NextResponse.json({ table: await updatePaperTable(checked.user.id, checked.id, parsed.data) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  const checked = await guard(request, params);
  if ("error" in checked) return checked.error;
  try {
    await deletePaperTable(checked.user.id, checked.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

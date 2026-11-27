import { forwardAdmin } from "../../../../lib/admin-proxy";

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  return forwardAdmin(request, path.join("/"));
}

export const GET = handle;
export const POST = handle;

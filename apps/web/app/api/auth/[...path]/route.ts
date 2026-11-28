import { forwardAuth } from "../../../../lib/auth-proxy";

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  return forwardAuth(request, path.join("/"));
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { HttpAdapterHost } from "@nestjs/core";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<{ id: string }>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const code =
      status === 404
        ? "NOT_FOUND"
        : status === 503
          ? "SERVICE_UNAVAILABLE"
          : status >= 500
          ? "INTERNAL_ERROR"
          : "REQUEST_FAILED";
    this.adapterHost.httpAdapter.reply(
      context.getResponse(),
      { error: { code, requestId: request.id } },
      status,
    );
  }
}

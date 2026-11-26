import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("Freight API")
    .setDescription("Versioned API of the equipment management platform")
    .setVersion("1.0.0")
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function registerDevelopmentDocs(app: INestApplication): void {
  SwaggerModule.setup("docs", app, createOpenApiDocument(app), {
    jsonDocumentUrl: "/docs/openapi.json",
    yamlDocumentUrl: "/docs/openapi.yaml",
    swaggerOptions: { persistAuthorization: false },
  });
}

import {
  adminLoginInput,
  adminSession,
  authBodies,
  deactivateAccountInput,
  emailChangeInput,
  emailChangeResponse,
  emailChangeTokenInput,
  profileSettingsInput,
  publicActiveSessions,
  publicCabinet,
  publicProfile,
  publicRole,
  publicSession,
  publicTelegramSettings,
  publicUsernameSettings,
  registrationEmailAddress,
  registrationEmailComplete,
  registrationEmailRead,
  registrationEmailStart,
  sessionAction,
  telegramBrowserCommandInput,
  usernameChangeInput,
  usernameInput,
  usernameRequest,
} from "@freight/auth/contracts";
import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ResponseObject,
  SchemaObject,
} from "@nestjs/swagger";
import { z } from "zod";
import { openApiSchema } from "./zod-schema.js";

const success = z.object({ success: z.literal(true) });
const authError = z.object({
  code: z.string(),
  nextChangeAt: z.iso.datetime().optional(),
});
const publicSecurity: NonNullable<OperationObject["security"]> = [
  { publicSession: [] },
  { publicSecureSession: [] },
];
const adminSecurity: NonNullable<OperationObject["security"]> = [
  { adminSession: [] },
  { adminSecureSession: [] },
];
const binary: SchemaObject = { type: "string", format: "binary" };

function json(schema: z.ZodType, description = "Success"): ResponseObject {
  return {
    description,
    content: { "application/json": { schema: openApiSchema(schema) } },
  };
}

function errors(statuses: number[]): OperationObject["responses"] {
  const result: OperationObject["responses"] = {
    default: {
      description:
        "Other transport or validation failure; never exposes credential material.",
    },
  };
  for (const status of statuses) {
    result[status] = json(authError, "Request rejected");
    if (status === 429) {
      result[status] = {
        ...json(authError, "Rate limited"),
        headers: {
          "Retry-After": {
            description: "Seconds until retry, when returned by the handler",
            schema: { type: "integer", minimum: 1 },
          },
        },
      };
    }
  }
  return result;
}

interface Options {
  body?: z.ZodType;
  output?: z.ZodType;
  access?: "public" | "admin";
  statuses?: number[];
  description?: string;
  browser?: boolean;
  parameters?: ParameterObject[];
}

function operation(
  operationId: string,
  summary: string,
  options: Options = {},
): OperationObject {
  return {
    operationId,
    summary,
    tags: [options.browser ? "AuthBrowser" : "Auth"],
    ...(options.description ? { description: options.description } : {}),
    ...(options.access
      ? {
          security: options.access === "admin" ? adminSecurity : publicSecurity,
        }
      : {}),
    ...(options.parameters ? { parameters: options.parameters } : {}),
    ...(options.body
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: openApiSchema(options.body) },
            },
          },
        }
      : {}),
    responses: {
      200: json(options.output ?? success),
      ...errors(options.statuses ?? [400, 401, 403, 429, 503]),
    },
  };
}

function redirect(
  operationId: string,
  summary: string,
  status: number,
  parameters: ParameterObject[],
): OperationObject {
  return {
    operationId,
    summary,
    tags: ["AuthBrowser"],
    parameters,
    responses: {
      [status]: {
        description: "Browser navigation to the validated Web callback",
        headers: { Location: { schema: { type: "string", format: "uri" } } },
      },
      ...errors([400, 403, 404, 429, 503]),
    },
  };
}

function parameter(
  name: string,
  location: "query" | "path",
  required: boolean,
): ParameterObject {
  return { name, in: location, required, schema: { type: "string" } };
}

export function addAuthPaths(document: OpenAPIObject): void {
  document.components ??= {};
  document.components.securitySchemes = {
    ...document.components.securitySchemes,
    publicSession: {
      type: "apiKey",
      in: "cookie",
      name: "better-auth.session_token",
    },
    publicSecureSession: {
      type: "apiKey",
      in: "cookie",
      name: "__Secure-better-auth.session_token",
    },
    adminSession: {
      type: "apiKey",
      in: "cookie",
      name: "movaro-admin.session_token",
    },
    adminSecureSession: {
      type: "apiKey",
      in: "cookie",
      name: "__Secure-movaro-admin.session_token",
    },
  };
  document.tags ??= [];
  document.tags.push(
    {
      name: "Auth",
      description:
        "RD-04 preview routes; AUTH_ENABLED required. POST requires configured Web or Admin Origin; authenticated calls use the corresponding cookie.",
    },
    {
      name: "AuthBrowser",
      description:
        "Binary transfers, browser redirects and browser-bound Telegram commands. Use the existing Web bridge; these operations are documented but excluded from the generated JSON client.",
    },
  );
  const prefix = "/api/v1/auth";
  const add = (
    path: string,
    method: "get" | "post" | "delete",
    value: OperationObject,
  ) => {
    const full = prefix + path;
    const item = document.paths[full] ?? {};
    if (item[method]) throw new Error("Duplicate auth OpenAPI operation");
    item[method] = value;
    document.paths[full] = item;
  };
  add(
    "/sign-in/email",
    "post",
    operation("signInEmail", "Sign in with email", {
      body: authBodies["/sign-in/email"],
      statuses: [400, 401, 403, 429, 500],
    }),
  );
  add(
    "/sign-out",
    "post",
    operation("signOut", "Sign out", {
      body: authBodies["/sign-out"],
    }),
  );
  add(
    "/get-session",
    "get",
    operation("getAuthSession", "Read public session", {
      output: publicSession.nullable(),
      statuses: [400, 403, 500],
      description:
        "Returns null without a session; never returns the session token.",
    }),
  );
  add(
    "/change-password",
    "post",
    operation("changePassword", "Change password", {
      body: authBodies["/change-password"],
      access: "public",
      description:
        "Verified email account required; other sessions are revoked.",
      statuses: [400, 401, 403, 429, 500],
    }),
  );
  add(
    "/request-password-reset",
    "post",
    operation("requestPasswordReset", "Send password reset link", {
      body: authBodies["/request-password-reset"],
      statuses: [400, 403, 429, 500, 503],
    }),
  );
  add(
    "/reset-password",
    "post",
    operation("resetPassword", "Reset password", {
      body: authBodies["/reset-password"],
      statuses: [400, 403, 429, 500],
    }),
  );
  add(
    "/reset-password/{token}",
    "get",
    redirect("followPasswordReset", "Follow password reset link", 302, [
      parameter("token", "path", true),
      parameter("callbackURL", "query", true),
    ]),
  );
  add(
    "/registration/email/start",
    "post",
    operation("startEmailRegistration", "Send registration link", {
      body: registrationEmailStart,
      statuses: [400, 403, 429, 503],
      description:
        "No account is created until mailbox ownership and registration are complete.",
    }),
  );
  add(
    "/registration/email/read",
    "post",
    operation("readEmailRegistration", "Read verified registration email", {
      body: registrationEmailRead,
      output: registrationEmailAddress,
      statuses: [400, 403, 409, 429, 503],
    }),
  );
  add(
    "/registration/email/complete",
    "post",
    operation("completeEmailRegistration", "Complete email registration", {
      body: registrationEmailComplete,
      statuses: [400, 403, 409, 429, 503],
      description:
        "Consumes proof atomically. No automatic sign-in; companyName required only for COMPANY_OWNER; birthDate cannot be in the future UTC.",
    }),
  );
  add(
    "/profile",
    "get",
    operation("getAuthProfile", "Read public profile", {
      output: publicProfile,
      access: "public",
      statuses: [400, 401, 403, 500],
      description: "Complete active public profile required.",
    }),
  );
  add(
    "/profile/settings",
    "post",
    operation("updateAuthProfile", "Update personal details", {
      body: profileSettingsInput,
      output: publicProfile,
      access: "public",
      statuses: [400, 401, 403, 500],
    }),
  );
  const photo = operation("getProfilePhoto", "Read private profile photo", {
    access: "public",
    browser: true,
    statuses: [400, 401, 403, 404, 409, 429, 503],
    description: "Active account with verified real email required.",
  });
  photo.responses[200] = {
    description: "Private normalized JPEG image",
    content: { "image/jpeg": { schema: binary } },
  };
  add("/profile/photo", "get", photo);
  const upload = operation(
    "uploadProfilePhoto",
    "Upload or replace profile photo",
    {
      access: "public",
      browser: true,
      statuses: [400, 401, 403, 409, 413, 415, 429, 503],
      description:
        "Raw JPEG or PNG bytes, up to 2 MiB, not multipart. Verified real email required.",
    },
  );
  upload.requestBody = {
    required: true,
    content: {
      "image/jpeg": { schema: binary },
      "image/png": { schema: binary },
    },
  };
  add("/profile/photo", "post", upload);
  add(
    "/profile/photo",
    "delete",
    operation("deleteProfilePhoto", "Delete profile photo", {
      access: "public",
      browser: true,
      statuses: [400, 401, 403, 429, 503],
    }),
  );
  add(
    "/username",
    "post",
    operation("checkOrSuggestUsername", "Check or suggest username", {
      body: usernameRequest,
      output: z.union([
        z.object({ available: z.boolean() }),
        z.object({ username: usernameInput }),
      ]),
      statuses: [400, 403, 429, 503],
    }),
  );
  add(
    "/username/settings",
    "get",
    operation("getUsernameSettings", "Read username settings", {
      output: publicUsernameSettings,
      access: "public",
      statuses: [400, 401, 403, 500],
    }),
  );
  add(
    "/username/settings",
    "post",
    operation("changeUsername", "Change username", {
      body: usernameChangeInput,
      output: publicUsernameSettings,
      access: "public",
      statuses: [400, 401, 403, 409, 500],
      description: "A changed username has a seven-day cooldown.",
    }),
  );
  add(
    "/sessions",
    "get",
    operation("getActiveSessions", "List active sessions", {
      output: publicActiveSessions,
      access: "public",
    }),
  );
  add(
    "/sessions",
    "post",
    operation("revokeActiveSessions", "Revoke session or other sessions", {
      body: sessionAction,
      access: "public",
      statuses: [400, 401, 403, 404, 409, 500, 503],
    }),
  );
  add(
    "/email/change",
    "post",
    operation("startEmailChange", "Start email change", {
      body: emailChangeInput,
      output: emailChangeResponse,
      access: "public",
      description: "Verified email and fresh session required.",
    }),
  );
  add(
    "/email/change/confirm",
    "post",
    operation("confirmEmailChange", "Confirm email change stage", {
      body: emailChangeTokenInput,
      output: emailChangeResponse,
      statuses: [400, 403, 429, 503],
    }),
  );
  add(
    "/account/deactivate",
    "post",
    operation("deactivateAccount", "Deactivate account", {
      body: deactivateAccountInput,
      access: "public",
      statuses: [400, 401, 403, 503],
    }),
  );
  add(
    "/telegram/status",
    "get",
    operation("getTelegramStatus", "Read Telegram availability", {
      output: z.object({ enabled: z.boolean() }),
      statuses: [400, 403],
    }),
  );
  const draft = z.strictObject({
    id: z.uuid(),
    channel: z.enum(["web", "bot"]),
    locale: z.enum(["ru", "en"]),
    revision: z.number().int().nonnegative(),
    expiresAt: z.iso.datetime(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    role: publicRole.nullable(),
    birthDate: z.string().nullable(),
    companyName: z.string().nullable(),
    username: z.string().nullable(),
  }).nullable();
  add(
    "/telegram-bot/browser",
    "post",
    operation("telegramBrowserCommand", "Telegram bot browser command", {
      body: telegramBrowserCommandInput,
      browser: true,
      output: z.union([
        z.strictObject({
          requestId: z.uuid(),
          url: z.string().max(512),
          displayCode: z.string().regex(/^[0-9]{6}$/),
          expiresAt: z.iso.datetime(),
        }),
        z.strictObject({
          status: z.enum([
            "pending",
            "claimed",
            "approved",
            "rejected",
            "cancelled",
            "consumed",
            "expired",
          ]).nullable(),
        }),
        z.strictObject({ success: z.boolean() }),
        z.strictObject({ outcome: z.literal("logged-in") }),
        z.strictObject({ outcome: z.literal("linked") }),
        z.strictObject({
          outcome: z.literal("registration"),
          draftId: z.uuid(),
        }),
        z.strictObject({ draft }),
        z.strictObject({ draft, completed: z.boolean() }),
        z.strictObject({ username: usernameInput.nullable() }),
        z.strictObject({
          outcome: z.enum([
            "created",
            "invalid",
            "denied",
            "username-taken",
            "identity-taken",
          ]),
        }),
        z.strictObject({ completed: z.boolean() }),
      ]),
      statuses: [400, 401, 403, 404, 405, 409, 429, 503],
      description:
        "Start issues a browser-bound request. Subsequent commands require the matching HttpOnly browser cookie; confirm additionally requires the one-time return proof. Link requires a fresh credential session. Registration completion does not issue a session.",
    }),
  );
  add(
    "/telegram/settings",
    "get",
    operation("getTelegramSettings", "Read Telegram binding settings", {
      output: publicTelegramSettings,
      access: "public",
      statuses: [400, 401, 403, 503],
    }),
  );
  for (const [path, name] of [
    ["company-owner", "CompanyOwner"],
    ["dispatcher", "Dispatcher"],
    ["driver", "Driver"],
  ]) {
    add(
      `/cabinet/${path}`,
      "get",
      operation(`get${name}Cabinet`, `Read ${path} cabinet access`, {
        output: publicCabinet,
        access: "public",
        statuses: [400, 401, 403, 503],
      }),
    );
  }
  add(
    "/admin/sign-in/email",
    "post",
    operation("signInAdmin", "Sign in as platform administrator", {
      body: adminLoginInput,
      statuses: [400, 401, 403, 404, 429, 503],
    }),
  );
  add(
    "/admin/sign-out",
    "post",
    operation("signOutAdmin", "Sign out administrator", {
      body: z.strictObject({}),
      access: "admin",
      statuses: [400, 401, 403, 404, 429, 503],
    }),
  );
  add(
    "/admin/get-session",
    "get",
    operation("getAdminSession", "Read administrator session", {
      output: adminSession.nullable(),
      statuses: [400, 401, 403, 404, 503],
    }),
  );
}

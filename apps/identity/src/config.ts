import { z } from "zod";

const postgresqlUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
    {
      message: "must use the postgres or postgresql protocol"
    }
  );

const publicOriginSchema = z.string().url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password) {
    context.addIssue({
      code: "custom",
      message: "must be an exact origin without credentials, path, query, or fragment"
    });
  }
});

const identityEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  DATABASE_URL: postgresqlUrlSchema,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  IDENTITY_PUBLIC_ORIGIN: publicOriginSchema,
  WEBAUTHN_RP_ID: z.string().min(1).max(253),
  WEBAUTHN_RP_NAME: z.string().min(1).max(100).default("Shape of You"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  SHUTDOWN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(10_000)
});

/** Validated runtime configuration owned by the Identity deployable. */
export type IdentityConfig = z.infer<typeof identityEnvironmentSchema>;

/**
 * Validates and normalizes Identity environment values.
 *
 * @param environment - Environment values to validate.
 * @returns Parsed Identity configuration with defaults applied.
 * @throws Error when a supplied value is invalid.
 */
export function loadIdentityConfig(
  environment: NodeJS.ProcessEnv = process.env
): IdentityConfig {
  const parsed = identityEnvironmentSchema.safeParse(environment);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid Identity runtime configuration: ${details}`);
  }

  const origin = new URL(parsed.data.IDENTITY_PUBLIC_ORIGIN);
  if (
    parsed.data.NODE_ENV === "production" &&
    origin.protocol !== "https:"
  ) {
    throw new Error(
      "Invalid Identity runtime configuration: IDENTITY_PUBLIC_ORIGIN: must use https in production"
    );
  }
  if (origin.hostname !== parsed.data.WEBAUTHN_RP_ID) {
    throw new Error(
      "Invalid Identity runtime configuration: WEBAUTHN_RP_ID: must equal the public origin hostname"
    );
  }

  return parsed.data;
}

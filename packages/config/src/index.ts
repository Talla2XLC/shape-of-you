import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) =>
        value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must use the PostgreSQL protocol"
    ),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  PERSON_CONTEXT_MODE: z.enum(["synthetic", "authenticated"]),
  SYNTHETIC_PERSON_ID: z.string().uuid().optional(),
  IDENTITY_OAUTH_ISSUER: z.string().url().optional(),
  IDENTITY_OAUTH_JWKS_URI: z.string().url().optional(),
  IDENTITY_OAUTH_RESOURCE: z.string().url().optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(10_000)
}).superRefine((environment, context) => {
  if (
    environment.PERSON_CONTEXT_MODE === "synthetic" &&
    !environment.SYNTHETIC_PERSON_ID
  ) {
    context.addIssue({
      code: "custom",
      path: ["SYNTHETIC_PERSON_ID"],
      message: "SYNTHETIC_PERSON_ID is required in synthetic mode"
    });
  }
  const oauthSettings = [
    environment.IDENTITY_OAUTH_ISSUER,
    environment.IDENTITY_OAUTH_JWKS_URI,
    environment.IDENTITY_OAUTH_RESOURCE
  ];
  if (oauthSettings.some(Boolean) && !oauthSettings.every(Boolean)) {
    context.addIssue({
      code: "custom",
      path: ["IDENTITY_OAUTH_ISSUER"],
      message: "Identity OAuth issuer, JWKS URI, and resource must be supplied together"
    });
  }
  if (environment.PERSON_CONTEXT_MODE === "authenticated" && !oauthSettings.every(Boolean)) {
    context.addIssue({
      code: "custom",
      path: ["IDENTITY_OAUTH_ISSUER"],
      message: "Identity OAuth settings are required in authenticated mode"
    });
  }
});

/** Validated runtime configuration shared by deployable applications. */
export type AppConfig = z.infer<typeof environmentSchema>;

/**
 * Validates and normalizes process environment values into application config.
 *
 * @param environment - Environment values to validate.
 * @returns Parsed configuration with defaults applied.
 * @throws Error when a required value is missing or invalid.
 */
export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): AppConfig {
  const parsed = environmentSchema.safeParse(environment);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid runtime configuration: ${details}`);
  }

  return parsed.data;
}

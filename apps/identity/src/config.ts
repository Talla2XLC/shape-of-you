import { z } from "zod";

const identityEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
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

  return parsed.data;
}

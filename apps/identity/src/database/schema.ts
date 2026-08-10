import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea"
});

export const identityAccountStatus = pgEnum("identity_account_status", [
  "active",
  "disabled"
]);
export const webauthnCredentialDeviceType = pgEnum(
  "webauthn_credential_device_type",
  ["single_device", "multi_device"]
);
export const webauthnTransport = pgEnum("webauthn_transport", [
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart_card",
  "usb"
]);
export const webauthnChallengePurpose = pgEnum(
  "webauthn_challenge_purpose",
  ["registration", "authentication", "recovery_registration"]
);
export const webauthnUserVerification = pgEnum(
  "webauthn_user_verification",
  ["required", "preferred", "discouraged"]
);
export const oauthClientStatus = pgEnum("oauth_client_status", [
  "active",
  "disabled"
]);
export const oauthInteractionPrompt = pgEnum("oauth_interaction_prompt", [
  "login",
  "consent"
]);
export const oauthInteractionStatus = pgEnum("oauth_interaction_status", [
  "pending",
  "completed",
  "abandoned"
]);
export const oauthCodeChallengeMethod = pgEnum(
  "oauth_code_challenge_method",
  ["S256"]
);
export const oauthSigningKeyAlgorithm = pgEnum("oauth_signing_key_algorithm", [
  "ES256"
]);
export const oauthSigningKeyStatus = pgEnum("oauth_signing_key_status", [
  "staged",
  "active",
  "verifying",
  "retired",
  "revoked"
]);
export const identitySecurityEventType = pgEnum(
  "identity_security_event_type",
  [
    "account_status_changed",
    "initial_passkey_enrollment_created",
    "passkey_registered",
    "passkey_authentication",
    "passkey_revoked",
    "totp_factor_enrolled",
    "totp_recovery_started",
    "recovery_codes_issued",
    "recovery_code_used",
    "passkey_recovery_completed",
    "oauth_authorization",
    "oauth_code_exchange",
    "oauth_refresh_rotation",
    "oauth_refresh_reuse_detected",
    "oauth_session_revoked",
    "signing_key_lifecycle_changed"
  ]
);
export const identitySecurityEventOutcome = pgEnum(
  "identity_security_event_outcome",
  ["succeeded", "denied", "failed"]
);
export const identitySecurityActorKind = pgEnum(
  "identity_security_actor_kind",
  ["anonymous", "account", "oauth_client", "system"]
);

export const identityAccounts = pgTable(
  "identity_accounts",
  {
    id: uuid("id").primaryKey(),
    subject: uuid("subject").notNull(),
    webauthnUserHandle: bytea("webauthn_user_handle").notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    loginHandle: varchar("login_handle", { length: 64 }),
    status: identityAccountStatus("status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    unique("identity_accounts_subject_uq").on(table.subject),
    unique("identity_accounts_webauthn_user_handle_uq").on(
      table.webauthnUserHandle
    ),
    unique("identity_accounts_login_handle_uq").on(table.loginHandle),
    check("identity_accounts_subject_separate", sql`${table.subject} <> ${table.id}`),
    check(
      "identity_accounts_user_handle_length",
      sql`octet_length(${table.webauthnUserHandle}) = 32`
    ),
    check(
      "identity_accounts_display_name_nonempty",
      sql`length(btrim(${table.displayName})) > 0`
    ),
    check(
      "identity_accounts_login_handle_format",
      sql`${table.loginHandle} IS NULL OR ${table.loginHandle} ~ '^[a-z0-9][a-z0-9._-]{2,63}$'`
    ),
    check(
      "identity_accounts_disabled_state",
      sql`(${table.status} = 'active' AND ${table.disabledAt} IS NULL) OR (${table.status} = 'disabled' AND ${table.disabledAt} IS NOT NULL)`
    )
  ]
);

export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => identityAccounts.id),
    credentialId: bytea("credential_id").notNull(),
    publicKey: bytea("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).default(0).notNull(),
    deviceType: webauthnCredentialDeviceType("device_type").notNull(),
    backedUp: boolean("backed_up").default(false).notNull(),
    transports: webauthnTransport("transports")
      .array()
      .default(sql`ARRAY[]::webauthn_transport[]`)
      .notNull(),
    label: varchar("label", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    unique("webauthn_credentials_id_account_uq").on(
      table.id,
      table.accountId
    ),
    unique("webauthn_credentials_credential_id_uq").on(table.credentialId),
    index("webauthn_credentials_account_idx").on(table.accountId),
    uniqueIndex("webauthn_credentials_active_account_label_uq")
      .on(table.accountId, table.label)
      .where(sql`${table.label} IS NOT NULL AND ${table.revokedAt} IS NULL`),
    check(
      "webauthn_credentials_credential_id_length",
      sql`octet_length(${table.credentialId}) BETWEEN 1 AND 1024`
    ),
    check(
      "webauthn_credentials_public_key_length",
      sql`octet_length(${table.publicKey}) BETWEEN 1 AND 4096`
    ),
    check(
      "webauthn_credentials_counter_range",
      sql`${table.counter} BETWEEN 0 AND 4294967295`
    ),
    check(
      "webauthn_credentials_label_nonempty",
      sql`${table.label} IS NULL OR length(btrim(${table.label})) > 0`
    ),
    check(
      "webauthn_credentials_use_after_creation",
      sql`${table.lastUsedAt} IS NULL OR ${table.lastUsedAt} >= ${table.createdAt}`
    ),
    check(
      "webauthn_credentials_revocation_after_creation",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`
    )
  ]
);

export const initialPasskeyEnrollments = pgTable(
  "initial_passkey_enrollments",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    invalidatedAt: timestamp("invalidated_at", {
      withTimezone: true,
      mode: "date"
    })
  },
  (table) => [
    foreignKey({
      name: "initial_passkey_enrollments_account_fk",
      columns: [table.accountId],
      foreignColumns: [identityAccounts.id]
    }),
    unique("initial_passkey_enrollments_id_account_uq").on(
      table.id,
      table.accountId
    ),
    unique("initial_passkey_enrollments_token_hash_uq").on(table.tokenHash),
    index("initial_passkey_enrollments_expiry_idx").on(table.expiresAt),
    uniqueIndex("initial_passkey_enrollments_active_account_uq")
      .on(table.accountId)
      .where(
        sql`${table.consumedAt} IS NULL AND ${table.invalidatedAt} IS NULL`
      ),
    check(
      "initial_passkey_enrollments_hash_length",
      sql`octet_length(${table.tokenHash}) = 32`
    ),
    check(
      "initial_passkey_enrollments_lifetime",
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '15 minutes'`
    ),
    check(
      "initial_passkey_enrollments_terminal_state",
      sql`NOT (${table.consumedAt} IS NOT NULL AND ${table.invalidatedAt} IS NOT NULL)`
    ),
    check(
      "initial_passkey_enrollments_consumption_time",
      sql`${table.consumedAt} IS NULL OR (${table.consumedAt} >= ${table.createdAt} AND ${table.consumedAt} <= ${table.expiresAt})`
    ),
    check(
      "initial_passkey_enrollments_invalidation_time",
      sql`${table.invalidatedAt} IS NULL OR ${table.invalidatedAt} >= ${table.createdAt}`
    )
  ]
);

export const webauthnChallenges = pgTable(
  "webauthn_challenges",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id").references(() => identityAccounts.id),
    initialPasskeyEnrollmentId: uuid("initial_passkey_enrollment_id"),
    purpose: webauthnChallengePurpose("purpose").notNull(),
    challengeHash: bytea("challenge_hash").notNull(),
    expectedRpId: varchar("expected_rp_id", { length: 253 }).notNull(),
    expectedOrigin: text("expected_origin").notNull(),
    userVerification: webauthnUserVerification("user_verification").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    foreignKey({
      name: "webauthn_challenges_initial_enrollment_account_fk",
      columns: [table.initialPasskeyEnrollmentId, table.accountId],
      foreignColumns: [initialPasskeyEnrollments.id, initialPasskeyEnrollments.accountId]
    }),
    unique("webauthn_challenges_hash_uq").on(table.challengeHash),
    index("webauthn_challenges_account_idx").on(table.accountId),
    index("webauthn_challenges_expiry_idx").on(table.expiresAt),
    check(
      "webauthn_challenges_hash_length",
      sql`octet_length(${table.challengeHash}) = 32`
    ),
    check(
      "webauthn_challenges_registration_account",
      sql`${table.purpose} = 'authentication' OR ${table.accountId} IS NOT NULL`
    ),
    check(
      "webauthn_challenges_initial_enrollment_purpose",
      sql`${table.initialPasskeyEnrollmentId} IS NULL OR ${table.purpose} = 'registration'`
    ),
    check(
      "webauthn_challenges_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
    check(
      "webauthn_challenges_max_lifetime",
      sql`${table.expiresAt} <= ${table.createdAt} + interval '5 minutes'`
    ),
    check(
      "webauthn_challenges_consumption_window",
      sql`${table.consumedAt} IS NULL OR (${table.consumedAt} >= ${table.createdAt} AND ${table.consumedAt} <= ${table.expiresAt})`
    )
  ]
);

export const recoveryCodeBatches = pgTable(
  "recovery_code_batches",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => identityAccounts.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    invalidatedAt: timestamp("invalidated_at", {
      withTimezone: true,
      mode: "date"
    })
  },
  (table) => [
    unique("recovery_code_batches_id_account_uq").on(table.id, table.accountId),
    index("recovery_code_batches_account_idx").on(table.accountId),
    uniqueIndex("recovery_code_batches_active_account_uq")
      .on(table.accountId)
      .where(sql`${table.invalidatedAt} IS NULL`),
    check(
      "recovery_code_batches_expiry_after_creation",
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.createdAt}`
    ),
    check(
      "recovery_code_batches_invalidation_after_creation",
      sql`${table.invalidatedAt} IS NULL OR ${table.invalidatedAt} >= ${table.createdAt}`
    )
  ]
);

export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey(),
    batchId: uuid("batch_id").notNull(),
    accountId: uuid("account_id").notNull(),
    codeHash: bytea("code_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    foreignKey({
      name: "recovery_codes_batch_account_fk",
      columns: [table.batchId, table.accountId],
      foreignColumns: [recoveryCodeBatches.id, recoveryCodeBatches.accountId]
    }),
    unique("recovery_codes_id_account_uq").on(table.id, table.accountId),
    unique("recovery_codes_hash_uq").on(table.codeHash),
    index("recovery_codes_batch_idx").on(table.batchId),
    check("recovery_codes_hash_length", sql`octet_length(${table.codeHash}) = 32`),
    check(
      "recovery_codes_use_after_creation",
      sql`${table.usedAt} IS NULL OR ${table.usedAt} >= ${table.createdAt}`
    )
  ]
);

export const passkeyRecoverySessions = pgTable(
  "passkey_recovery_sessions",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id").notNull(),
    recoveryCodeId: uuid("recovery_code_id").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    invalidatedAt: timestamp("invalidated_at", {
      withTimezone: true,
      mode: "date"
    })
  },
  (table) => [
    foreignKey({
      name: "passkey_recovery_sessions_code_account_fk",
      columns: [table.recoveryCodeId, table.accountId],
      foreignColumns: [recoveryCodes.id, recoveryCodes.accountId]
    }),
    unique("passkey_recovery_sessions_code_uq").on(table.recoveryCodeId),
    unique("passkey_recovery_sessions_token_hash_uq").on(table.tokenHash),
    index("passkey_recovery_sessions_account_idx").on(table.accountId),
    index("passkey_recovery_sessions_expiry_idx").on(table.expiresAt),
    check(
      "passkey_recovery_sessions_token_hash_length",
      sql`octet_length(${table.tokenHash}) = 32`
    ),
    check(
      "passkey_recovery_sessions_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
    check(
      "passkey_recovery_sessions_completion_window",
      sql`${table.completedAt} IS NULL OR (${table.completedAt} >= ${table.createdAt} AND ${table.completedAt} <= ${table.expiresAt})`
    ),
    check(
      "passkey_recovery_sessions_invalidation_after_creation",
      sql`${table.invalidatedAt} IS NULL OR ${table.invalidatedAt} >= ${table.createdAt}`
    ),
    check(
      "passkey_recovery_sessions_terminal_state",
      sql`${table.completedAt} IS NULL OR ${table.invalidatedAt} IS NULL`
    )
  ]
);

export const totpCredentials = pgTable(
  "totp_credentials",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => identityAccounts.id),
    secretCiphertext: bytea("secret_ciphertext").notNull(),
    secretNonce: bytea("secret_nonce").notNull(),
    secretTag: bytea("secret_tag").notNull(),
    keyId: varchar("key_id", { length: 64 }).notNull(),
    lastAcceptedStep: bigint("last_accepted_step", { mode: "number" }),
    failedAttempts: integer("failed_attempts").default(0).notNull(),
    attemptWindowStartedAt: timestamp("attempt_window_started_at", {
      withTimezone: true,
      mode: "date"
    }),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    unique("totp_credentials_id_account_uq").on(table.id, table.accountId),
    uniqueIndex("totp_credentials_active_account_uq")
      .on(table.accountId)
      .where(sql`${table.verifiedAt} IS NOT NULL AND ${table.revokedAt} IS NULL`),
    uniqueIndex("totp_credentials_pending_account_uq")
      .on(table.accountId)
      .where(sql`${table.verifiedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    check("totp_credentials_ciphertext_nonempty", sql`octet_length(${table.secretCiphertext}) > 0`),
    check("totp_credentials_nonce_length", sql`octet_length(${table.secretNonce}) = 12`),
    check("totp_credentials_tag_length", sql`octet_length(${table.secretTag}) = 16`),
    check("totp_credentials_key_id_nonempty", sql`length(btrim(${table.keyId})) > 0`),
    check("totp_credentials_failed_attempts_range", sql`${table.failedAttempts} BETWEEN 0 AND 5`),
    check("totp_credentials_verification_time", sql`${table.verifiedAt} IS NULL OR ${table.verifiedAt} >= ${table.createdAt}`),
    check("totp_credentials_revocation_time", sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`)
  ]
);

export const totpRecoverySessions = pgTable(
  "totp_recovery_sessions",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id").notNull(),
    totpCredentialId: uuid("totp_credential_id").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    foreignKey({
      name: "totp_recovery_sessions_credential_account_fk",
      columns: [table.totpCredentialId, table.accountId],
      foreignColumns: [totpCredentials.id, totpCredentials.accountId]
    }),
    unique("totp_recovery_sessions_id_account_uq").on(table.id, table.accountId),
    unique("totp_recovery_sessions_token_hash_uq").on(table.tokenHash),
    index("totp_recovery_sessions_account_idx").on(table.accountId),
    index("totp_recovery_sessions_expiry_idx").on(table.expiresAt),
    check("totp_recovery_sessions_token_hash_length", sql`octet_length(${table.tokenHash}) = 32`),
    check("totp_recovery_sessions_expiry_after_creation", sql`${table.expiresAt} > ${table.createdAt}`),
    check("totp_recovery_sessions_max_lifetime", sql`${table.expiresAt} <= ${table.createdAt} + interval '15 minutes'`),
    check("totp_recovery_sessions_completion_window", sql`${table.completedAt} IS NULL OR (${table.completedAt} >= ${table.createdAt} AND ${table.completedAt} <= ${table.expiresAt})`),
    check("totp_recovery_sessions_invalidation_time", sql`${table.invalidatedAt} IS NULL OR ${table.invalidatedAt} >= ${table.createdAt}`),
    check("totp_recovery_sessions_terminal_state", sql`NOT (${table.completedAt} IS NOT NULL AND ${table.invalidatedAt} IS NOT NULL)`)
  ]
);

export const totpRecoveryChallengeBindings = pgTable(
  "totp_recovery_challenge_bindings",
  {
    challengeId: uuid("challenge_id")
      .primaryKey(),
    recoverySessionId: uuid("recovery_session_id").notNull(),
    accountId: uuid("account_id").notNull()
  },
  (table) => [
    foreignKey({
      name: "totp_recovery_challenge_webauthn_fk",
      columns: [table.challengeId],
      foreignColumns: [webauthnChallenges.id]
    }),
    foreignKey({
      name: "totp_recovery_challenge_session_account_fk",
      columns: [table.recoverySessionId, table.accountId],
      foreignColumns: [totpRecoverySessions.id, totpRecoverySessions.accountId]
    }),
    unique("totp_recovery_challenge_session_uq").on(table.recoverySessionId)
  ]
);

export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: varchar("id", { length: 200 }).primaryKey(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    status: oauthClientStatus("status").default("active").notNull(),
    refreshTokensEnabled: boolean("refresh_tokens_enabled")
      .default(false)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    check("oauth_clients_id_nonempty", sql`length(btrim(${table.id})) > 0`),
    check(
      "oauth_clients_display_name_nonempty",
      sql`length(btrim(${table.displayName})) > 0`
    ),
    check(
      "oauth_clients_disabled_state",
      sql`(${table.status} = 'active' AND ${table.disabledAt} IS NULL) OR (${table.status} = 'disabled' AND ${table.disabledAt} IS NOT NULL)`
    )
  ]
);

export const oauthClientRedirectUris = pgTable(
  "oauth_client_redirect_uris",
  {
    id: uuid("id").primaryKey(),
    clientId: varchar("client_id", { length: 200 })
      .notNull()
      .references(() => oauthClients.id),
    redirectUri: text("redirect_uri").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    unique("oauth_client_redirect_uris_client_uri_uq").on(
      table.clientId,
      table.redirectUri
    ),
    index("oauth_client_redirect_uris_client_idx").on(table.clientId),
    check(
      "oauth_client_redirect_uris_nonempty",
      sql`length(btrim(${table.redirectUri})) > 0`
    ),
    check(
      "oauth_client_redirect_uris_no_fragment",
      sql`position('#' in ${table.redirectUri}) = 0`
    )
  ]
);

export const oauthClientAllowedScopes = pgTable(
  "oauth_client_allowed_scopes",
  {
    clientId: varchar("client_id", { length: 200 })
      .notNull()
      .references(() => oauthClients.id),
    scope: varchar("scope", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "oauth_client_allowed_scopes_pk",
      columns: [table.clientId, table.scope]
    }),
    check(
      "oauth_client_allowed_scopes_format",
      sql`length(btrim(${table.scope})) > 0 AND ${table.scope} !~ '[[:space:]]'`
    )
  ]
);

export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => identityAccounts.id),
    clientId: varchar("client_id", { length: 200 })
      .notNull()
      .references(() => oauthClients.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    unique("oauth_grants_id_account_client_uq").on(
      table.id,
      table.accountId,
      table.clientId
    ),
    unique("oauth_grants_id_client_uq").on(table.id, table.clientId),
    index("oauth_grants_account_idx").on(table.accountId),
    index("oauth_grants_client_idx").on(table.clientId),
    uniqueIndex("oauth_grants_active_account_client_uq")
      .on(table.accountId, table.clientId)
      .where(sql`${table.revokedAt} IS NULL`),
    check(
      "oauth_grants_expiry_after_creation",
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.createdAt}`
    ),
    check(
      "oauth_grants_revocation_after_creation",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`
    )
  ]
);

export const oauthGrantOidcScopes = pgTable(
  "oauth_grant_oidc_scopes",
  {
    grantId: uuid("grant_id").notNull(),
    clientId: varchar("client_id", { length: 200 }).notNull(),
    scope: varchar("scope", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "oauth_grant_oidc_scopes_grant_client_fk",
      columns: [table.grantId, table.clientId],
      foreignColumns: [oauthGrants.id, oauthGrants.clientId]
    }),
    foreignKey({
      name: "oauth_grant_oidc_scopes_client_scope_fk",
      columns: [table.clientId, table.scope],
      foreignColumns: [
        oauthClientAllowedScopes.clientId,
        oauthClientAllowedScopes.scope
      ]
    }),
    primaryKey({
      name: "oauth_grant_oidc_scopes_pk",
      columns: [table.grantId, table.scope]
    })
  ]
);

export const oauthGrantResourceScopes = pgTable(
  "oauth_grant_resource_scopes",
  {
    grantId: uuid("grant_id").notNull(),
    clientId: varchar("client_id", { length: 200 }).notNull(),
    resource: text("resource").notNull(),
    scope: varchar("scope", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "oauth_grant_resource_scopes_grant_client_fk",
      columns: [table.grantId, table.clientId],
      foreignColumns: [oauthGrants.id, oauthGrants.clientId]
    }),
    foreignKey({
      name: "oauth_grant_resource_scopes_client_scope_fk",
      columns: [table.clientId, table.scope],
      foreignColumns: [
        oauthClientAllowedScopes.clientId,
        oauthClientAllowedScopes.scope
      ]
    }),
    primaryKey({
      name: "oauth_grant_resource_scopes_pk",
      columns: [table.grantId, table.resource, table.scope]
    }),
    check(
      "oauth_grant_resource_scopes_resource_nonempty",
      sql`length(btrim(${table.resource})) > 0`
    )
  ]
);

export const oauthSessions = pgTable(
  "oauth_sessions",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => identityAccounts.id),
    webauthnCredentialId: uuid("webauthn_credential_id"),
    credentialHash: bytea("credential_hash").notNull(),
    providerCredentialHash: bytea("provider_credential_hash"),
    csrfTokenHash: bytea("csrf_token_hash").notNull(),
    providerUid: varchar("provider_uid", { length: 200 }).notNull(),
    authenticatedAt: timestamp("authenticated_at", {
      withTimezone: true,
      mode: "date"
    }).notNull(),
    acr: varchar("acr", { length: 200 }).notNull(),
    amr: text("amr").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    lastActivityAt: timestamp("last_activity_at", {
      withTimezone: true,
      mode: "date"
    }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    foreignKey({
      name: "oauth_sessions_webauthn_credential_account_fk",
      columns: [table.webauthnCredentialId, table.accountId],
      foreignColumns: [webauthnCredentials.id, webauthnCredentials.accountId]
    }),
    unique("oauth_sessions_id_account_uq").on(table.id, table.accountId),
    unique("oauth_sessions_credential_hash_uq").on(table.credentialHash),
    unique("oauth_sessions_provider_credential_hash_uq").on(
      table.providerCredentialHash
    ),
    unique("oauth_sessions_provider_uid_uq").on(table.providerUid),
    index("oauth_sessions_account_idx").on(table.accountId),
    index("oauth_sessions_webauthn_credential_idx").on(
      table.webauthnCredentialId
    ),
    index("oauth_sessions_expiry_idx").on(table.expiresAt),
    check(
      "oauth_sessions_credential_hash_length",
      sql`octet_length(${table.credentialHash}) = 32`
    ),
    check(
      "oauth_sessions_provider_credential_hash_length",
      sql`${table.providerCredentialHash} IS NULL OR octet_length(${table.providerCredentialHash}) = 32`
    ),
    check(
      "oauth_sessions_csrf_token_hash_length",
      sql`octet_length(${table.csrfTokenHash}) = 32`
    ),
    check(
      "oauth_sessions_provider_uid_nonempty",
      sql`length(btrim(${table.providerUid})) > 0`
    ),
    check("oauth_sessions_acr_nonempty", sql`length(btrim(${table.acr})) > 0`),
    check(
      "oauth_sessions_amr_nonempty",
      sql`cardinality(${table.amr}) > 0 AND array_position(${table.amr}, NULL) IS NULL`
    ),
    check(
      "oauth_sessions_authentication_time",
      sql`${table.authenticatedAt} <= ${table.createdAt}`
    ),
    check(
      "oauth_sessions_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
    check(
      "oauth_sessions_activity_window",
      sql`${table.lastActivityAt} >= ${table.authenticatedAt} AND ${table.lastActivityAt} < ${table.expiresAt} AND ${table.expiresAt} <= ${table.lastActivityAt} + interval '30 days'`
    ),
    check(
      "oauth_sessions_passkey_binding",
      sql`array_position(${table.amr}, 'passkey') IS NULL OR ${table.webauthnCredentialId} IS NOT NULL`
    ),
    check(
      "oauth_sessions_revocation_after_creation",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`
    )
  ]
);

export const oauthSessionAuthorizations = pgTable(
  "oauth_session_authorizations",
  {
    sessionId: uuid("session_id").notNull(),
    accountId: uuid("account_id").notNull(),
    clientId: varchar("client_id", { length: 200 }).notNull(),
    grantId: uuid("grant_id").notNull(),
    authorizedAt: timestamp("authorized_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    foreignKey({
      name: "oauth_session_authorizations_session_account_fk",
      columns: [table.sessionId, table.accountId],
      foreignColumns: [oauthSessions.id, oauthSessions.accountId]
    }),
    foreignKey({
      name: "oauth_session_authorizations_grant_binding_fk",
      columns: [table.grantId, table.accountId, table.clientId],
      foreignColumns: [
        oauthGrants.id,
        oauthGrants.accountId,
        oauthGrants.clientId
      ]
    }),
    primaryKey({
      name: "oauth_session_authorizations_pk",
      columns: [table.sessionId, table.clientId]
    }),
    check(
      "oauth_session_authorizations_revocation_time",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.authorizedAt}`
    )
  ]
);

export const oauthInteractions = pgTable(
  "oauth_interactions",
  {
    id: uuid("id").primaryKey(),
    credentialHash: bytea("credential_hash").notNull(),
    clientId: varchar("client_id", { length: 200 })
      .notNull()
      .references(() => oauthClients.id),
    accountId: uuid("account_id"),
    sessionId: uuid("session_id"),
    grantId: uuid("grant_id"),
    prompt: oauthInteractionPrompt("prompt").notNull(),
    status: oauthInteractionStatus("status").default("pending").notNull(),
    providerCid: varchar("provider_cid", { length: 200 }).notNull(),
    providerReturnTo: text("provider_return_to").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: varchar("code_challenge", { length: 128 }).notNull(),
    codeChallengeMethod: oauthCodeChallengeMethod("code_challenge_method")
      .default("S256")
      .notNull(),
    clientState: text("client_state"),
    oidcNonce: text("oidc_nonce"),
    idTokenHintSubject: varchar("id_token_hint_subject", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    abandonedAt: timestamp("abandoned_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    foreignKey({
      name: "oauth_interactions_redirect_uri_fk",
      columns: [table.clientId, table.redirectUri],
      foreignColumns: [
        oauthClientRedirectUris.clientId,
        oauthClientRedirectUris.redirectUri
      ]
    }),
    foreignKey({
      name: "oauth_interactions_session_account_fk",
      columns: [table.sessionId, table.accountId],
      foreignColumns: [oauthSessions.id, oauthSessions.accountId]
    }),
    foreignKey({
      name: "oauth_interactions_grant_binding_fk",
      columns: [table.grantId, table.accountId, table.clientId],
      foreignColumns: [
        oauthGrants.id,
        oauthGrants.accountId,
        oauthGrants.clientId
      ]
    }),
    unique("oauth_interactions_id_client_uq").on(table.id, table.clientId),
    unique("oauth_interactions_credential_hash_uq").on(table.credentialHash),
    index("oauth_interactions_expiry_idx").on(table.expiresAt),
    check(
      "oauth_interactions_credential_hash_length",
      sql`octet_length(${table.credentialHash}) = 32`
    ),
    check(
      "oauth_interactions_provider_cid_format",
      sql`length(${table.providerCid}) = 43 AND ${table.providerCid} ~ '^[A-Za-z0-9_-]+$'`
    ),
    check(
      "oauth_interactions_provider_return_to_nonempty",
      sql`length(btrim(${table.providerReturnTo})) > 0`
    ),
    check(
      "oauth_interactions_pkce_s256",
      sql`length(${table.codeChallenge}) = 43 AND ${table.codeChallenge} ~ '^[A-Za-z0-9_-]+$'`
    ),
    check(
      "oauth_interactions_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
    check(
      "oauth_interactions_id_token_hint_subject_nonempty",
      sql`${table.idTokenHintSubject} IS NULL OR length(btrim(${table.idTokenHintSubject})) > 0`
    ),
    check(
      "oauth_interactions_account_session_pair",
      sql`(${table.accountId} IS NULL AND ${table.sessionId} IS NULL AND ${table.grantId} IS NULL) OR (${table.accountId} IS NOT NULL AND ${table.sessionId} IS NOT NULL)`
    ),
    check(
      "oauth_interactions_terminal_state",
      sql`(${table.status} = 'pending' AND ${table.completedAt} IS NULL AND ${table.abandonedAt} IS NULL) OR (${table.status} = 'completed' AND ${table.completedAt} IS NOT NULL AND ${table.abandonedAt} IS NULL) OR (${table.status} = 'abandoned' AND ${table.completedAt} IS NULL AND ${table.abandonedAt} IS NOT NULL)`
    ),
    check(
      "oauth_interactions_completion_window",
      sql`${table.completedAt} IS NULL OR (${table.completedAt} >= ${table.createdAt} AND ${table.completedAt} <= ${table.expiresAt})`
    ),
    check(
      "oauth_interactions_abandonment_after_creation",
      sql`${table.abandonedAt} IS NULL OR ${table.abandonedAt} >= ${table.createdAt}`
    )
  ]
);

export const oauthInteractionRequestedScopes = pgTable(
  "oauth_interaction_requested_scopes",
  {
    interactionId: uuid("interaction_id").notNull(),
    clientId: varchar("client_id", { length: 200 }).notNull(),
    scope: varchar("scope", { length: 200 }).notNull()
  },
  (table) => [
    foreignKey({
      name: "oauth_interaction_scopes_interaction_client_fk",
      columns: [table.interactionId, table.clientId],
      foreignColumns: [oauthInteractions.id, oauthInteractions.clientId]
    }),
    foreignKey({
      name: "oauth_interaction_scopes_client_scope_fk",
      columns: [table.clientId, table.scope],
      foreignColumns: [
        oauthClientAllowedScopes.clientId,
        oauthClientAllowedScopes.scope
      ]
    }),
    primaryKey({
      name: "oauth_interaction_requested_scopes_pk",
      columns: [table.interactionId, table.scope]
    })
  ]
);

export const oauthInteractionRequestedResources = pgTable(
  "oauth_interaction_requested_resources",
  {
    interactionId: uuid("interaction_id").notNull(),
    resource: text("resource").notNull()
  },
  (table) => [
    foreignKey({
      name: "oauth_interaction_resources_interaction_fk",
      columns: [table.interactionId],
      foreignColumns: [oauthInteractions.id]
    }),
    primaryKey({
      name: "oauth_interaction_requested_resources_pk",
      columns: [table.interactionId, table.resource]
    }),
    check(
      "oauth_interaction_resources_nonempty",
      sql`length(btrim(${table.resource})) > 0`
    )
  ]
);

export const oauthAuthorizationCodes = pgTable(
  "oauth_authorization_codes",
  {
    id: uuid("id").primaryKey(),
    codeHash: bytea("code_hash").notNull(),
    accountId: uuid("account_id").notNull(),
    clientId: varchar("client_id", { length: 200 }).notNull(),
    sessionId: uuid("session_id").notNull(),
    grantId: uuid("grant_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: varchar("code_challenge", { length: 128 }).notNull(),
    codeChallengeMethod: oauthCodeChallengeMethod("code_challenge_method")
      .default("S256")
      .notNull(),
    resource: text("resource").notNull(),
    issuedScopes: text("issued_scopes").array().notNull(),
    oidcNonce: text("oidc_nonce"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    foreignKey({
      name: "oauth_authorization_codes_session_account_fk",
      columns: [table.sessionId, table.accountId],
      foreignColumns: [oauthSessions.id, oauthSessions.accountId]
    }),
    foreignKey({
      name: "oauth_authorization_codes_grant_binding_fk",
      columns: [table.grantId, table.accountId, table.clientId],
      foreignColumns: [
        oauthGrants.id,
        oauthGrants.accountId,
        oauthGrants.clientId
      ]
    }),
    foreignKey({
      name: "oauth_authorization_codes_redirect_uri_fk",
      columns: [table.clientId, table.redirectUri],
      foreignColumns: [
        oauthClientRedirectUris.clientId,
        oauthClientRedirectUris.redirectUri
      ]
    }),
    unique("oauth_authorization_codes_hash_uq").on(table.codeHash),
    index("oauth_authorization_codes_expiry_idx").on(table.expiresAt),
    check(
      "oauth_authorization_codes_hash_length",
      sql`octet_length(${table.codeHash}) = 32`
    ),
    check(
      "oauth_authorization_codes_pkce_s256",
      sql`length(${table.codeChallenge}) = 43 AND ${table.codeChallenge} ~ '^[A-Za-z0-9_-]+$'`
    ),
    check(
      "oauth_authorization_codes_resource_nonempty",
      sql`length(btrim(${table.resource})) > 0`
    ),
    check(
      "oauth_authorization_codes_scopes_nonempty",
      sql`cardinality(${table.issuedScopes}) > 0 AND array_position(${table.issuedScopes}, NULL) IS NULL`
    ),
    check(
      "oauth_authorization_codes_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
    check(
      "oauth_authorization_codes_consumption_window",
      sql`${table.consumedAt} IS NULL OR (${table.consumedAt} >= ${table.createdAt} AND ${table.consumedAt} <= ${table.expiresAt})`
    )
  ]
);

export const oauthRefreshTokenFamilies = pgTable(
  "oauth_refresh_token_families",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id").notNull(),
    clientId: varchar("client_id", { length: 200 }).notNull(),
    sessionId: uuid("session_id").notNull(),
    grantId: uuid("grant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    reuseDetectedAt: timestamp("reuse_detected_at", {
      withTimezone: true,
      mode: "date"
    })
  },
  (table) => [
    foreignKey({
      name: "oauth_refresh_families_session_account_fk",
      columns: [table.sessionId, table.accountId],
      foreignColumns: [oauthSessions.id, oauthSessions.accountId]
    }),
    foreignKey({
      name: "oauth_refresh_families_grant_binding_fk",
      columns: [table.grantId, table.accountId, table.clientId],
      foreignColumns: [
        oauthGrants.id,
        oauthGrants.accountId,
        oauthGrants.clientId
      ]
    }),
    unique("oauth_refresh_families_binding_uq").on(
      table.id,
      table.accountId,
      table.clientId,
      table.sessionId,
      table.grantId
    ),
    index("oauth_refresh_families_session_idx").on(table.sessionId),
    check(
      "oauth_refresh_families_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
    check(
      "oauth_refresh_families_revocation_after_creation",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`
    ),
    check(
      "oauth_refresh_families_reuse_revokes",
      sql`${table.reuseDetectedAt} IS NULL OR (${table.reuseDetectedAt} >= ${table.createdAt} AND ${table.revokedAt} IS NOT NULL AND ${table.revokedAt} <= ${table.reuseDetectedAt})`
    )
  ]
);

export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: uuid("id").primaryKey(),
    familyId: uuid("family_id").notNull(),
    generation: integer("generation").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    accountId: uuid("account_id").notNull(),
    clientId: varchar("client_id", { length: 200 }).notNull(),
    sessionId: uuid("session_id").notNull(),
    grantId: uuid("grant_id").notNull(),
    resource: text("resource").notNull(),
    issuedScopes: text("issued_scopes").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    replacedByGeneration: integer("replaced_by_generation")
  },
  (table) => [
    foreignKey({
      name: "oauth_refresh_tokens_family_binding_fk",
      columns: [
        table.familyId,
        table.accountId,
        table.clientId,
        table.sessionId,
        table.grantId
      ],
      foreignColumns: [
        oauthRefreshTokenFamilies.id,
        oauthRefreshTokenFamilies.accountId,
        oauthRefreshTokenFamilies.clientId,
        oauthRefreshTokenFamilies.sessionId,
        oauthRefreshTokenFamilies.grantId
      ]
    }),
    foreignKey({
      name: "oauth_refresh_tokens_replacement_fk",
      columns: [table.familyId, table.replacedByGeneration],
      foreignColumns: [table.familyId, table.generation]
    }),
    unique("oauth_refresh_tokens_hash_uq").on(table.tokenHash),
    unique("oauth_refresh_tokens_family_generation_uq").on(
      table.familyId,
      table.generation
    ),
    index("oauth_refresh_tokens_expiry_idx").on(table.expiresAt),
    check(
      "oauth_refresh_tokens_hash_length",
      sql`octet_length(${table.tokenHash}) = 32`
    ),
    check(
      "oauth_refresh_tokens_generation_nonnegative",
      sql`${table.generation} >= 0`
    ),
    check(
      "oauth_refresh_tokens_resource_nonempty",
      sql`length(btrim(${table.resource})) > 0`
    ),
    check(
      "oauth_refresh_tokens_scopes_nonempty",
      sql`cardinality(${table.issuedScopes}) > 0 AND array_position(${table.issuedScopes}, NULL) IS NULL`
    ),
    check(
      "oauth_refresh_tokens_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
    check(
      "oauth_refresh_tokens_consumption_window",
      sql`${table.consumedAt} IS NULL OR (${table.consumedAt} >= ${table.createdAt} AND ${table.consumedAt} <= ${table.expiresAt})`
    ),
    check(
      "oauth_refresh_tokens_revocation_after_creation",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`
    ),
    check(
      "oauth_refresh_tokens_replacement_consumed",
      sql`${table.replacedByGeneration} IS NULL OR ${table.consumedAt} IS NOT NULL`
    ),
    check(
      "oauth_refresh_tokens_next_generation",
      sql`${table.replacedByGeneration} IS NULL OR ${table.replacedByGeneration} = ${table.generation} + 1`
    )
  ]
);

export const oauthSigningKeys = pgTable(
  "oauth_signing_keys",
  {
    id: uuid("id").primaryKey(),
    keyId: varchar("key_id", { length: 200 }).notNull(),
    algorithm: oauthSigningKeyAlgorithm("algorithm").notNull(),
    publicKeySpki: bytea("public_key_spki").notNull(),
    secretProviderHandle: varchar("secret_provider_handle", {
      length: 500
    }).notNull(),
    status: oauthSigningKeyStatus("status").default("staged").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "date"
    }),
    activatedAt: timestamp("activated_at", {
      withTimezone: true,
      mode: "date"
    }),
    signingStoppedAt: timestamp("signing_stopped_at", {
      withTimezone: true,
      mode: "date"
    }),
    retiredAt: timestamp("retired_at", {
      withTimezone: true,
      mode: "date"
    }),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      mode: "date"
    })
  },
  (table) => [
    unique("oauth_signing_keys_key_id_uq").on(table.keyId),
    unique("oauth_signing_keys_secret_handle_uq").on(
      table.secretProviderHandle
    ),
    uniqueIndex("oauth_signing_keys_one_active_uq")
      .on(table.status)
      .where(sql`${table.status} = 'active'`),
    index("oauth_signing_keys_status_idx").on(table.status),
    check(
      "oauth_signing_keys_key_id_nonempty",
      sql`length(btrim(${table.keyId})) > 0`
    ),
    check(
      "oauth_signing_keys_public_spki_length",
      sql`octet_length(${table.publicKeySpki}) BETWEEN 1 AND 8192`
    ),
    check(
      "oauth_signing_keys_secret_handle_nonempty",
      sql`length(btrim(${table.secretProviderHandle})) > 0`
    ),
    check(
      "oauth_signing_keys_published_after_creation",
      sql`${table.publishedAt} IS NULL OR ${table.publishedAt} >= ${table.createdAt}`
    ),
    check(
      "oauth_signing_keys_activated_after_publish",
      sql`${table.activatedAt} IS NULL OR (${table.publishedAt} IS NOT NULL AND ${table.activatedAt} >= ${table.publishedAt})`
    ),
    check(
      "oauth_signing_keys_stopped_after_activation",
      sql`${table.signingStoppedAt} IS NULL OR (${table.activatedAt} IS NOT NULL AND ${table.signingStoppedAt} >= ${table.activatedAt})`
    ),
    check(
      "oauth_signing_keys_retired_after_stop",
      sql`${table.retiredAt} IS NULL OR (${table.signingStoppedAt} IS NOT NULL AND ${table.retiredAt} >= ${table.signingStoppedAt})`
    ),
    check(
      "oauth_signing_keys_revoked_after_creation",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`
    ),
    check(
      "oauth_signing_keys_lifecycle_state",
      sql`(${table.status} = 'staged' AND ${table.activatedAt} IS NULL AND ${table.signingStoppedAt} IS NULL AND ${table.retiredAt} IS NULL AND ${table.revokedAt} IS NULL) OR (${table.status} = 'active' AND ${table.publishedAt} IS NOT NULL AND ${table.activatedAt} IS NOT NULL AND ${table.signingStoppedAt} IS NULL AND ${table.retiredAt} IS NULL AND ${table.revokedAt} IS NULL) OR (${table.status} = 'verifying' AND ${table.publishedAt} IS NOT NULL AND ${table.activatedAt} IS NOT NULL AND ${table.signingStoppedAt} IS NOT NULL AND ${table.retiredAt} IS NULL AND ${table.revokedAt} IS NULL) OR (${table.status} = 'retired' AND ${table.publishedAt} IS NOT NULL AND ${table.activatedAt} IS NOT NULL AND ${table.signingStoppedAt} IS NOT NULL AND ${table.retiredAt} IS NOT NULL AND ${table.revokedAt} IS NULL) OR (${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL)`
    )
  ]
);

export const identitySecurityEvents = pgTable(
  "identity_security_events",
  {
    id: uuid("id").primaryKey(),
    eventType: identitySecurityEventType("event_type").notNull(),
    outcome: identitySecurityEventOutcome("outcome").notNull(),
    actorKind: identitySecurityActorKind("actor_kind").notNull(),
    actorAccountId: uuid("actor_account_id"),
    accountId: uuid("account_id"),
    clientId: varchar("client_id", { length: 200 }),
    sessionId: uuid("session_id"),
    signingKeyId: uuid("signing_key_id"),
    correlationId: varchar("correlation_id", { length: 200 }).notNull(),
    sourceAddressHash: bytea("source_address_hash"),
    userAgentHash: bytea("user_agent_hash"),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date"
    })
      .defaultNow()
      .notNull()
  },
  (table) => [
    foreignKey({
      name: "identity_sec_events_actor_account_fk",
      columns: [table.actorAccountId],
      foreignColumns: [identityAccounts.id]
    }),
    foreignKey({
      name: "identity_sec_events_account_fk",
      columns: [table.accountId],
      foreignColumns: [identityAccounts.id]
    }),
    foreignKey({
      name: "identity_sec_events_client_fk",
      columns: [table.clientId],
      foreignColumns: [oauthClients.id]
    }),
    foreignKey({
      name: "identity_sec_events_signing_key_fk",
      columns: [table.signingKeyId],
      foreignColumns: [oauthSigningKeys.id]
    }),
    foreignKey({
      name: "identity_security_events_session_account_fk",
      columns: [table.sessionId, table.accountId],
      foreignColumns: [oauthSessions.id, oauthSessions.accountId]
    }),
    index("identity_security_events_occurred_idx").on(table.occurredAt),
    index("identity_security_events_account_idx").on(
      table.accountId,
      table.occurredAt
    ),
    index("identity_security_events_client_idx").on(
      table.clientId,
      table.occurredAt
    ),
    index("identity_security_events_correlation_idx").on(table.correlationId),
    check(
      "identity_security_events_actor_account",
      sql`(${table.actorKind} = 'account' AND ${table.actorAccountId} IS NOT NULL) OR (${table.actorKind} <> 'account' AND ${table.actorAccountId} IS NULL)`
    ),
    check(
      "identity_security_events_client_actor",
      sql`${table.actorKind} <> 'oauth_client' OR ${table.clientId} IS NOT NULL`
    ),
    check(
      "identity_security_events_session_account",
      sql`(${table.sessionId} IS NULL AND ${table.accountId} IS NULL) OR (${table.sessionId} IS NOT NULL AND ${table.accountId} IS NOT NULL) OR (${table.sessionId} IS NULL AND ${table.accountId} IS NOT NULL)`
    ),
    check(
      "identity_security_events_correlation_nonempty",
      sql`length(btrim(${table.correlationId})) > 0`
    ),
    check(
      "identity_security_events_source_hash_length",
      sql`${table.sourceAddressHash} IS NULL OR octet_length(${table.sourceAddressHash}) = 32`
    ),
    check(
      "identity_security_events_agent_hash_length",
      sql`${table.userAgentHash} IS NULL OR octet_length(${table.userAgentHash}) = 32`
    )
  ]
);

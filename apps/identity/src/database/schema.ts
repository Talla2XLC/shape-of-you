import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  pgEnum,
  pgTable,
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

export const identityAccounts = pgTable(
  "identity_accounts",
  {
    id: uuid("id").primaryKey(),
    subject: uuid("subject").notNull(),
    webauthnUserHandle: bytea("webauthn_user_handle").notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
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

export const webauthnChallenges = pgTable(
  "webauthn_challenges",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id").references(() => identityAccounts.id),
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
      "webauthn_challenges_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`
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

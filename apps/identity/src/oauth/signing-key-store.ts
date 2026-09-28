import { randomUUID, timingSafeEqual } from "node:crypto";

import type { Pool } from "pg";

import type { OAuthSigningKeyRing } from "./signing-keys.js";

interface SigningKeyRow {
  readonly id: string;
  readonly key_id: string;
  readonly public_key_spki: Buffer;
  readonly secret_provider_handle: string;
  readonly status: "staged" | "active" | "verifying" | "retired" | "revoked";
  readonly published_at: Date | null;
  readonly signing_stopped_at: Date | null;
}

/** Measured minimum windows required for planned signing-key transitions. */
export interface OAuthSigningKeyRotationPolicy {
  /** Minimum time since staging; external JWKS visibility needs an operator check. */
  readonly publicationDelayMs: number;
  /** Time an old key must remain verifiable after signing stops. */
  readonly verificationOverlapMs: number;
}

/** Reconciles external private signing material with public database metadata. */
export class OAuthSigningKeyStore {
  public constructor(private readonly pool: Pool) {}

  /**
   * Publishes new verification keys before a later active-key transition.
   *
   * A first boot accepts exactly one new key. A later boot with the old active
   * key may stage additional keys in JWKS. Activation requires a key staged by
   * a previous reconciliation and an explicit publication window. A verifying
   * key can leave the ring only after the explicit verification window. Public
   * material changes under an existing `kid` fail closed.
   *
   * @param keyRing - Validated external ES256 signing material.
   * @param policy - Measured transition windows, required for activation and retirement.
   * @throws Error when lifecycle metadata and external keys cannot be reconciled.
   */
  public async reconcile(
    keyRing: OAuthSigningKeyRing,
    policy?: OAuthSigningKeyRotationPolicy
  ): Promise<void> {
    if (
      policy && (
        !Number.isSafeInteger(policy.publicationDelayMs) ||
        policy.publicationDelayMs < 660_000 ||
        !Number.isSafeInteger(policy.verificationOverlapMs) ||
        policy.verificationOverlapMs < 660_000
      )
    ) {
      throw new Error("OAuth signing-key rotation policy is invalid");
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<SigningKeyRow>(
        `select id, key_id, public_key_spki, secret_provider_handle, status,
                published_at, signing_stopped_at
           from oauth_signing_keys
          order by created_at
          for update`
      );
      const rowsByKeyId = new Map(result.rows.map((row) => [row.key_id, row]));

      for (const [keyId, publicSpki] of keyRing.publicSpkiByKeyId) {
        const row = rowsByKeyId.get(keyId);
        if (row && !buffersEqual(row.public_key_spki, publicSpki)) {
          throw new Error(`OAuth signing key ${keyId} does not match persisted public material`);
        }
        if (row && row.secret_provider_handle !== `env:${keyId}`) {
          throw new Error(`OAuth signing key ${keyId} uses an unexpected secret-provider handle`);
        }
        if (row && ["retired", "revoked"].includes(row.status)) {
          throw new Error(`OAuth signing key ${keyId} cannot be republished`);
        }
      }

      const active = result.rows.find((row) => row.status === "active");
      const configuredActive = rowsByKeyId.get(keyRing.activeKeyId);
      if (!active && result.rows.length === 0) {
        if (keyRing.publicSpkiByKeyId.size !== 1) {
          throw new Error("First OAuth signing-key activation requires exactly one external key");
        }
        const signingKeyId = await insertActiveKey(client, keyRing);
        await insertSigningKeyEvent(client, signingKeyId);
      } else if (active?.key_id === keyRing.activeKeyId) {
        if (!configuredActive) {
          throw new Error("Active OAuth signing key metadata is missing");
        }
      } else {
        if (!active) {
          throw new Error("OAuth signing-key metadata has no active key");
        }
        if (!keyRing.publicSpkiByKeyId.has(active.key_id)) {
          throw new Error("Previous OAuth signing key must remain available during rotation");
        }
        if (!configuredActive || configuredActive.status !== "staged") {
          throw new Error("Configured OAuth signing key must be staged before activation");
        }
        const now = new Date();
        if (
          !policy ||
          !elapsed(configuredActive.published_at, policy.publicationDelayMs, now)
        ) {
          throw new Error("Staged OAuth signing key has not completed its publication window");
        }
        await client.query(
          `update oauth_signing_keys
              set status = 'verifying', signing_stopped_at = $2
            where id = $1 and status = 'active'`,
          [active.id, now]
        );
        await insertSigningKeyEvent(client, active.id);
        await client.query(
          `update oauth_signing_keys
              set status = 'active', activated_at = $2
            where id = $1 and status = 'staged'`,
          [configuredActive.id, now]
        );
        await insertSigningKeyEvent(client, configuredActive.id);
      }

      for (const row of result.rows) {
        if (keyRing.publicSpkiByKeyId.has(row.key_id)) continue;
        if (row.status === "verifying") {
          const now = new Date();
          if (!policy || !elapsed(row.signing_stopped_at, policy.verificationOverlapMs, now)) {
            throw new Error(`OAuth signing key ${row.key_id} is still required for verification`);
          }
          await client.query(
            `update oauth_signing_keys
                set status = 'retired', retired_at = $2
              where id = $1 and status = 'verifying'`,
            [row.id, now]
          );
          await insertSigningKeyEvent(client, row.id);
        } else if (row.status === "staged" || row.status === "active") {
          throw new Error(`OAuth signing key ${row.key_id} is still required for verification`);
        }
      }
      const unknownExternalKeys = [...keyRing.publicSpkiByKeyId.keys()].filter(
        (keyId) => keyId !== keyRing.activeKeyId && !rowsByKeyId.has(keyId)
      );
      for (const keyId of unknownExternalKeys) {
        const publicSpki = keyRing.publicSpkiByKeyId.get(keyId)!;
        const signingKeyId = randomUUID();
        const now = new Date();
        await client.query(
          `insert into oauth_signing_keys
             (id, key_id, algorithm, public_key_spki, secret_provider_handle,
              status, created_at, published_at)
           values ($1, $2, 'ES256', $3, $4, 'staged', $5, $5)`,
          [signingKeyId, keyId, publicSpki, `env:${keyId}`, now]
        );
        await insertSigningKeyEvent(client, signingKeyId);
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

function elapsed(since: Date | null, minimumMs: number, now: Date): boolean {
  return since !== null && now.getTime() - since.getTime() >= minimumMs;
}

function buffersEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

async function insertActiveKey(
  client: { query(query: string, values?: readonly unknown[]): Promise<unknown> },
  keyRing: OAuthSigningKeyRing,
  now = new Date()
): Promise<string> {
  const publicSpki = keyRing.publicSpkiByKeyId.get(keyRing.activeKeyId);
  if (!publicSpki) {
    throw new Error("Active OAuth signing key is unavailable");
  }
  const id = randomUUID();
  await client.query(
    `insert into oauth_signing_keys
       (id, key_id, algorithm, public_key_spki, secret_provider_handle,
        status, created_at, published_at, activated_at)
     values ($1, $2, 'ES256', $3, $4, 'active', $5, $5, $5)`,
    [id, keyRing.activeKeyId, publicSpki, `env:${keyRing.activeKeyId}`, now]
  );
  return id;
}

async function insertSigningKeyEvent(
  client: { query(query: string, values?: readonly unknown[]): Promise<unknown> },
  signingKeyId: string
): Promise<void> {
  await client.query(
    `insert into identity_security_events
     (id, event_type, outcome, actor_kind, signing_key_id, correlation_id)
     values ($1, 'signing_key_lifecycle_changed', 'succeeded', 'system',
             $2::uuid, $2::text)`,
    [randomUUID(), signingKeyId]
  );
}

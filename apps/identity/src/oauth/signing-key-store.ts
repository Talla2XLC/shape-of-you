import { randomUUID, timingSafeEqual } from "node:crypto";

import type { Pool } from "pg";

import type { OAuthSigningKeyRing } from "./signing-keys.js";

interface SigningKeyRow {
  readonly id: string;
  readonly key_id: string;
  readonly public_key_spki: Buffer;
  readonly secret_provider_handle: string;
  readonly status: "staged" | "active" | "verifying" | "retired" | "revoked";
}

/** Reconciles external private signing material with public database metadata. */
export class OAuthSigningKeyStore {
  public constructor(private readonly pool: Pool) {}

  /**
   * Activates the configured key and preserves the previous key for verification.
   *
   * A first boot accepts exactly one new key. Rotation accepts one new active
   * key while every previous verification key remains present in the external
   * ring. Public material changes under an existing `kid` fail closed.
   *
   * @param keyRing - Validated external ES256 signing material.
   * @throws Error when lifecycle metadata and external keys cannot be reconciled.
   */
  public async reconcile(keyRing: OAuthSigningKeyRing): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<SigningKeyRow>(
        `select id, key_id, public_key_spki, secret_provider_handle, status
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
        if (configuredActive && configuredActive.status !== "staged") {
          throw new Error("Configured OAuth signing key is not staged for activation");
        }
        const now = new Date();
        await client.query(
          `update oauth_signing_keys
              set status = 'verifying', signing_stopped_at = $2
            where id = $1 and status = 'active'`,
          [active.id, now]
        );
        await insertSigningKeyEvent(client, active.id);
        let activatedKeyId: string;
        if (configuredActive) {
          await client.query(
            `update oauth_signing_keys
                set status = 'active', published_at = coalesce(published_at, $2),
                    activated_at = $2
              where id = $1 and status = 'staged'`,
            [configuredActive.id, now]
          );
          activatedKeyId = configuredActive.id;
        } else {
          activatedKeyId = await insertActiveKey(client, keyRing, now);
        }
        await insertSigningKeyEvent(client, activatedKeyId);
      }

      for (const row of result.rows) {
        if (
          ["active", "verifying"].includes(row.status) &&
          !keyRing.publicSpkiByKeyId.has(row.key_id)
        ) {
          throw new Error(`OAuth signing key ${row.key_id} is still required for verification`);
        }
      }
      const unknownExternalKeys = [...keyRing.publicSpkiByKeyId.keys()].filter(
        (keyId) => keyId !== keyRing.activeKeyId && !rowsByKeyId.has(keyId)
      );
      if (unknownExternalKeys.length > 0) {
        throw new Error("Non-active OAuth signing keys must already have lifecycle metadata");
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

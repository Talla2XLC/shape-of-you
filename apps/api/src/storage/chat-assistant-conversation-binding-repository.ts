import { and, desc, eq, sql } from "drizzle-orm";

import type { DatabaseContext } from "../database/context.js";
import {
  chatAssistantConversationBindings,
  type ChatAssistantConversationBindingRow
} from "../database/schema.js";
import {
  assertExternalConversationId,
  type ChatAssistantConversationBinding,
  type ChatAssistantSurface
} from "../domain/chat-assistant-conversation-binding.js";

/** Bounded lookup result that distinguishes safe launcher stop states. */
export type ChatAssistantBindingResolution =
  | { readonly status: "active"; readonly binding: ChatAssistantConversationBinding }
  | { readonly status: "ambiguous" }
  | { readonly status: "disabled" }
  | { readonly status: "missing" };

/** Result of one explicit operator lifecycle command. */
export interface ChatAssistantBindingMutationResult {
  readonly bindingId: string | null;
  readonly status: "bound" | "disabled" | "existing" | "missing";
}

/** Persistence boundary for Person-owned external assistant conversations. */
export interface ChatAssistantConversationBindingStore {
  resolveActive(
    personId: string,
    surface: ChatAssistantSurface
  ): Promise<ChatAssistantBindingResolution>;
}

/** PostgreSQL persistence for external assistant conversation bindings. */
export class ChatAssistantConversationBindingRepository
  implements ChatAssistantConversationBindingStore
{
  public constructor(private readonly database: DatabaseContext) {}

  /** Resolves one active binding and fails closed on inconsistent state. */
  public async resolveActive(
    personId: string,
    surface: ChatAssistantSurface
  ): Promise<ChatAssistantBindingResolution> {
    const rows = await this.database.db
      .select()
      .from(chatAssistantConversationBindings)
      .where(
        and(
          eq(chatAssistantConversationBindings.personId, personId),
          eq(chatAssistantConversationBindings.surface, surface)
        )
      )
      .orderBy(desc(chatAssistantConversationBindings.updatedAt));
    const active = rows.filter((row) => row.status === "active");
    if (active.length > 1) return { status: "ambiguous" };
    if (active[0]) return { status: "active", binding: hydrate(active[0]) };
    return { status: rows.length > 0 ? "disabled" : "missing" };
  }

  /** Replaces the active binding atomically or returns the exact existing one. */
  public bind(
    personId: string,
    surface: ChatAssistantSurface,
    externalConversationId: string
  ): Promise<ChatAssistantBindingMutationResult> {
    assertExternalConversationId(externalConversationId);
    return this.database.db.transaction(async (transaction) => {
      await lockBindingLifecycle(transaction, personId, surface);
      const active = await transaction.query.chatAssistantConversationBindings.findFirst({
        where: and(
          eq(chatAssistantConversationBindings.personId, personId),
          eq(chatAssistantConversationBindings.surface, surface),
          eq(chatAssistantConversationBindings.status, "active")
        )
      });
      if (active?.externalConversationId === externalConversationId) {
        return { bindingId: active.id, status: "existing" };
      }
      if (active) {
        await transaction
          .update(chatAssistantConversationBindings)
          .set({ status: "disabled", updatedAt: new Date() })
          .where(eq(chatAssistantConversationBindings.id, active.id));
      }
      const inserted = await transaction
        .insert(chatAssistantConversationBindings)
        .values({ personId, surface, externalConversationId })
        .returning({ id: chatAssistantConversationBindings.id });
      const row = inserted[0];
      if (!row) throw new Error("Chat assistant binding insert returned no row");
      return { bindingId: row.id, status: "bound" };
    });
  }

  /** Disables the active binding without deleting its lifecycle evidence. */
  public async disable(
    personId: string,
    surface: ChatAssistantSurface
  ): Promise<ChatAssistantBindingMutationResult> {
    return this.database.db.transaction(async (transaction) => {
      await lockBindingLifecycle(transaction, personId, surface);
      const updated = await transaction
        .update(chatAssistantConversationBindings)
        .set({ status: "disabled", updatedAt: new Date() })
        .where(
          and(
            eq(chatAssistantConversationBindings.personId, personId),
            eq(chatAssistantConversationBindings.surface, surface),
            eq(chatAssistantConversationBindings.status, "active")
          )
        )
        .returning({ id: chatAssistantConversationBindings.id });
      return updated[0]
        ? { bindingId: updated[0].id, status: "disabled" }
        : { bindingId: null, status: "missing" };
    });
  }
}

type BindingTransaction = Parameters<
  Parameters<DatabaseContext["db"]["transaction"]>[0]
>[0];

async function lockBindingLifecycle(
  transaction: BindingTransaction,
  personId: string,
  surface: ChatAssistantSurface
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${personId}:${surface}`}, 0))`
  );
}

function hydrate(
  row: ChatAssistantConversationBindingRow
): ChatAssistantConversationBinding {
  return {
    id: row.id,
    personId: row.personId,
    surface: row.surface,
    externalConversationId: row.externalConversationId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "@shape-of-you/config";

import { buildApp, getFastifyInstance } from "../src/app.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { ChatAssistantConversationBindingRepository } from "../src/storage/chat-assistant-conversation-binding-repository.js";

const personId = "00000000-0000-4000-8000-000000000001";
const otherPersonId = "00000000-0000-4000-8000-000000000002";
const conversationId = "00000000-0000-8000-8000-000000000068";
let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let repository: ChatAssistantConversationBindingRepository;
let app: NestFastifyApplication;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_chat_assistant_test")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  const databaseUrl = container.getConnectionUri();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = personId;
  await runMigrations(databaseUrl);
  const config: AppConfig = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3_000,
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: personId,
    SHUTDOWN_TIMEOUT_MS: 1_000
  };
  database = createDatabase(config);
  repository = new ChatAssistantConversationBindingRepository(database);
  app = await buildApp({
    config,
    database,
    chatAssistantConversationBindingStore: repository
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await database?.pool.end();
  await container?.stop();
});

describe("Chat assistant PostgreSQL launcher", () => {
  it("enforces FK, enum, identifier shape, and one-active constraints", async () => {
    const constrainedPersonId = "00000000-0000-4000-8000-000000000003";
    await database.pool.query(
      "insert into persons (id, kind, status) values ($1, 'real', 'active')",
      [constrainedPersonId]
    );
    await database.pool.query(
      `insert into chat_assistant_conversation_bindings
         (person_id, surface, external_conversation_id, status)
       values ($1, 'chatgpt_work', 'constraint-conversation-0001', 'active')`,
      [constrainedPersonId]
    );
    await expect(database.pool.query(
      `insert into chat_assistant_conversation_bindings
         (person_id, surface, external_conversation_id, status)
       values ($1, 'chatgpt_work', 'constraint-conversation-0002', 'active')`,
      [constrainedPersonId]
    )).rejects.toMatchObject({ constraint: "chat_assistant_binding_active_uq" });
    await expect(database.pool.query(
      `insert into chat_assistant_conversation_bindings
         (person_id, surface, external_conversation_id, status)
       values ($1, 'chatgpt_work', 'constraint-conversation-0002', 'disabled')`,
      [constrainedPersonId]
    )).resolves.toMatchObject({ rowCount: 1 });
    await expect(database.pool.query(
      `insert into chat_assistant_conversation_bindings
         (person_id, surface, external_conversation_id, status)
       values ($1, 'chatgpt_work', 'https://evil.test/private', 'disabled')`,
      [constrainedPersonId]
    )).rejects.toMatchObject({ constraint: "chat_assistant_binding_external_id_shape" });
    await expect(database.pool.query(
      `insert into chat_assistant_conversation_bindings
         (person_id, surface, external_conversation_id, status)
       values ('00000000-0000-4000-8000-000000000099', 'chatgpt_work',
               'constraint-conversation-0003', 'disabled')`
    )).rejects.toMatchObject({ code: "23503" });
    await expect(database.pool.query(
      `insert into chat_assistant_conversation_bindings
         (person_id, surface, external_conversation_id, status)
       values ($1, 'unsupported_surface', 'constraint-conversation-0004', 'disabled')`,
      [constrainedPersonId]
    )).rejects.toMatchObject({ code: "22P02" });
  });

  it("fails closed without leaking an identifier when no binding exists", async () => {
    const response = await getFastifyInstance(app).inject({
      method: "GET",
      url: "/v1/chat-assistant/launch",
      headers: { accept: "application/json" }
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.json()).toEqual({
      error: "CHAT_ASSISTANT_UNAVAILABLE",
      message: "Shape of You Coach is not configured for this account",
      reason: "not_configured",
      statusCode: 503
    });
    expect(response.body).not.toContain(conversationId);
  });

  it("keeps bindings Person-local and redirects only to the allowlisted host", async () => {
    await database.pool.query(
      "insert into persons (id, kind, status) values ($1, 'real', 'active')",
      [otherPersonId]
    );
    await repository.bind(otherPersonId, "chatgpt_work", "another-conversation-1234");
    await expect(repository.resolveActive(personId, "chatgpt_work")).resolves.toEqual({ status: "missing" });

    await expect(repository.bind(personId, "chatgpt_work", conversationId)).resolves.toMatchObject({ status: "bound" });
    await expect(repository.bind(personId, "chatgpt_work", conversationId)).resolves.toMatchObject({ status: "existing" });
    const response = await getFastifyInstance(app).inject({
      method: "GET",
      url: "/v1/chat-assistant/launch",
      headers: { accept: "text/html" }
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(`https://chatgpt.com/c/${conversationId}`);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("preserves lifecycle evidence and returns a same-origin disabled stop", async () => {
    await expect(repository.disable(personId, "chatgpt_work")).resolves.toMatchObject({ status: "disabled" });
    await expect(repository.resolveActive(personId, "chatgpt_work")).resolves.toEqual({ status: "disabled" });
    const response = await getFastifyInstance(app).inject({
      method: "GET",
      url: "/v1/chat-assistant/launch",
      headers: { accept: "text/html" }
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("/progress?coach=disabled");
    expect(response.headers.location).not.toContain(conversationId);
  });
});

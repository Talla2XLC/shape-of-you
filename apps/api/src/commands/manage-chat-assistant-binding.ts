import { parseArgs } from "node:util";

import { createDatabase } from "../database/context.js";
import { assertExternalConversationId } from "../domain/chat-assistant-conversation-binding.js";
import { ChatAssistantConversationBindingRepository } from "../storage/chat-assistant-conversation-binding-repository.js";

const syntheticPersonId = "00000000-0000-4000-8000-000000000001";
type Action = "bind" | "disable" | "inspect";

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing required option ${name}`);
  return normalized;
}

function action(value: string | undefined): Action {
  if (value !== "bind" && value !== "disable" && value !== "inspect") {
    throw new Error("--action must be bind, disable, or inspect");
  }
  return value;
}

function personId(value: string | undefined): string {
  const input = required(value, "--person-id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input)) {
    throw new Error("--person-id must be a UUID");
  }
  return input;
}

/** Runs one explicit assistant conversation binding lifecycle operation. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      action: { type: "string" },
      "conversation-id": { type: "string" },
      "person-id": { type: "string" },
      quiet: { type: "boolean" }
    }
  });
  const selectedAction = action(values.action);
  const selectedPersonId = personId(values["person-id"]);
  const conversationId = values["conversation-id"]?.trim();
  if (selectedAction === "bind") {
    assertExternalConversationId(required(conversationId, "--conversation-id"));
  } else if (conversationId) {
    throw new Error("--conversation-id is accepted only with --action bind");
  }
  const database = createDatabase({
    DATABASE_URL: required(process.env.DATABASE_URL, "DATABASE_URL"),
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: 3_000,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: syntheticPersonId,
    SHUTDOWN_TIMEOUT_MS: 10_000
  });
  try {
    const repository = new ChatAssistantConversationBindingRepository(database);
    if (selectedAction === "inspect") {
      const result = await repository.resolveActive(selectedPersonId, "chatgpt_chat");
      process.stdout.write(`Chat assistant binding ${result.status}.\n`);
      if (result.status !== "active") process.exitCode = 3;
      return;
    }
    const result = selectedAction === "disable"
      ? await repository.disable(selectedPersonId, "chatgpt_chat")
      : await repository.bind(
          selectedPersonId,
          "chatgpt_chat",
          required(conversationId, "--conversation-id")
        );
    process.stdout.write(
      values.quiet
        ? `Chat assistant binding ${result.status}.\n`
        : `Chat assistant binding ${result.status}.\nBinding: ${result.bindingId ?? "none"}\nPerson: ${selectedPersonId}\n`
    );
  } finally {
    await database.pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Chat assistant binding operation failed"}\n`
  );
  process.exitCode = 1;
});

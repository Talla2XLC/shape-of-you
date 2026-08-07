<script setup lang="ts">
import {
  identityRedirectTarget,
  identityRoute,
  readIdentityCsrfCookie
} from "~/lib/browser-security";
import {
  createIdentityApi,
  IdentityApiError,
  type PasskeySummary,
  type SessionSummary
} from "~/lib/identity-api";
import { userMessage } from "~/lib/user-message";
import { registerPasskey } from "~/lib/webauthn";

const config = useRuntimeConfig();
const identityOrigin = String(config.public.identityOrigin);
const api = createIdentityApi();
const passkeys = ref<readonly PasskeySummary[]>([]);
const sessions = ref<readonly SessionSummary[]>([]);
const currentCredentialId = ref<string | null>(null);
const labels = reactive<Record<string, string>>({});
const newLabel = ref("");
const loading = ref(true);
const busyKey = ref<string | null>(null);
const message = ref("");
const messageKind = ref<"error" | "success">("success");

onMounted(async () => {
  const redirect = identityRedirectTarget(identityOrigin, window.location.href);
  if (redirect) {
    window.location.replace(redirect);
    return;
  }
  await refresh();
});

function csrf(): string {
  const value = readIdentityCsrfCookie(document.cookie);
  if (!value) throw new IdentityApiError(403, "csrf_missing");
  return value;
}

function signIn(): void {
  window.location.replace(identityRoute(identityOrigin, "/sign-in"));
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [passkeyResult, sessionResult] = await Promise.all([
      api.listPasskeys(),
      api.listSessions()
    ]);
    passkeys.value = passkeyResult.passkeys;
    sessions.value = sessionResult.sessions;
    currentCredentialId.value = passkeyResult.currentCredentialId;
    for (const passkey of passkeyResult.passkeys) {
      labels[passkey.id] = passkey.label ?? "";
    }
  } catch (error) {
    if (error instanceof IdentityApiError && (error.status === 401 || error.status === 403)) {
      signIn();
      return;
    }
    messageKind.value = "error";
    message.value = userMessage(error);
  } finally {
    loading.value = false;
  }
}

async function addPasskey(): Promise<void> {
  busyKey.value = "add-passkey";
  message.value = "";
  try {
    await registerPasskey(api, {
      csrf: csrf(),
      ...(newLabel.value.trim() ? { label: newLabel.value.trim() } : {})
    });
    newLabel.value = "";
    messageKind.value = "success";
    message.value = "Passkey added.";
    await refresh();
  } catch (error) {
    messageKind.value = "error";
    message.value = userMessage(error);
  } finally {
    busyKey.value = null;
  }
}

async function renamePasskey(passkey: PasskeySummary): Promise<void> {
  const label = labels[passkey.id]?.trim() ?? "";
  if (!label) {
    messageKind.value = "error";
    message.value = "Enter a name before saving.";
    return;
  }
  busyKey.value = `rename-${passkey.id}`;
  message.value = "";
  try {
    await api.renamePasskey(passkey.id, label, csrf());
    messageKind.value = "success";
    message.value = "Passkey name updated.";
    await refresh();
  } catch (error) {
    messageKind.value = "error";
    message.value = userMessage(error);
  } finally {
    busyKey.value = null;
  }
}

async function revokePasskey(passkey: PasskeySummary): Promise<void> {
  if (!window.confirm("Remove this passkey and sessions created with it?")) return;
  busyKey.value = `passkey-${passkey.id}`;
  message.value = "";
  try {
    const result = await api.revokePasskey(passkey.id, csrf());
    if (result.currentSessionRevoked) {
      signIn();
      return;
    }
    messageKind.value = "success";
    message.value = "Passkey removed.";
    await refresh();
  } catch (error) {
    messageKind.value = "error";
    message.value = userMessage(error);
  } finally {
    busyKey.value = null;
  }
}

async function revokeSession(session: SessionSummary): Promise<void> {
  if (!window.confirm(session.current ? "Sign out this session now?" : "Revoke this session?")) return;
  busyKey.value = `session-${session.id}`;
  message.value = "";
  try {
    const result = await api.revokeSession(session.id, csrf());
    if (result.currentSessionRevoked) {
      signIn();
      return;
    }
    messageKind.value = "success";
    message.value = "Session revoked.";
    await refresh();
  } catch (error) {
    messageKind.value = "error";
    message.value = userMessage(error);
  } finally {
    busyKey.value = null;
  }
}

function formatDate(value: string | null): string {
  if (!value) return "Never used";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
</script>

<template>
  <section>
    <div class="security-heading">
      <p class="eyebrow">
        Security
      </p>
      <h1 class="auth-title">
        Devices you trust.
      </h1>
      <p class="lede">
        Review passkeys and active sessions. Identity remains the authority—this
        page reloads its state after every change.
      </p>
      <StatusNotice
        v-if="message"
        :kind="messageKind"
        :message="message"
      />
    </div>

    <p
      v-if="loading"
      class="empty-state"
      role="status"
    >
      Loading security state…
    </p>

    <div
      v-else
      class="security-grid"
    >
      <article class="management-card">
        <p class="eyebrow">
          Authentication methods
        </p>
        <h2>Passkeys</h2>
        <div class="field">
          <label for="new-passkey-label">Name a new passkey (optional)</label>
          <input
            id="new-passkey-label"
            v-model="newLabel"
            maxlength="200"
            autocomplete="off"
            placeholder="Travel phone"
          >
        </div>
        <div class="button-row">
          <button
            class="button compact-button"
            type="button"
            :disabled="busyKey !== null"
            @click="addPasskey"
          >
            Add passkey
          </button>
        </div>

        <ul class="item-list">
          <li
            v-for="passkey in passkeys"
            :key="passkey.id"
            class="security-item"
          >
            <div class="item-title-row">
              <strong>{{ passkey.label || "Unnamed passkey" }}</strong>
              <span
                v-if="passkey.id === currentCredentialId"
                class="badge"
              >Current</span>
            </div>
            <p class="item-meta">
              {{ passkey.deviceType }} · {{ passkey.backedUp ? "Synced" : "Device-bound" }}<br>
              Last used: {{ formatDate(passkey.lastUsedAt) }}
            </p>
            <form
              class="field"
              @submit.prevent="renamePasskey(passkey)"
            >
              <label :for="`label-${passkey.id}`">Rename passkey</label>
              <input
                :id="`label-${passkey.id}`"
                v-model="labels[passkey.id]"
                maxlength="200"
                autocomplete="off"
              >
              <div class="button-row">
                <button
                  class="button button-secondary compact-button"
                  type="submit"
                  :disabled="busyKey !== null"
                >
                  Save name
                </button>
                <button
                  class="button button-danger compact-button"
                  type="button"
                  :disabled="busyKey !== null"
                  @click="revokePasskey(passkey)"
                >
                  Remove
                </button>
              </div>
            </form>
          </li>
        </ul>
      </article>

      <article class="management-card">
        <p class="eyebrow">
          Account access
        </p>
        <h2>Active sessions</h2>
        <p
          v-if="sessions.length === 0"
          class="empty-state"
        >
          No active sessions.
        </p>
        <ul
          v-else
          class="item-list"
        >
          <li
            v-for="session in sessions"
            :key="session.id"
            class="security-item"
          >
            <div class="item-title-row">
              <strong>{{ session.current ? "This browser" : "Passkey session" }}</strong>
              <span
                v-if="session.current"
                class="badge"
              >Current</span>
            </div>
            <p class="item-meta">
              Last active: {{ formatDate(session.lastActivityAt) }}<br>
              Expires after inactivity: {{ formatDate(session.expiresAt) }}
            </p>
            <div class="button-row">
              <button
                class="button button-danger compact-button"
                type="button"
                :disabled="busyKey !== null"
                @click="revokeSession(session)"
              >
                {{ session.current ? "Sign out" : "Revoke" }}
              </button>
            </div>
          </li>
        </ul>
      </article>
    </div>
  </section>
</template>

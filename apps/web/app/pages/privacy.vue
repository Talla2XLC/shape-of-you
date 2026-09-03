<script setup lang="ts">
import {
  recoveryPrivacyApi,
  type RecoveryConnectionSummary,
  type RecoveryErasureSummary
} from "~/lib/recovery-privacy";
import { userMessage } from "~/lib/user-message";

definePageMeta({ middleware: "api-session" });

const route = useRoute();
const connections = ref<readonly RecoveryConnectionSummary[]>([]);
const erasure = ref<RecoveryErasureSummary | null>(null);
const confirmedConnectionId = ref<string | null>(null);
const busy = ref(false);
const loading = ref(true);
const message = ref("");

onMounted(async () => {
  try {
    const requestId = typeof route.query.erasureRequestId === "string"
      ? route.query.erasureRequestId
      : null;
    const [connectionResult, requestResult] = await Promise.all([
      recoveryPrivacyApi.listConnections(),
      requestId ? recoveryPrivacyApi.getErasureRequest(requestId) : Promise.resolve(null)
    ]);
    connections.value = connectionResult.items;
    erasure.value = requestResult;
  } catch (error) {
    message.value = userMessage(error);
  } finally {
    loading.value = false;
  }
});

async function eraseConnection(connection: RecoveryConnectionSummary): Promise<void> {
  if (confirmedConnectionId.value !== connection.id) return;
  busy.value = true;
  message.value = "";
  try {
    const result = await recoveryPrivacyApi.startErasure(connection.id);
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    message.value = userMessage(error);
    busy.value = false;
  }
}

function formatDate(value: string | null): string {
  if (!value) return "Not completed yet";
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
        Privacy
      </p>
      <h1 class="auth-title">
        Your wearable data.
      </h1>
      <p class="lede">
        Disconnecting stops new collection. Erasing permanently removes the
        selected connection's imported observations and every derived Recovery
        or Coaching result that depends on them.
      </p>
      <StatusNotice
        v-if="message"
        kind="error"
        :message="message"
      />
      <StatusNotice
        v-if="erasure"
        kind="success"
        :message="erasure.status === 'completed'
          ? `Erasure completed ${formatDate(erasure.completedAt)}.`
          : 'The connection is blocked now. Permanent erasure is processing safely.'"
      />
    </div>

    <p
      v-if="loading"
      class="empty-state"
      role="status"
    >
      Loading privacy state…
    </p>
    <p
      v-else-if="connections.length === 0"
      class="empty-state"
    >
      No wearable connections.
    </p>
    <div
      v-else
      class="security-grid"
    >
      <article
        v-for="connection in connections"
        :key="connection.id"
        class="management-card"
      >
        <p class="eyebrow">
          Wearable connection
        </p>
        <h2>{{ connection.device.label || connection.device.modelVersion.name }}</h2>
        <p class="item-meta">
          {{ connection.device.modelVersion.providerName }} · Connected
          {{ formatDate(connection.connectedAt) }}
        </p>
        <p
          v-if="connection.erasureRequestedAt"
          class="empty-state"
          role="status"
        >
          Erasure requested {{ formatDate(connection.erasureRequestedAt) }}.
          This connection is already blocked.
        </p>
        <template v-else>
          <div class="privacy-warning">
            This cannot be undone. Manual reports that were not collected through
            this connection stay in your profile.
          </div>
          <label class="privacy-confirmation">
            <input
              type="checkbox"
              :checked="confirmedConnectionId === connection.id"
              :disabled="busy"
              @change="confirmedConnectionId = confirmedConnectionId === connection.id ? null : connection.id"
            >
            I understand that this connection's wearable history will be erased.
          </label>
          <button
            class="button button-danger compact-button"
            type="button"
            :disabled="busy || confirmedConnectionId !== connection.id"
            @click="eraseConnection(connection)"
          >
            Confirm with passkey and erase
          </button>
        </template>
      </article>
    </div>
  </section>
</template>

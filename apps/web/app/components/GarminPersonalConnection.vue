<script setup lang="ts">
import {
  garminPersonalApi,
  garminPersonalFailureReason,
  garminPersonalRequestMessage,
  integrationApi,
  type GarminPersonalStatus
} from "~/lib/integration-api";

const status = ref<GarminPersonalStatus | null>(null);
const busy = ref(false);
const message = ref("");
const apiKey = ref("");
const editing = ref(false);
const connected = computed(() => status.value?.lifecycle === "active" || status.value?.lifecycle === "degraded");
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let disposed = false;
let requestGeneration = 0;

async function refresh(silent = false): Promise<void> {
  if (busy.value) return;
  const generation = ++requestGeneration;
  try {
    const result = await garminPersonalApi.status();
    if (!disposed && generation === requestGeneration) status.value = result;
  } catch (error) {
    if (!silent && !disposed && generation === requestGeneration) message.value = garminPersonalRequestMessage(error);
  }
}

onMounted(async () => {
  await refresh();
  if (!disposed) refreshTimer = setInterval(() => void refresh(true), 30_000);
});

onBeforeUnmount(() => {
  disposed = true;
  apiKey.value = "";
  if (refreshTimer) clearInterval(refreshTimer);
});

function cancel(): void {
  apiKey.value = "";
  editing.value = false;
  message.value = "";
}

async function connect(): Promise<void> {
  if (busy.value || !apiKey.value.trim()) return;
  const generation = ++requestGeneration;
  busy.value = true;
  message.value = "";
  try {
    const result = await garminPersonalApi.connect(apiKey.value.trim());
    if (!disposed && generation === requestGeneration) {
      status.value = result;
      apiKey.value = "";
      editing.value = false;
    }
  } catch (error) {
    if (!disposed && generation === requestGeneration) message.value = garminPersonalRequestMessage(error);
  } finally {
    if (!disposed && generation === requestGeneration) busy.value = false;
  }
}

async function disconnect(): Promise<void> {
  if (busy.value) return;
  const generation = ++requestGeneration;
  busy.value = true;
  message.value = "";
  apiKey.value = "";
  editing.value = false;
  try {
    const result = await garminPersonalApi.disconnect();
    if (!disposed && generation === requestGeneration) status.value = result;
  } catch (error) {
    if (!disposed && generation === requestGeneration) message.value = garminPersonalRequestMessage(error);
  } finally {
    if (!disposed && generation === requestGeneration) busy.value = false;
  }
}

async function importHistory(): Promise<void> {
  if (busy.value) return;
  if (!window.confirm("Import all available Garmin training and wellness history? This may take some time.")) return;
  const generation = ++requestGeneration;
  busy.value = true;
  message.value = "";
  try {
    const result = await garminPersonalApi.startHistoricalImport();
    if (!disposed && generation === requestGeneration) status.value = result;
  } catch (error) {
    if (!disposed && generation === requestGeneration) message.value = garminPersonalRequestMessage(error);
  } finally {
    if (!disposed && generation === requestGeneration) busy.value = false;
  }
}

async function erase(): Promise<void> {
  if (busy.value || !status.value?.recoveryConnectionId) return;
  const generation = ++requestGeneration;
  busy.value = true;
  message.value = "";
  apiKey.value = "";
  try {
    const result = await integrationApi.startErasure(status.value.recoveryConnectionId);
    if (!disposed && generation === requestGeneration) window.location.assign(result.authorizationUrl);
  } catch (error) {
    if (!disposed && generation === requestGeneration) {
      message.value = garminPersonalRequestMessage(error);
      busy.value = false;
    }
  }
}

function formatted(value: string | null): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
</script>

<template>
  <article
    class="management-card"
    aria-labelledby="garmin-personal-title"
    :aria-busy="busy"
  >
    <p class="eyebrow">
      Direct connection
    </p>
    <h2 id="garmin-personal-title">
      Garmin
    </h2>
    <p class="item-meta">
      Bring your own Garmin training and wellness data into Shape of You.
    </p>
    <StatusNotice
      v-if="message"
      kind="error"
      :message="message"
    />
    <p v-if="!status && !message">
      Loading Garmin connection…
    </p>
    <p v-else-if="status?.lifecycle === 'unavailable'">
      Direct Garmin connection is currently unavailable.
    </p>
    <template v-else-if="status">
      <p
        v-if="connected"
        role="status"
      >
        <template v-if="status.lifecycle === 'degraded'">
          Garmin needs attention. {{ garminPersonalFailureReason(status.failureCode) }}
        </template>
        <template v-else-if="!status.lastDataAt">
          Connected, no data yet.
        </template>
        <template v-else>
          Connected. Your Garmin data syncs automatically.
        </template>
      </p>
      <p v-else-if="status.lifecycle === 'connecting'">
        Garmin access is prepared. Review the transition status for its start date.
      </p>
      <p v-else>
        Garmin is not connected.
      </p>
      <template v-if="connected || status.connectedAt">
        <p class="item-meta">
          Garmin last sync attempt: {{ formatted(status.lastAttemptAt) }}
        </p>
        <p class="item-meta">
          Garmin last successful sync: {{ formatted(status.lastSuccessfulSyncAt) }}
        </p>
        <p class="item-meta">
          Garmin last new data: {{ formatted(status.lastDataAt) }}
        </p>
      </template>
      <form
        v-if="(!connected && status.lifecycle !== 'connecting') || editing"
        autocomplete="off"
        @submit.prevent="connect"
      >
        <p class="item-meta">
          <a
            href="https://connect.garmin.com/app/settings/personalApiToken"
            target="_blank"
            rel="noreferrer noopener"
          >Create a personal API key in Garmin</a>, then paste it here. Your Garmin password is never needed.
        </p>
        <div class="field">
          <label for="garmin-personal-key">Garmin personal API key</label>
          <input
            id="garmin-personal-key"
            v-model="apiKey"
            type="password"
            name="garmin-personal-key"
            autocomplete="off"
            autocapitalize="none"
            :spellcheck="false"
            maxlength="4096"
            required
            :disabled="busy"
            aria-describedby="garmin-personal-consent"
          >
        </div>
        <p
          id="garmin-personal-consent"
          class="item-meta"
        >
          By connecting, you allow Shape of You to read and sync your Garmin training and wellness data.
          Your key is stored securely and is never shown again.
        </p>
        <div class="button-row">
          <button
            class="button compact-button"
            type="submit"
            :disabled="busy || !apiKey.trim()"
          >
            {{ busy ? "Connecting…" : connected ? "Update Garmin key" : "Connect Garmin" }}
          </button>
          <button
            class="button button-secondary compact-button"
            type="button"
            :disabled="busy"
            @click="cancel"
          >
            Cancel
          </button>
        </div>
      </form>
      <div
        v-if="connected && !editing"
        class="connection-actions"
      >
        <button
          class="button button-secondary compact-button"
          type="button"
          :disabled="busy"
          @click="editing = true"
        >
          Update Garmin key
        </button>
        <button
          class="button button-secondary compact-button"
          type="button"
          :disabled="busy"
          @click="disconnect"
        >
          Disconnect Garmin
        </button>
      </div>
      <p
        v-if="status.recoveryConnectionId"
        class="item-meta"
      >
        Disconnecting stops new imports and removes the key from Shape of You. Your imported history stays.
        You can also revoke the personal API key in Garmin settings.
      </p>
      <div
        v-if="connected"
        class="historical-import"
        aria-live="polite"
      >
        <h3>Garmin history</h3>
        <p
          v-if="status.historicalImport.scopeFromDate && status.historicalImport.scopeFromDate !== '2000-01-01'"
          class="item-meta"
        >
          Garmin history begins on {{ status.historicalImport.scopeFromDate }}. Earlier history keeps its existing source.
        </p>
        <p
          v-if="status.historicalImport.status === 'running'"
          class="item-meta"
        >
          Importing Garmin history.<template v-if="status.historicalImport.processedThroughDate">
            Checked back through {{ status.historicalImport.processedThroughDate }}.
          </template>
          {{ garminPersonalFailureReason(status.historicalImport.failureCode) }}
        </p>
        <p
          v-else-if="status.historicalImport.status === 'completed'"
          class="item-meta"
        >
          Garmin history import completed {{ formatted(status.historicalImport.completedAt) }}.
        </p>
        <p
          v-else-if="status.historicalImport.status === 'failed'"
          class="item-meta"
        >
          Garmin history import stopped. {{ garminPersonalFailureReason(status.historicalImport.failureCode) }}
        </p>
        <p
          v-else
          class="item-meta"
        >
          Older history is imported only when you request it.
        </p>
        <button
          class="button button-secondary compact-button"
          type="button"
          :disabled="busy || status.historicalImport.status === 'running'"
          @click="importHistory"
        >
          {{ status.historicalImport.status === "running" ? "Importing Garmin history…" : "Import Garmin history…" }}
        </button>
      </div>
      <section
        v-if="status.recoveryConnectionId"
        class="connection-danger-zone"
        aria-labelledby="garmin-personal-erasure-title"
      >
        <h3 id="garmin-personal-erasure-title">
          Delete Garmin imported data
        </h3>
        <p class="item-meta">
          Permanently remove data imported through this connection. Fresh passkey confirmation is required.
        </p>
        <button
          class="button button-danger-outline compact-button"
          type="button"
          :disabled="busy"
          @click="erase"
        >
          Delete Garmin imported data…
        </button>
      </section>
    </template>
  </article>
</template>

<script setup lang="ts">
import {
  garminPersonalApi,
  garminPersonalFailureReason,
  garminPersonalRequestMessage,
  type GarminPersonalStatus
} from "~/lib/integration-api";

const status = ref<GarminPersonalStatus | null>(null);
const busy = ref(false);
const message = ref("");
const apiKey = ref("");
const editing = ref(false);
const requestedAfterAttempt = ref<string | null | undefined>(undefined);
const syncResult = ref("");
const connected = computed(() => status.value?.lifecycle === "active" || status.value?.lifecycle === "degraded");
const syncPending = computed(() => requestedAfterAttempt.value !== undefined || status.value?.sync?.state === "queued" || status.value?.sync?.state === "running");
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
  let nextIdleRefresh = Date.now() + 30_000;
  if (!disposed) refreshTimer = setInterval(() => {
    if (syncPending.value || Date.now() >= nextIdleRefresh) {
      nextIdleRefresh = Date.now() + 30_000;
      void refresh(true);
    }
  }, 5_000);
});

watch(() => [status.value?.lastAttemptAt, status.value?.sync?.state], () => {
  const current = status.value;
  if (current?.sync?.state === "running" || current?.sync?.state === "queued" || current?.sync?.state === "blocked") syncResult.value = "";
  if (!current || requestedAfterAttempt.value === undefined || current.sync?.state === "running" || current.sync?.state === "queued") return;
  if (current.sync?.state === "blocked") {
    requestedAfterAttempt.value = undefined;
    syncResult.value = "Sync is unavailable. Check the connection status and Garmin key.";
  } else if (current.lastAttemptAt && current.lastAttemptAt !== requestedAfterAttempt.value) {
    requestedAfterAttempt.value = undefined;
    syncResult.value = current.failureCode ? `Sync did not complete. ${garminPersonalFailureReason(current.failureCode)}`
      : current.lastSuccessfulSyncAt === current.lastAttemptAt ? "Sync completed successfully."
      : "Sync checked available data, but some imports remain incomplete. An automatic retry is scheduled.";
  }
});

async function syncNow(): Promise<void> {
  if (busy.value || syncPending.value || status.value?.sync?.state !== "scheduled") return;
  const generation = ++requestGeneration;
  requestedAfterAttempt.value = status.value.lastAttemptAt;
  syncResult.value = "";
  message.value = "";
  busy.value = true;
  try {
    const result = await garminPersonalApi.sync();
    if (!disposed && generation === requestGeneration) status.value = result;
  } catch {
    if (!disposed && generation === requestGeneration) {
      requestedAfterAttempt.value = undefined;
      message.value = "The sync request could not be confirmed. Check the connection status before trying again.";
    }
  } finally {
    if (!disposed && generation === requestGeneration) busy.value = false;
  }
}

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
  requestedAfterAttempt.value = undefined;
  syncResult.value = "";
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
  requestedAfterAttempt.value = undefined;
  syncResult.value = "";
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
    const result = await garminPersonalApi.startErasure(status.value.recoveryConnectionId);
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
    class="management-card garmin-connection"
    aria-labelledby="garmin-personal-title"
    :aria-busy="busy"
  >
    <header class="garmin-connection-heading">
      <h2 id="garmin-personal-title">
        Garmin
      </h2>
      <p class="item-meta">
        Your Garmin account connects directly to Shape of You.
      </p>
    </header>
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
        <template v-if="status.sync?.state === 'running'">
          Connected. Syncing with Garmin…
        </template>
        <template v-else-if="status.sync?.state === 'queued'">
          Connected. Waiting to sync with Garmin…
        </template>
        <template v-else-if="status.lifecycle === 'degraded'">
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
        Garmin access is being prepared. This page updates automatically.
      </p>
      <p v-else>
        Garmin is not connected.
      </p>
      <dl
        v-if="connected || status.connectedAt"
        class="garmin-sync-details"
      >
        <div><dt>Last successful sync</dt><dd>{{ formatted(status.lastSuccessfulSyncAt) }}</dd></div>
        <div><dt>Last new data</dt><dd>{{ formatted(status.lastDataAt) }}</dd></div>
        <div><dt>Last sync attempt</dt><dd>{{ formatted(status.lastAttemptAt) }}</dd></div>
      </dl>
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
          By connecting, you allow Shape of You to read and sync your Garmin wellness and recovery, training, weight and body composition, nutrition and hydration data.
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
          class="button compact-button"
          type="button"
          :disabled="busy || syncPending || status.sync?.state !== 'scheduled'"
          aria-describedby="garmin-sync-progress"
          @click="syncNow"
        >
          {{ status.sync?.state === 'running' ? 'Syncing…' : syncPending ? 'Sync requested…' : 'Sync now' }}
        </button>
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
        v-if="connected"
        id="garmin-sync-progress"
        class="item-meta"
        aria-live="polite"
      >
        <template v-if="syncResult">
          {{ syncResult }}
        </template>
        <template v-else-if="status.sync?.state === 'running'">
          Import is in progress. This page updates automatically.
        </template>
        <template v-else-if="status.sync?.state === 'queued'">
          Your sync is queued. This page updates automatically.
        </template>
        <template v-else-if="status.sync?.state === 'scheduled'">
          {{ syncPending ? 'Sync requested. Next attempt:' : 'Next automatic sync:' }} {{ formatted(status.sync.nextAttemptAt) }}
        </template>
        <template v-else-if="status.sync?.state === 'blocked'">
          Sync is unavailable. Check your Garmin access.
        </template>
        <template v-else>
          Sync status is temporarily unavailable. This page will retry automatically.
        </template>
      </p>
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
          Garmin imports cover dates from {{ status.historicalImport.scopeFromDate }}. Your earlier history is preserved.
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

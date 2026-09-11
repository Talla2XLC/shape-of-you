<script setup lang="ts">
import {
  integrationApi,
  integrationAuthorizationResultMessage,
  integrationFailureReason,
  type GarminIntervalsStatus
} from "~/lib/integration-api";
import { userMessage } from "~/lib/user-message";

definePageMeta({ middleware: "api-session" });

const status = ref<GarminIntervalsStatus | null>(null);
const busy = ref(false);
const message = ref("");
const route = useRoute();
let statusRefreshTimer: ReturnType<typeof setInterval> | undefined;

async function refreshStatus(silent = false): Promise<void> {
  if (busy.value) return;
  try { status.value = await integrationApi.status(); }
  catch (error) { if (!silent) message.value = userMessage(error); }
}

onMounted(async () => {
  message.value = integrationAuthorizationResultMessage(route.query.provider) ?? "";
  if (route.query.provider !== undefined) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("provider");
    window.history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }
  await refreshStatus();
  statusRefreshTimer = setInterval(() => void refreshStatus(true), 30_000);
});

onBeforeUnmount(() => { if (statusRefreshTimer) clearInterval(statusRefreshTimer); });

async function connect(): Promise<void> {
  busy.value = true;
  message.value = "";
  try {
    const result = await integrationApi.start();
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    message.value = userMessage(error);
    busy.value = false;
  }
}

async function disconnect(): Promise<void> {
  busy.value = true;
  message.value = "";
  try { status.value = await integrationApi.disconnect(); }
  catch (error) { message.value = userMessage(error); }
  finally { busy.value = false; }
}

async function importHistoricalData(): Promise<void> {
  if (!window.confirm("Import all available historical Activity and Wellness data from Intervals.icu? This may take some time.")) return;
  busy.value = true;
  message.value = "";
  try { status.value = await integrationApi.startHistoricalImport(); }
  catch (error) { message.value = userMessage(error); }
  finally { busy.value = false; }
}

async function erase(): Promise<void> {
  if (!status.value?.recoveryConnectionId) return;
  busy.value = true;
  message.value = "";
  try {
    const result = await integrationApi.startErasure(status.value.recoveryConnectionId);
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    message.value = userMessage(error);
    busy.value = false;
  }
}

function formatted(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function historicalActionLabel(value: GarminIntervalsStatus["historicalImport"]["status"] | undefined): string {
  if (value === "running") return "Importing historical data…";
  if (value === "failed") return "Retry historical import…";
  if (value === "completed") return "Import historical data again…";
  return "Import historical data…";
}
</script>

<template>
  <section>
    <p class="eyebrow">
      Connections
    </p>
    <h1 class="auth-title">
      Garmin via Intervals.icu
    </h1>
    <p class="lede">
      First connect Garmin inside Intervals.icu using Garmin's authorization page.
      Then allow Shape of You to read Activity and Wellness from Intervals.icu.
      Shape of You never receives your Garmin password or Garmin token.
    </p>
    <StatusNotice
      v-if="message"
      kind="error"
      :message="message"
    />

    <article class="management-card">
      <p class="eyebrow">
        Connection status
      </p>
      <h2>
        {{ status?.lifecycle || "Loading…" }}
      </h2>
      <p class="item-meta">
        Last attempt: {{ formatted(status?.lastAttemptAt ?? null) }}
      </p>
      <p class="item-meta">
        Last successful sync: {{ formatted(status?.lastSuccessfulSyncAt ?? null) }}
      </p>
      <p class="item-meta">
        Last new data: {{ formatted(status?.lastDataAt ?? null) }}
      </p>
      <p
        v-if="status?.lifecycle === 'degraded'"
        role="status"
        class="privacy-warning"
      >
        Previously imported data is safe. Automatic synchronization will retry.
        {{ integrationFailureReason(status.failureCode) }}
      </p>
      <p class="item-meta">
        Wellness records are attributed to Intervals.icu and may include Garmin.
        An activity is labelled Garmin only when its device metadata confirms Garmin.
      </p>
      <div
        v-if="status?.lifecycle === 'active' || status?.lifecycle === 'degraded'"
        class="historical-import"
      >
        <h3>
          Historical data
        </h3>
        <p
          v-if="status.historicalImport.status === 'not_requested'"
          class="item-meta"
        >
          Not imported. Current data continues to sync automatically.
        </p>
        <p
          v-else-if="status.historicalImport.status === 'running' && status.historicalImport.failureCode"
          class="item-meta"
          role="status"
        >
          Historical import is temporarily paused. {{ integrationFailureReason(status.historicalImport.failureCode) }}
          It will retry automatically; already imported data is safe.
        </p>
        <p
          v-else-if="status.historicalImport.status === 'running'"
          class="item-meta"
          role="status"
        >
          Import in progress.<template v-if="status.historicalImport.processedThroughDate">
            Checked back through {{ status.historicalImport.processedThroughDate }}.
          </template>
        </p>
        <p
          v-else-if="status.historicalImport.status === 'completed'"
          class="item-meta"
          role="status"
        >
          Import completed {{ formatted(status.historicalImport.completedAt) }}.
        </p>
        <p
          v-else
          class="item-meta"
          role="status"
        >
          Historical import stopped safely. Already imported data is safe.
          {{ integrationFailureReason(status.historicalImport.failureCode) }}
        </p>
        <button
          class="button button-secondary compact-button"
          type="button"
          :disabled="busy || status.historicalImport.status === 'running'"
          @click="importHistoricalData"
        >
          {{ historicalActionLabel(status.historicalImport.status) }}
        </button>
      </div>
      <div class="connection-actions">
        <button
          v-if="status?.lifecycle !== 'active' && status?.lifecycle !== 'degraded'"
          class="button"
          type="button"
          :disabled="busy || status?.lifecycle === 'unavailable'"
          @click="connect"
        >
          Connect Garmin via Intervals.icu
        </button>
        <button
          v-else
          class="button"
          type="button"
          :disabled="busy"
          @click="disconnect"
        >
          Disconnect
        </button>
      </div>
      <section
        v-if="status?.recoveryConnectionId"
        class="connection-danger-zone"
        aria-labelledby="connection-danger-title"
      >
        <h3 id="connection-danger-title">
          Danger zone
        </h3>
        <p class="item-meta">
          Permanently deletes data imported through this connection. Passkey confirmation is required.
        </p>
        <button
          class="button button-danger-outline compact-button"
          type="button"
          :disabled="busy"
          @click="erase"
        >
          Delete imported data…
        </button>
      </section>
    </article>
  </section>
</template>

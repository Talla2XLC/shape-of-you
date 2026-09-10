<script setup lang="ts">
import { integrationApi, integrationFailureReason, type GarminIntervalsStatus } from "~/lib/integration-api";
import { userMessage } from "~/lib/user-message";

definePageMeta({ middleware: "api-session" });

const status = ref<GarminIntervalsStatus | null>(null);
const busy = ref(false);
const message = ref("");

onMounted(async () => {
  try { status.value = await integrationApi.status(); }
  catch (error) { message.value = userMessage(error); }
});

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
        <button
          v-if="status?.recoveryConnectionId"
          class="button button-danger"
          type="button"
          :disabled="busy"
          @click="erase"
        >
          Confirm with passkey and delete imported data
        </button>
      </div>
    </article>
  </section>
</template>

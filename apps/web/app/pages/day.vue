<script setup lang="ts">
import { beginBrowserSignIn } from "~/lib/browser-auth";
import { dayApi, type DailyProjection, type DayClosureHistory, DayApiError } from "~/lib/day-api";

definePageMeta({ middleware: "api-session" });
useHead({ bodyAttrs: { class: "page-day" } });

const route = useRoute();

const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const requestedTimezone = typeof route.query.timezone === "string"
  && route.query.timezone.length <= 128
  && isValidTimezone(route.query.timezone)
  ? route.query.timezone
  : null;
const timezone = requestedTimezone ?? browserTimezone;
const requestedDate = typeof route.query.date === "string"
  && /^\d{4}-\d{2}-\d{2}$/u.test(route.query.date)
  ? route.query.date
  : null;
const localDate = ref(
  requestedDate ?? new Date().toLocaleDateString("en-CA", { timeZone: timezone })
);
const projection = ref<DailyProjection | null>(null);
const history = ref<DayClosureHistory | null>(null);
const reason = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

async function load(): Promise<void> {
  busy.value = true; error.value = null;
  try {
    const [nextProjection, nextHistory] = await Promise.all([
      dayApi.projection(localDate.value, timezone),
      dayApi.history(localDate.value, timezone)
    ]);
    projection.value = nextProjection;
    history.value = nextHistory;
  } catch (caught) {
    if (caught instanceof DayApiError && caught.status === 401) {
      beginBrowserSignIn(route.fullPath);
      return;
    }
    error.value = "The daily projection is unavailable.";
  }
  finally { busy.value = false; }
}
async function closeDay(): Promise<void> {
  if (!confirm("Close this day? Its current summary will be saved as an immutable version.")) return;
  busy.value = true; error.value = null;
  try { await dayApi.close(localDate.value, timezone); await load(); } catch (caught) {
    if (caught instanceof DayApiError && caught.status === 401) beginBrowserSignIn(route.fullPath);
    else error.value = "The day could not be closed. Refresh and try again.";
  } finally { busy.value = false; }
}
async function reopenDay(): Promise<void> {
  if (!reason.value.trim()) { error.value = "Explain why this day is being reopened."; return; }
  busy.value = true; error.value = null;
  try { await dayApi.reopen(localDate.value, reason.value.trim()); reason.value = ""; await load(); } catch (caught) {
    if (caught instanceof DayApiError && caught.status === 401) beginBrowserSignIn(route.fullPath);
    else error.value = "The day could not be reopened.";
  } finally { busy.value = false; }
}
onMounted(load);
</script>

<template>
  <section class="hero day-view">
    <div class="day-content">
      <p class="eyebrow">
        Daily record
      </p>
      <h1 class="day-heading">
        Your day, with its context intact.
      </h1>
      <label class="field day-date">Date
        <input
          v-model="localDate"
          type="date"
          @change="load"
        >
      </label>
      <p
        v-if="busy"
        role="status"
      >
        Loading…
      </p>
      <p
        v-if="error"
        role="alert"
        class="notice-error"
      >
        {{ error }}
      </p>
      <template v-if="projection">
        <p class="lede">
          Status: <strong>{{ projection.state }}</strong>.
          {{ projection.isStale ? "New or corrected data needs your review." : "" }}
        </p>
        <div class="signal-card day-card">
          <div class="signal-copy">
            <strong>Weight</strong>
            <span>{{ projection.snapshot.physical.weightMeasurements.at(0)?.weightKg ?? "No measurement" }}</span>
            <strong>Nutrition</strong>
            <span>{{ projection.snapshot.nutrition.totals.mealCount }} meals · {{ projection.snapshot.nutrition.totals.caloriesKcal }} kcal</span>
          </div>
        </div>
        <button
          v-if="projection.state === 'open'"
          class="button day-action"
          :disabled="busy"
          @click="closeDay"
        >
          Close day
        </button>
        <template v-else>
          <label class="field">Reason to reopen
            <input
              v-model="reason"
              maxlength="512"
            >
          </label>
          <button
            class="button day-action"
            :disabled="busy"
            @click="reopenDay"
          >
            Reopen day
          </button>
        </template>
        <section
          v-if="history?.items.length"
          class="signal-card day-card"
          aria-label="Day closure history"
        >
          <div class="signal-copy">
            <strong>Closure history</strong>
            <span
              v-for="item in history.items"
              :key="item.id"
            >Version {{ item.version }} · {{ item.status }} · {{ new Date(item.closedAt).toLocaleString() }}<template v-if="item.reopenReason"> · reopened: {{ item.reopenReason }}</template></span>
          </div>
        </section>
      </template>
    </div>
  </section>
</template>

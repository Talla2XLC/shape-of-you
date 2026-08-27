<script setup lang="ts">
import { beginBrowserSignIn } from "~/lib/browser-auth";
import { dayApi, type DailyProjection, type DayClosureHistory, DayApiError } from "~/lib/day-api";
import { dayRoute, isIanaTimezone, isLocalDate } from "~/lib/progress";

definePageMeta({ middleware: "api-session" });
useHead({ bodyAttrs: { class: "page-day" } });
const route = useRoute();
const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const timezone = computed<string>(() => {
  const requested = route.query.timezone;
  return isIanaTimezone(requested) ? requested : browserTimezone;
});
const rawDate = computed<string>(() => {
  const requested = Array.isArray(route.params.localDate) ? route.params.localDate[0] : route.params.localDate;
  return requested ?? "";
});
const validDate = computed(() => isLocalDate(rawDate.value));
const localDate = ref(validDate.value ? rawDate.value : "");
const projection = ref<DailyProjection | null>(null);
const history = ref<DayClosureHistory | null>(null);
const reason = ref("");
const error = ref<string | null>(validDate.value ? null : "Choose a valid calendar date.");
const busy = ref(false);

async function load(): Promise<void> {
  if (!validDate.value) return;
  busy.value = true; error.value = null;
  try { [projection.value, history.value] = await Promise.all([dayApi.projection(localDate.value, timezone.value), dayApi.history(localDate.value, timezone.value)]); }
  catch (caught) {
    if (caught instanceof DayApiError && caught.status === 401) { beginBrowserSignIn(route.fullPath); return; }
    error.value = "The daily projection is unavailable.";
  } finally { busy.value = false; }
}
function changeDate(): void { if (isLocalDate(localDate.value)) void navigateTo(dayRoute(localDate.value, timezone.value)); }
async function closeDay(): Promise<void> {
  if (!confirm("Close this day? Its current summary will be saved as an immutable version.")) return;
  busy.value = true; error.value = null;
  try { await dayApi.close(localDate.value, timezone.value); await load(); }
  catch (caught) { if (caught instanceof DayApiError && caught.status === 401) beginBrowserSignIn(route.fullPath); else error.value = "The day could not be closed. Refresh and try again."; }
  finally { busy.value = false; }
}
async function reopenDay(): Promise<void> {
  if (!reason.value.trim()) { error.value = "Explain why this day is being reopened."; return; }
  busy.value = true; error.value = null;
  try { await dayApi.reopen(localDate.value, reason.value.trim()); reason.value = ""; await load(); }
  catch (caught) { if (caught instanceof DayApiError && caught.status === 401) beginBrowserSignIn(route.fullPath); else error.value = "The day could not be reopened."; }
  finally { busy.value = false; }
}
watch(() => route.fullPath, async () => {
  projection.value = null;
  history.value = null;
  localDate.value = validDate.value ? rawDate.value : "";
  error.value = validDate.value ? null : "Choose a valid calendar date.";
  await load();
});
onMounted(load);
</script>

<template>
  <section class="hero day-view">
    <div class="day-content">
      <p class="eyebrow">
        Daily record
      </p><h1 class="day-heading">
        Your day, with its context intact.
      </h1>
      <label class="field day-date">Date <input
        v-model="localDate"
        type="date"
        @change="changeDate"
      ></label>
      <p
        v-if="busy"
        role="status"
      >
        Loading…
      </p><p
        v-if="error"
        role="alert"
        class="notice-error"
      >
        {{ error }}
      </p>
      <template v-if="projection">
        <p class="lede">
          Status: <strong>{{ projection.state }}</strong>. {{ projection.isStale ? "New or corrected data needs your review." : "" }}
        </p>
        <div class="signal-card day-card">
          <div class="signal-copy">
            <strong>Weight</strong><span>{{ projection.snapshot.physical.weightMeasurements.at(0)?.weightKg ?? "No measurement" }}</span><strong>Nutrition</strong><span>{{ projection.snapshot.nutrition.totals.mealCount }} meals · {{ projection.snapshot.nutrition.totals.caloriesKcal }} kcal</span>
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
        <template v-else-if="projection.state === 'closed' || projection.state === 'stale'">
          <label class="field">Reason to reopen <input
            v-model="reason"
            maxlength="512"
          ></label><button
            class="button day-action"
            :disabled="busy"
            @click="reopenDay"
          >
            Reopen day
          </button>
        </template>
        <p
          v-else
          role="alert"
          class="notice-error"
        >
          This day version is not active. No changes are available.
        </p>
        <section
          v-if="history?.items.length"
          class="signal-card day-card"
          aria-label="Day closure history"
        >
          <div class="signal-copy">
            <strong>Closure history</strong><span
              v-for="item in history.items"
              :key="item.id"
            >Version {{ item.version }} · {{ item.status }} · {{ new Date(item.closedAt).toLocaleString() }}<template v-if="item.reopenReason"> · reopened: {{ item.reopenReason }}</template></span>
          </div>
        </section>
      </template>
    </div>
  </section>
</template>

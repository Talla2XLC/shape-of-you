<script setup lang="ts">
import { beginBrowserSignIn } from "~/lib/browser-auth";
import { dayApi, type DailyProjection, DayApiError } from "~/lib/day-api";
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
const error = ref<string | null>(validDate.value ? null : "Choose a valid calendar date.");
const busy = ref(false);

async function load(): Promise<void> {
  if (!validDate.value) return;
  busy.value = true; error.value = null;
  try { projection.value = await dayApi.projection(localDate.value, timezone.value); }
  catch (caught) {
    if (caught instanceof DayApiError && caught.status === 401) { beginBrowserSignIn(route.fullPath); return; }
    error.value = "The daily projection is unavailable.";
  } finally { busy.value = false; }
}
function changeDate(): void { if (isLocalDate(localDate.value)) void navigateTo(dayRoute(localDate.value, timezone.value)); }
watch(() => route.fullPath, async () => {
  projection.value = null;
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
          Current recorded facts as of {{ new Date(projection.asOf).toLocaleString() }}.
        </p>
        <div class="signal-card day-card">
          <div class="signal-copy">
            <strong>Weight</strong><span>{{ projection.snapshot.physical.weightMeasurements.at(0)?.weightKg ?? "No measurement" }}</span><strong>Nutrition</strong><span>{{ projection.snapshot.nutrition.totals.mealCount }} meals · {{ projection.snapshot.nutrition.totals.caloriesKcal ?? "unknown" }} kcal</span>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

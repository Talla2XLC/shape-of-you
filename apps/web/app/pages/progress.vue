<script setup lang="ts">
import { beginBrowserSignIn } from "~/lib/browser-auth";
import { createLatestRequestGate, dayRoute, fetchProgressOverview, trailingRange, type ProgressMetricKey, type ProgressOverview } from "~/lib/progress";

definePageMeta({ middleware: "api-session" });
useHead({ bodyAttrs: { class: "page-progress" } });
const route = useRoute();
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
const period = ref<7 | 30 | 365>(30);
const selectedMetric = ref<ProgressMetricKey>("weight_kg");
const overview = ref<ProgressOverview | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
const requestGate = createLatestRequestGate();
let requestController: AbortController | null = null;
const selectedSeries = computed(() => overview.value?.metrics.find((metric) => metric.key === selectedMetric.value) ?? null);
const latestPoint = computed(() => selectedSeries.value?.points.at(-1) ?? null);
const chartPoints = computed(() => {
  const series = selectedSeries.value;
  if (!series?.points.length || !overview.value) return [];
  const start = Date.parse(`${overview.value.from}T00:00:00Z`) / 86_400_000;
  const end = Date.parse(`${overview.value.to}T00:00:00Z`) / 86_400_000;
  const values = series.points.map((point) => point.value);
  const min = Math.min(...values); const max = Math.max(...values); const spread = max - min || 1;
  const positioned = series.points.map((point) => {
    const day = Date.parse(`${point.localDate}T00:00:00Z`) / 86_400_000;
    const y = min === max ? 104 : 176 - ((point.value - min) / spread) * 144;
    return { ...point, day, x: 32 + ((day - start) / Math.max(1, end - start)) * 696, y };
  });
  return positioned;
});

async function load(): Promise<void> {
  const token = requestGate.begin();
  requestController?.abort();
  requestController = new AbortController();
  busy.value = true; error.value = null;
  const range = trailingRange(today, period.value);
  try {
    const result = await fetchProgressOverview(range.from, range.to, timezone, requestController.signal);
    if (requestGate.isCurrent(token)) overview.value = result;
  }
  catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") return;
    if (typeof caught === "object" && caught !== null && "status" in caught && caught.status === 401) { beginBrowserSignIn(route.fullPath); return; }
    if (requestGate.isCurrent(token)) error.value = "Progress is temporarily unavailable.";
  } finally { if (requestGate.isCurrent(token)) busy.value = false; }
}
function choosePeriod(value: 7 | 30 | 365): void { period.value = value; void load(); }
onMounted(load);
</script>

<template>
  <section class="progress-view">
    <header class="progress-heading">
      <div>
        <p class="eyebrow">
          Progress
        </p><h1>Your shape, over time.</h1><p class="lede">
          Only recorded facts appear. Missing days stay visible through spacing.
        </p>
      </div>
      <div
        class="period-picker"
        aria-label="Progress period"
      >
        <button
          v-for="item in ([7, 30, 365] as const)"
          :key="item"
          type="button"
          :aria-pressed="period === item"
          @click="choosePeriod(item)"
        >
          {{ item === 7 ? "Week" : item === 30 ? "Month" : "Year" }}
        </button>
      </div>
    </header>
    <p
      v-if="busy"
      role="status"
    >
      Loading progress…
    </p><p
      v-if="error"
      role="alert"
      class="notice-error"
    >
      {{ error }}
    </p>
    <template v-if="overview">
      <section
        class="progress-chart-card"
        aria-label="Progress chart"
      >
        <div class="progress-chart-toolbar">
          <label
            id="metric-label"
            class="field"
          >Metric <select v-model="selectedMetric"><option
            v-for="metric in overview.metrics"
            :key="metric.key"
            :value="metric.key"
          >{{ metric.label }}</option></select></label>
          <div
            v-if="latestPoint && selectedSeries"
            class="latest-reading"
            aria-label="Latest selected metric"
          >
            <span>Latest</span>
            <strong>{{ latestPoint.value }} {{ selectedSeries.unit }}</strong>
            <time :datetime="latestPoint.localDate">
              {{ new Date(`${latestPoint.localDate}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) }}
            </time>
          </div>
        </div>
        <p
          v-if="!selectedSeries?.points.length"
          class="empty-state"
        >
          No entries
        </p>
        <div
          v-else-if="selectedSeries.points.length === 1"
          class="single-entry-state"
          role="status"
        >
          <span
            class="single-entry-marker"
            aria-hidden="true"
          />
          <p>
            <strong>One entry in this period.</strong>
            <span>Another recorded day will turn it into a trend.</span>
          </p>
        </div>
        <svg
          v-else-if="selectedSeries.points.length > 1"
          class="progress-chart"
          viewBox="0 0 760 220"
          role="img"
          :aria-label="`${selectedSeries?.label} over the selected period`"
        >
          <line
            x1="32"
            y1="104"
            x2="728"
            y2="104"
            class="chart-grid"
          />
          <line
            x1="32"
            y1="176"
            x2="728"
            y2="176"
            class="chart-axis"
          />
          <g><polyline
            :points="chartPoints.map(point => `${point.x},${point.y}`).join(' ')"
            class="chart-line"
          /><line
            v-for="point in chartPoints"
            :key="`${point.localDate}-guide`"
            :x1="point.x"
            :x2="point.x"
            :y1="point.y"
            y2="176"
            class="chart-guide"
          /><circle
            v-for="point in chartPoints"
            :key="point.localDate"
            :cx="point.x"
            :cy="point.y"
            r="4"
            class="chart-point"
          ><title>{{ point.localDate }}: {{ point.value }} {{ selectedSeries?.unit }}</title></circle></g>
        </svg>
        <div
          v-if="selectedSeries?.points.length"
          class="metric-data"
          aria-label="Selected metric values"
        >
          <h2>{{ selectedSeries.label }} entries</h2>
          <ul>
            <li
              v-for="point in selectedSeries.points"
              :key="point.localDate"
            >
              <time :datetime="point.localDate">{{ point.localDate }}</time>
              <strong>{{ point.value }} {{ selectedSeries.unit }}</strong>
            </li>
          </ul>
        </div>
      </section>
      <section
        class="progress-days"
        aria-labelledby="recorded-days"
      >
        <h2 id="recorded-days">
          Recorded days
        </h2><p
          v-if="!overview.days.length"
          class="empty-state"
        >
          No entries
        </p>
        <ol v-else>
          <li
            v-for="day in overview.days"
            :key="day.localDate"
          >
            <NuxtLink :to="dayRoute(day.localDate, timezone)">
              <time :datetime="day.localDate">{{ new Date(`${day.localDate}T12:00:00Z`).toLocaleDateString(undefined, { dateStyle: 'long' }) }}</time><span>{{ Object.values(day.facts).reduce((sum, value) => sum + value, 0) }} facts</span>
            </NuxtLink>
          </li>
        </ol>
      </section>
    </template>
  </section>
</template>

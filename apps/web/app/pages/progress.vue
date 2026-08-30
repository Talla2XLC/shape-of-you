<script setup lang="ts">
import { beginBrowserSignIn } from "~/lib/browser-auth";
import { chatAssistantLaunchRoute, chatAssistantStopMessage } from "~/lib/chat-assistant";
import { dayApi, DayApiError, type DailyProjection } from "~/lib/day-api";
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
const todayProjection = ref<DailyProjection | null>(null);
const todayBusy = ref(false);
const todayError = ref<string | null>(null);
const todayAutomaticRetryDelayMs = 1_000;
const coachStopMessage = computed(() => chatAssistantStopMessage(route.query.coach));
const requestGate = createLatestRequestGate();
let requestController: AbortController | null = null;
let todayRequestId = 0;
const selectedSeries = computed(() => overview.value?.metrics.find((metric) => metric.key === selectedMetric.value) ?? null);
const latestPoint = computed(() => selectedSeries.value?.points.at(-1) ?? null);
const todayRecovery = computed(() => todayProjection.value?.snapshot.recovery.assessments.at(0) ?? null);
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
function isTransientTodayFailure(caught: unknown): boolean {
  return caught instanceof TypeError || (
    caught instanceof DayApiError && [502, 503, 504].includes(caught.status)
  );
}
async function loadToday(allowAutomaticRetry = true): Promise<void> {
  const requestId = ++todayRequestId;
  todayBusy.value = true;
  todayError.value = null;
  todayProjection.value = null;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await dayApi.projection(today, timezone);
        if (requestId !== todayRequestId) return;
        todayProjection.value = result;
        return;
      } catch (caught) {
        if (requestId !== todayRequestId) return;
        if (caught instanceof DayApiError && caught.status === 401) {
          beginBrowserSignIn(route.fullPath);
          return;
        }
        if (attempt === 0 && allowAutomaticRetry && isTransientTodayFailure(caught)) {
          await new Promise((resolve) => window.setTimeout(resolve, todayAutomaticRetryDelayMs));
          if (requestId !== todayRequestId) return;
          continue;
        }
        todayError.value = "Today's authoritative state is temporarily unavailable.";
        return;
      }
    }
  } finally {
    if (requestId === todayRequestId) todayBusy.value = false;
  }
}
function retryToday(): void {
  void loadToday(false);
}
function choosePeriod(value: 7 | 30 | 365): void { period.value = value; void load(); }
onMounted(() => { void load(); void loadToday(); });
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
        <a
          class="button coach-launcher"
          :href="chatAssistantLaunchRoute"
          target="_blank"
          rel="noopener"
        >Chat with your AI Coach</a>
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
      v-if="coachStopMessage"
      role="alert"
      class="notice-error coach-stop"
    >
      {{ coachStopMessage }}
    </p>
    <section
      class="today-card"
      aria-labelledby="today-state-heading"
    >
      <div class="today-card-heading">
        <div>
          <p class="eyebrow">
            Today
          </p>
          <h2 id="today-state-heading">
            Your day, right now.
          </h2>
        </div>
        <time :datetime="today">{{ new Date(`${today}T12:00:00Z`).toLocaleDateString(undefined, { dateStyle: 'long' }) }}</time>
      </div>
      <p
        v-if="todayBusy"
        role="status"
      >
        Loading today's authoritative state…
      </p>
      <div
        v-else-if="todayError"
        class="today-error-state"
      >
        <p
          role="alert"
          class="notice-error today-error"
        >
          {{ todayError }} No fallback was used.
        </p>
        <button
          type="button"
          class="button button-secondary today-retry"
          @click="retryToday"
        >
          Try again
        </button>
      </div>
      <template v-else-if="todayProjection">
        <p class="today-lifecycle">
          <strong>Current recorded facts</strong>
          <span>Updated {{ new Date(todayProjection.asOf).toLocaleTimeString() }}</span>
        </p>
        <dl class="today-facts">
          <div>
            <dt>Nutrition recorded</dt>
            <dd>{{ todayProjection.snapshot.nutrition.totals.mealCount }} meals · {{ todayProjection.snapshot.nutrition.totals.caloriesKcal ?? "unknown" }} kcal</dd>
          </div>
          <div>
            <dt>Training completed</dt>
            <dd>{{ todayProjection.snapshot.training.workoutSessions.length }} {{ todayProjection.snapshot.training.workoutSessions.length === 1 ? "workout" : "workouts" }}</dd>
          </div>
          <div>
            <dt>Recovery evidence</dt>
            <dd>{{ todayRecovery ? `Readiness ${todayRecovery.readinessScore} · ${todayRecovery.riskLevel} risk` : "No assessment" }}</dd>
          </div>
        </dl>
        <NuxtLink
          class="today-record-link"
          :to="dayRoute(todayProjection.localDate, todayProjection.timezone)"
        >
          Review today's record
        </NuxtLink>
      </template>
    </section>
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

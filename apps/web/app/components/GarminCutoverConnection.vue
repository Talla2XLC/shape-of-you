<script setup lang="ts">
import {
  cutoverCapabilityLabel,
  garminCutoverApi,
  garminCutoverRequestMessage,
  IntegrationApiError,
  type GarminCutover,
  type GarminCutoverCapability,
  type GarminCutoverPreview
} from "~/lib/integration-api";

defineProps<{ sourceAvailable: boolean }>();
const emit = defineEmits<{ changed: [] }>();

const cutover = ref<GarminCutover | null>(null);
const preview = ref<GarminCutoverPreview | null>(null);
const wizardOpen = ref(false);
const startsOn = ref("");
const apiKey = ref("");
const replaceStoredKey = ref(false);
const acceptedGaps = ref<GarminCutoverCapability[]>([]);
const consent = ref(false);
const message = ref("");
const busy = ref(false);
const uncertain = ref(false);
const loaded = ref(false);
const dedupeKey = ref("");
const restoreSuppressed = computed(() => cutover.value?.failureCode === "restore_suppressed");
const usingStoredKey = computed(() => cutover.value?.state === "failed" && !replaceStoredKey.value);
const canSubmit = computed(() => !busy.value && !uncertain.value && !restoreSuppressed.value && preview.value !== null &&
  startsOn.value === preview.value.startsOn && consent.value &&
  preview.value.gaps.every((gap) => acceptedGaps.value.includes(gap.capability)) &&
  (usingStoredKey.value || apiKey.value.trim().length > 0));
let generation = 0;
let disposed = false;
let poll: ReturnType<typeof setInterval> | undefined;

function clearWizard(): void {
  apiKey.value = "";
  replaceStoredKey.value = false;
  preview.value = null;
  acceptedGaps.value = [];
  consent.value = false;
  dedupeKey.value = "";
  startsOn.value = "";
  wizardOpen.value = false;
}

function resetConfirmation(): void {
  acceptedGaps.value = [];
  consent.value = false;
  dedupeKey.value = "";
}

async function refresh(silent = false): Promise<void> {
  if (busy.value) return;
  const request = ++generation;
  try {
    const result = await garminCutoverApi.status();
    if (disposed || request !== generation) return;
    const changed = cutover.value?.version !== result.cutover?.version || cutover.value?.state !== result.cutover?.state;
    cutover.value = result.cutover;
    if (changed) emit("changed");
    loaded.value = true;
    if (restoreSuppressed.value) {
      uncertain.value = false;
      message.value = "";
      clearWizard();
      return;
    }
    if (uncertain.value) {
      uncertain.value = false;
      message.value = "";
      if (result.cutover) clearWizard();
    }
  } catch (error) {
    if (!disposed && request === generation && !silent) message.value = garminCutoverRequestMessage(error);
  }
}

onMounted(async () => {
  await refresh(true);
  if (!disposed) poll = setInterval(() => {
    if (!wizardOpen.value && !uncertain.value) void refresh(true);
  }, 30_000);
});

onBeforeUnmount(() => {
  disposed = true;
  generation++;
  clearWizard();
  if (poll) clearInterval(poll);
});

async function loadPreview(nearest = false): Promise<void> {
  if (busy.value || uncertain.value || restoreSuppressed.value) return;
  const request = ++generation;
  busy.value = true;
  message.value = "";
  try {
    const current = await garminCutoverApi.status();
    if (disposed || request !== generation) return;
    cutover.value = current.cutover;
    loaded.value = true;
    if (restoreSuppressed.value) {
      clearWizard();
      return;
    }
    if (current.cutover && !["failed", "cancelled"].includes(current.cutover.state)) {
      clearWizard();
      return;
    }
    const result = await garminCutoverApi.preview(nearest || !startsOn.value ? {} : { startsOn: startsOn.value });
    if (disposed || request !== generation) return;
    preview.value = result;
    startsOn.value = result.startsOn;
    resetConfirmation();
    wizardOpen.value = true;
  } catch (error) {
    if (!disposed && request === generation) message.value = garminCutoverRequestMessage(error);
  } finally {
    if (!disposed && request === generation) busy.value = false;
  }
}

function cancelForm(): void {
  if (busy.value) return;
  generation++;
  clearWizard();
  if (!uncertain.value) message.value = "";
}

async function schedule(): Promise<void> {
  if (!canSubmit.value || !preview.value) return;
  const request = ++generation;
  busy.value = true;
  message.value = "";
  dedupeKey.value ||= crypto.randomUUID();
  const common = {
    startsOn: preview.value.startsOn,
    expectedRevision: preview.value.expectedRevision,
    acceptedCoverageGaps: [...acceptedGaps.value],
    dedupeKey: dedupeKey.value
  };
  try {
    const result = cutover.value?.state === "failed"
      ? await garminCutoverApi.retry({
          ...common, expectedVersion: cutover.value.version,
          ...(replaceStoredKey.value ? { apiKey: apiKey.value.trim() } : {})
        })
      : await garminCutoverApi.schedule({ ...common, apiKey: apiKey.value.trim(), consent: true });
    if (disposed || request !== generation) return;
    cutover.value = result.cutover;
    clearWizard();
    emit("changed");
  } catch (error) {
    if (disposed || request !== generation) return;
    message.value = garminCutoverRequestMessage(error);
    if (error instanceof IntegrationApiError && error.cutoverPreview) {
      preview.value = error.cutoverPreview;
      startsOn.value = error.cutoverPreview.startsOn;
      resetConfirmation();
    } else if (!(error instanceof IntegrationApiError) || error.status >= 500) {
      uncertain.value = true;
    } else {
      dedupeKey.value = "";
      if (error.status === 409) {
        preview.value = null;
        resetConfirmation();
      }
    }
  } finally {
    if (!disposed && request === generation) busy.value = false;
  }
}

async function cancelTransition(): Promise<void> {
  if (busy.value || restoreSuppressed.value || !cutover.value || !["scheduled", "failed"].includes(cutover.value.state)) return;
  if (!window.confirm("Cancel this transition? Intervals will keep its current role and the pending Garmin key will be removed.")) return;
  const request = ++generation;
  busy.value = true;
  message.value = "";
  try {
    const result = await garminCutoverApi.cancel({ expectedVersion: cutover.value.version, reason: "user requested cutover cancellation" });
    if (disposed || request !== generation) return;
    cutover.value = result.cutover;
    uncertain.value = false;
    clearWizard();
    emit("changed");
  } catch (error) {
    if (!disposed && request === generation) {
      message.value = garminCutoverRequestMessage(error);
      if (!(error instanceof IntegrationApiError) || error.status >= 500) uncertain.value = true;
    }
  } finally {
    if (!disposed && request === generation) busy.value = false;
  }
}

function failureMessage(value: GarminCutover["failureCode"]): string {
  if (value === "restore_suppressed") return "Подключение остановлено после восстановления данных. Нужна проверка оператора.";
  if (value === "journal_not_ready") return "Переход ещё не защищён журналом восстановления. Старое подключение сохранено; нужна проверка оператора.";
  if (value === "authorization_required") return "Garmin access needs attention. You can retry with the saved key or provide a replacement.";
  if (value === "timezone_changed") return "Your timezone changed before activation. Review a new start date.";
  if (value === "coverage_changed") return "Available data changed before activation. Review the current limitations.";
  if (value === "erasure_pending") return "A data-deletion request prevents this transition from starting.";
  if (value === "consent_changed" || value === "source_conflict") return "The connection changed before activation. Refresh and review a new preview.";
  return "The transition could not start. Intervals remains the source; refresh and review a retry.";
}

function formatted(value: string, timezone: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(date);
}
</script>

<template>
  <article
    v-if="sourceAvailable || cutover"
    class="management-card"
    aria-labelledby="garmin-cutover-title"
    :aria-busy="busy"
  >
    <p class="eyebrow">
      Keep your history
    </p>
    <h2 id="garmin-cutover-title">
      Switch from Intervals to Garmin
    </h2>
    <p class="item-meta">
      Keep your existing imported history and use direct Garmin access for new data from a future date.
    </p>
    <StatusNotice
      v-if="message"
      kind="error"
      :message="message"
    />
    <div
      v-if="cutover"
      aria-live="polite"
    >
      <p v-if="restoreSuppressed">
        {{ failureMessage(cutover.failureCode) }}
      </p>
      <p v-else-if="cutover.state === 'scheduled'">
        Scheduled for {{ cutover.startsOn }} ({{ cutover.timezone }}). Intervals continues syncing until the transition starts.
      </p>
      <p v-else-if="cutover.state === 'draining'">
        Garmin now owns the new period. Intervals can refresh only the old period until {{ formatted(cutover.sourceDrainsUntil, cutover.timezone) }}.
      </p>
      <p v-else-if="cutover.state === 'active'">
        Transition active. Direct Garmin owns the new period and automatic Intervals imports have stopped.
      </p>
      <p v-else-if="cutover.state === 'failed'">
        {{ failureMessage(cutover.failureCode) }}
      </p>
      <p v-else>
        Transition cancelled. No new period was switched to Garmin.
      </p>
      <p
        v-if="!restoreSuppressed && (cutover.state === 'scheduled' || cutover.state === 'draining' || cutover.state === 'active')"
        class="item-meta"
      >
        Garmin history begins on {{ cutover.startsOn }}. This state describes the transition; it does not confirm that data has already arrived.
      </p>
      <p
        v-if="cutover.acceptedCoverageGaps.length"
        class="item-meta"
      >
        Accepted limitations: {{ cutover.acceptedCoverageGaps.map(cutoverCapabilityLabel).join(", ") }}.
      </p>
      <p
        v-if="cutover.sourceRevocationUnconfirmed"
        class="privacy-warning"
      >
        Intervals imports are stopped locally, but removal of its remote access could not be confirmed.
        Review Shape of You access in your Intervals settings.
      </p>
    </div>
    <p v-else-if="!loaded">
      Loading transition status…
    </p>
    <div
      v-if="wizardOpen"
      class="historical-import"
    >
      <div class="field">
        <label for="garmin-cutover-start">Start using direct Garmin data on</label>
        <input
          id="garmin-cutover-start"
          v-model="startsOn"
          type="date"
          :disabled="busy || uncertain"
          @change="resetConfirmation"
        >
      </div>
      <button
        class="button button-secondary compact-button"
        type="button"
        :disabled="busy || uncertain"
        @click="loadPreview()"
      >
        Update preview
      </button>
      <template v-if="preview && startsOn === preview.startsOn">
        <p class="item-meta">
          The new period starts {{ formatted(preview.startsAt, preview.timezone) }} ({{ preview.timezone }}).
          Intervals can refresh old data for 14 calendar days, until {{ formatted(preview.sourceDrainsUntil, preview.timezone) }}.
        </p>
        <p class="item-meta">
          Existing history keeps its original source and links. During that period Intervals refreshes the old tail from {{ preview.sourceTailFromDate }}
          and any already requested older history. Later changes to old data will not automatically sync after the deadline.
          Garmin will not re-import the earlier Intervals period.
        </p>
        <p class="privacy-warning">
          Daily records use each provider's calendar-date labels. Different labels or start times can leave ambiguity at the boundary;
          matching physical events are not automatically merged.
        </p>
        <fieldset
          v-if="preview.gaps.length"
          :disabled="busy || uncertain"
        >
          <legend>Review each limitation of direct Garmin access</legend>
          <label
            v-for="gap in preview.gaps"
            :key="gap.capability"
            class="privacy-confirmation"
          >
            <input
              v-model="acceptedGaps"
              type="checkbox"
              :value="gap.capability"
              @change="dedupeKey = ''"
            >
            <span>
              I accept that {{ cutoverCapabilityLabel(gap.capability) }} is
              {{ gap.status === "unsupported" ? "not imported through direct Garmin access" : "not yet verified through direct Garmin access" }}.
            </span>
          </label>
        </fieldset>
        <p
          v-if="usingStoredKey"
          class="item-meta"
        >
          The saved Garmin key will be checked again. You do not need to paste it again.
        </p>
        <button
          v-if="cutover?.state === 'failed' && !replaceStoredKey"
          class="button button-secondary compact-button"
          type="button"
          :disabled="busy || uncertain"
          @click="replaceStoredKey = true; dedupeKey = ''"
        >
          Use a replacement Garmin key
        </button>
        <form
          autocomplete="off"
          @submit.prevent="schedule"
        >
          <div
            v-if="!usingStoredKey"
            class="field"
          >
            <label for="garmin-cutover-key">Garmin key for the transition</label>
            <input
              id="garmin-cutover-key"
              v-model="apiKey"
              type="password"
              autocomplete="off"
              autocapitalize="none"
              :spellcheck="false"
              maxlength="4096"
              required
              :disabled="busy || uncertain"
              @input="dedupeKey = ''"
            >
            <p class="item-meta">
              <a
                href="https://connect.garmin.com/app/settings/personalApiToken"
                target="_blank"
                rel="noreferrer noopener"
              >Create a personal API key in Garmin</a>. The key is stored only after the transition is scheduled.
            </p>
          </div>
          <label class="privacy-confirmation">
            <input
              v-model="consent"
              type="checkbox"
              :disabled="busy || uncertain"
              @change="dedupeKey = ''"
            >
            <span>
              I want to switch from this date, allow automatic Garmin imports and catch-up of its new period,
              and accept the limited time for refreshing old Intervals data.
            </span>
          </label>
          <div class="button-row">
            <button
              class="button compact-button"
              type="submit"
              :disabled="!canSubmit"
            >
              {{ busy ? "Checking transition…" : cutover?.state === "failed" ? "Retry transition" : "Schedule transition" }}
            </button>
            <button
              class="button button-secondary compact-button"
              type="button"
              :disabled="busy"
              @click="cancelForm"
            >
              Close preview
            </button>
          </div>
        </form>
      </template>
    </div>
    <div class="connection-actions">
      <button
        v-if="!restoreSuppressed && !wizardOpen && sourceAvailable && (!cutover || cutover.state === 'cancelled' || cutover.state === 'failed')"
        class="button compact-button"
        type="button"
        :disabled="busy || uncertain"
        @click="loadPreview(true)"
      >
        {{ cutover?.state === "failed" ? "Review retry" : "Plan transition" }}
      </button>
      <button
        v-if="!restoreSuppressed && (cutover?.state === 'scheduled' || cutover?.state === 'failed')"
        class="button button-secondary compact-button"
        type="button"
        :disabled="busy || uncertain"
        @click="cancelTransition"
      >
        Cancel transition
      </button>
      <button
        class="button button-secondary compact-button"
        type="button"
        :disabled="busy"
        @click="refresh()"
      >
        Refresh transition status
      </button>
    </div>
  </article>
</template>

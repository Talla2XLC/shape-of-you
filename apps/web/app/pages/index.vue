<script setup lang="ts">
import { browserAuth } from "~/lib/browser-auth";

type SessionState = "active" | "checking" | "inactive" | "unavailable";

const sessionState = ref<SessionState>("checking");
const signInHref = browserAuth.signInUrl("/day");

onMounted(async () => {
  try {
    sessionState.value = await browserAuth.hasSession() ? "active" : "inactive";
  } catch {
    sessionState.value = "unavailable";
  }
});
</script>

<template>
  <section class="hero">
    <div>
      <p class="eyebrow">
        Personal fitness, coherent over time
      </p>
      <h1>Your signals.<br>One clear shape.</h1>
      <p class="lede">
        Shape of You keeps the history behind your nutrition, training, body,
        and recovery decisions intact—so the next choice has context.
      </p>
      <div class="hero-actions">
        <a
          v-if="sessionState === 'active'"
          class="button"
          href="/day"
        >Open my day</a>
        <a
          v-else-if="sessionState === 'inactive'"
          class="button"
          :href="signInHref"
        >Continue with a passkey</a>
        <span
          v-else
          class="session-status"
          role="status"
        >{{ sessionState === "checking" ? "Checking your session…" : "Session status is temporarily unavailable." }}</span>
        <a
          class="quiet-link"
          href="#privacy"
        >Why passkeys?</a>
      </div>
    </div>
    <aside
      id="privacy"
      class="signal-card"
      aria-label="Privacy promise"
    >
      <div
        class="signal-orbit"
        aria-hidden="true"
      />
      <div class="signal-copy">
        <p class="eyebrow">
          Built around your authority
        </p>
        <strong>No password to remember.</strong>
        <span>
          Your passkey stays with your device. Shape of You keeps security and
          fitness decisions behind clear, separate boundaries.
        </span>
      </div>
    </aside>
  </section>
</template>

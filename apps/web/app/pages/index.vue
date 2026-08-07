<script setup lang="ts">
import { identityRoute } from "~/lib/browser-security";

const config = useRuntimeConfig();
const identityOrigin = String(config.public.identityOrigin);
const signInUrl = identityRoute(identityOrigin, "/sign-in");
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
          class="button"
          :href="signInUrl"
        >Continue with a passkey</a>
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

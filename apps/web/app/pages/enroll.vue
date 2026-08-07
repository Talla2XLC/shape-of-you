<script setup lang="ts">
import {
  consumeEnrollmentFragment,
  identityRedirectTarget,
  identityRoute
} from "~/lib/browser-security";
import { createIdentityApi } from "~/lib/identity-api";
import { userMessage } from "~/lib/user-message";
import { registerPasskey } from "~/lib/webauthn";

const config = useRuntimeConfig();
const identityOrigin = String(config.public.identityOrigin);
const token = shallowRef<string | null>(null);
const label = ref("");
const busy = ref(false);
const completed = ref(false);
const message = ref("");

onMounted(() => {
  const redirect = identityRedirectTarget(identityOrigin, window.location.href);
  if (redirect) {
    window.location.replace(redirect);
    return;
  }
  token.value = consumeEnrollmentFragment({
    hash: window.location.hash,
    pathname: window.location.pathname,
    search: window.location.search,
    replaceUrl: (url) => window.history.replaceState(null, "", url)
  });
  if (!token.value) {
    message.value = "This enrollment link is missing or invalid. Request a fresh link from the operator.";
  }
});

async function enroll(): Promise<void> {
  if (!token.value || busy.value) return;
  busy.value = true;
  message.value = "";
  const bearer = token.value;
  try {
    await registerPasskey(createIdentityApi(), {
      bearer,
      ...(label.value.trim() ? { label: label.value.trim() } : {})
    });
    completed.value = true;
    message.value = "Your passkey is ready. Sign in to open security settings.";
  } catch (error) {
    message.value = userMessage(error);
  } finally {
    token.value = null;
    busy.value = false;
  }
}

const signInUrl = identityRoute(identityOrigin, "/sign-in");
</script>

<template>
  <section class="auth-wrap">
    <div class="auth-card">
      <p class="eyebrow">
        Private enrollment
      </p>
      <h1 class="auth-title">
        Create your first passkey.
      </h1>
      <p class="lede">
        The one-time link has been removed from your address bar. Your browser
        will now ask where to keep the passkey.
      </p>

      <div
        v-if="token && !completed"
        class="field"
      >
        <label for="passkey-label">Passkey name (optional)</label>
        <input
          id="passkey-label"
          v-model="label"
          maxlength="200"
          autocomplete="off"
          placeholder="Personal MacBook"
        >
      </div>

      <ul class="step-list">
        <li>The enrollment credential stays only in this tab.</li>
        <li>Shape of You stores a public key, never your biometric data.</li>
        <li>After enrollment, sign in with the passkey you created.</li>
      </ul>

      <StatusNotice
        v-if="message"
        :kind="completed ? 'success' : 'error'"
        :message="message"
      />

      <div class="button-row">
        <button
          v-if="!completed"
          class="button"
          type="button"
          :disabled="!token || busy"
          @click="enroll"
        >
          {{ busy ? "Waiting for your passkey…" : "Create passkey" }}
        </button>
        <a
          v-else
          class="button"
          :href="signInUrl"
        >Sign in</a>
      </div>
    </div>
  </section>
</template>

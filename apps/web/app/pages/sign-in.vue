<script setup lang="ts">
import {
  identityRedirectTarget,
  identityRoute
} from "~/lib/browser-security";
import { createIdentityApi } from "~/lib/identity-api";
import { userMessage } from "~/lib/user-message";
import { authenticateWithPasskey } from "~/lib/webauthn";

const config = useRuntimeConfig();
const identityOrigin = String(config.public.identityOrigin);
const busy = ref(false);
const message = ref("");

onMounted(() => {
  const redirect = identityRedirectTarget(identityOrigin, window.location.href);
  if (redirect) window.location.replace(redirect);
});

async function signIn(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  message.value = "";
  try {
    await authenticateWithPasskey(createIdentityApi());
    window.location.assign(identityRoute(identityOrigin, "/security"));
  } catch (error) {
    message.value = userMessage(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="auth-wrap">
    <div class="auth-card">
      <p class="eyebrow">
        Identity
      </p>
      <h1 class="auth-title">
        Come back without a password.
      </h1>
      <p class="lede">
        Use a passkey already saved to this device, your phone, or your password
        manager. Shape of You will ask your browser to verify it.
      </p>
      <StatusNotice
        v-if="message"
        kind="error"
        :message="message"
      />
      <div class="button-row">
        <button
          class="button"
          type="button"
          :disabled="busy"
          @click="signIn"
        >
          {{ busy ? "Checking your passkey…" : "Sign in with a passkey" }}
        </button>
      </div>
    </div>
  </section>
</template>

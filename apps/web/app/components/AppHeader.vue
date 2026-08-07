<script setup lang="ts">
const config = useRuntimeConfig();
const identityOrigin = String(config.public.identityOrigin);
const signInUrl = computed(() => new URL("/sign-in", identityOrigin).toString());
</script>

<template>
  <header class="site-header">
    <NuxtLink
      class="brand"
      to="/"
      aria-label="Shape of You home"
    >
      <span
        class="brand-mark"
        aria-hidden="true"
      >S</span>
      <span>Shape of You</span>
    </NuxtLink>
    <a
      class="quiet-link"
      :href="signInUrl"
    >Sign in</a>
  </header>
</template>

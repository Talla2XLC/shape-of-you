<script setup lang="ts">
definePageMeta({ middleware: "api-session" });
useHead({ bodyAttrs: { class: "page-connections" } });
</script>

<template>
  <section
    class="connections-page"
    aria-labelledby="connections-title"
  >
    <header class="connections-heading">
      <h1 id="connections-title">
        Connections
      </h1>
      <p class="lede">
        Connect Garmin to keep your activity and recovery data up to date.
      </p>
    </header>
    <GarminPersonalConnection />
  </section>
</template>

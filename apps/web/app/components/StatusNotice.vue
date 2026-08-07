<script setup lang="ts">
defineProps<{
  kind?: "error" | "success" | "info";
  message: string;
}>();
</script>

<template>
  <p
    class="status-notice"
    :class="`status-${kind ?? 'info'}`"
    :role="kind === 'error' ? 'alert' : 'status'"
    aria-live="polite"
  >
    {{ message }}
  </p>
</template>

<script setup lang="ts">
import { dayRoute, isIanaTimezone, isLocalDate } from "~/lib/progress";

definePageMeta({ middleware: "api-session" });
const route = useRoute();
const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const timezone = isIanaTimezone(route.query.timezone) ? route.query.timezone : browserTimezone;
const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
const localDate = isLocalDate(route.query.date) ? route.query.date : today;
await navigateTo(dayRoute(localDate, timezone), { replace: true });
</script>

<template>
  <p role="status">
    Opening your day…
  </p>
</template>

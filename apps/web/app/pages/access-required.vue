<template>
  <section class="auth-wrap">
    <div class="auth-card">
      <p class="eyebrow">
        Access required
      </p>
      <h1 class="auth-title">
        This account is not linked yet.
      </h1>
      <p class="lede">
        Your passkey sign-in succeeded, but this Identity account does not have
        access to a Shape of You profile. No fitness data was changed.
      </p>
      <StatusNotice
        kind="info"
        message="Ask the staging operator to link this account, or return with the passkey for the account that already owns the profile."
      />
      <div class="button-row">
        <a
          class="button"
          href="/"
        >Return home</a>
      </div>
    </div>
  </section>
</template>

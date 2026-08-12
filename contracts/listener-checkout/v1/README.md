# Listener checkout v1

Private server-to-server contract for creating a production Founding Listener checkout. It is
available only when the Listener authority, the selected Live provider lifecycle and the separate
new-sales gate are ready. The account and payer identity come from the authenticated Listener
session; provider IDs and secrets never cross to the browser.

`payer_email` is required only for Mercado Pago and forbidden for PayPal. It is transient and must
not be logged or persisted in plaintext. The response contains a provider-approved HTTPS URL but
no subscription ID. `environment` is fixed to `live`; Sandbox/TEST use their isolated experimental
contracts and routes.

Redirects never grant membership. Only a signed, correlated provider event and subsequent
canonical projection can authorize Listener access.

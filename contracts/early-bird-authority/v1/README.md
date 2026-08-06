# EarlyBird authority contract v1

Contrato privado para que Beacon use PMP Myth Bot como única autoridad de membresías Free, PayPal
y Mercado Pago.

## Autenticación y rutas

Las llamadas son server-to-server por red privada. Exigen `Authorization: Bearer ...` y
`X-HB-Service-Key-Id`; no se invocan desde el navegador.

- `POST /api/internal/v1/early-bird-invitations/redeem`
  - body: `invitation-redeem.schema.json`;
  - header obligatorio `Idempotency-Key`, opaco y de hasta 255 caracteres;
  - correlaciona el token firmado y one-use con el `account_id` opaco ya autenticado por OAuth;
  - una replay idéntica devuelve byte-semánticamente el mismo resultado; reutilizar la key con otro
    body devuelve conflicto.
- `GET /api/internal/v1/early-bird-memberships/{account_id}`
  - devuelve `membership.schema.json` y permite reconciliación pull.

Toda respuesta lleva `Cache-Control: private, no-store`. El contrato no contiene nombre, email,
tokens OAuth, identidad de menores ni URLs firmadas del stream.

## Vocabulario exacto

Estados: `PENDING`, `ACTIVE`, `GRACE`, `CANCELLED_PENDING_END`, `EXPIRED`, `REFUNDED`, `REVOKED`.

Fuentes: `FREE`, `PAYPAL`, `MERCADO_PAGO` o `null` si todavía no existe grant.

Sólo `ACTIVE`, `GRACE` y `CANCELLED_PENDING_END` dentro de sus límites temporales producen
`access_allowed=true`.

## Proyección monotónica a Beacon

Después de cada cambio material, la autoridad envía el contrato hermano
`contracts/early-bird-membership/v1` mediante:

`PUT /api/internal/v1/early-bird-memberships/{account_id}`

Beacon aplica una revisión mayor, reproduce la misma y rechaza como stale una menor. Al primer pago
confirmado la autoridad revoca el grant `FREE`, fija `free_entitlement_consumed=true`, incrementa
`membership_revision` y proyecta `source=PAYPAL` o `source=MERCADO_PAGO`. Cancelar luego el pago no
restaura Free. Beacon no debe inferir ese cambio desde redirects, webhooks propios ni estado local.

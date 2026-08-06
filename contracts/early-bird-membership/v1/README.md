# EarlyBird membership contract v1

Contrato privado entre el módulo canónico de membresías de PMP Myth Bot y la proyección revocable
de Beacon.

## Transporte

- `PUT /api/internal/v1/early-bird-memberships/{account_id}` aplica `command.schema.json`.
- `GET /api/internal/v1/early-bird-memberships/{account_id}` devuelve `result.schema.json`.
- Ambos endpoints viven sólo en la red privada y exigen `Authorization: Bearer ...` más
  `X-HB-Service-Key-Id`.
- PUT exige `Idempotency-Key: early-bird-membership:{account_id}:{membership_revision}`.

## Semántica

`membership_revision` aumenta exclusivamente ante una transición material. Beacon aplica una
revisión nueva, reproduce una idéntica y responde `STALE` a una anterior. El navegador, un redirect
de checkout y el proveedor de pagos nunca son fuente de acceso.

`ACTIVE`, `GRACE` y `CANCELLED_PENDING_END` permiten acceso sólo dentro de sus límites temporales.
Los restantes estados fallan cerrados. `current_price` informa el importe vigente y no autoriza un
cobro. El comando no contiene email, nombre, tokens OAuth, URLs firmadas ni datos de menores.

El hash de comando usa JCS/RFC 8785 y SHA-256 sobre exactamente los doce campos requeridos. Los
archivos cubiertos por `SHA256SUMS` deben copiarse byte-equivalentes al repositorio Beacon.

La autoridad sólo considera aplicada una proyección cuando Beacon confirma revisión suficiente y
un outcome, estado, acceso y `reconciliation_required=false` coherentes con una revisión local
conocida. Una respuesta atrasada o contradictoria permanece reintentable y emite alerta.

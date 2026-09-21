# Operación compartida: decisiones y ejecución

Fecha: 2026-09-20. Estado: ejecución en curso en
[PR #555](https://github.com/AlterMundi/harmonic-beacon-webapp/pull/555).
Procedimiento, skill y diagnóstico implementados; los cambios de autoridad
requieren integración en la base protegida antes de activarse. El registro de
continuidad está en ese PR, no en otro diario paralelo.

## Decisión

Codex y CompAII deben completar la misma tarea con los mismos comandos, límites
y evidencias. Nicolás designa el responsable por tarea/servicio; el otro puede
revisar o relevarlo. El host siempre online facilita continuidad, no confiere
autoridad. Tampoco un modelo más potente demuestra capacidad operacional.

La entrada común es [OPERATOR_LOOP](../ops/OPERATOR_LOOP.md), desde AGENTS.md.
La skill sólo localiza esa entrada. GitHub conserva código, CI y reviews; el
helper conserva exclusión, admisión y recuperación; cada harness conserva la
tarea activa y recibe eventos. No construir otro orquestador de agentes.

## Correcciones y evidencia

Base inspeccionada: `ed91f8d2775c5c59569e69c2bf24840866679d5b`. El reporte de
CompAII es una retrospectiva útil, no una comparación controlada entre modelos.
La transferencia anterior desde Codex también dejó conocimiento tácito y
procedimientos complejos. Reemplazar al operador no resuelve esos defectos.

- #554 tuvo un [gate exitoso](https://github.com/AlterMundi/harmonic-beacon-webapp/actions/runs/35523950310)
  sobre `fc9d2556f1ee2008eca2b57fbc7cfd67f8f08037`; el merge consultado después,
  `3051b63a8ccd0fa37caad2056a1566448a53caaa`, carecía del status. Ambos tienen
  los mismos padres y árbol `dc3ba9547098236646fbfc8de5165912fceb52e6`.
  No es correcto decir que el gate nunca funcionó ni que sólo falta review.
- Los runs [35536487556](https://github.com/AlterMundi/harmonic-beacon-webapp/actions/runs/35536487556)
  y [35492673217](https://github.com/AlterMundi/harmonic-beacon-webapp/actions/runs/35492673217)
  duran aproximadamente el timeout de 100 minutos. Hay fan-out y cancelaciones
  rápidas, pero no todas se deben a otro dispatch. El monitor espera incluso
  tras publicar failure; 96 sleeps más lecturas pueden exceder el timeout.
- #550 falla de dos maneras: el [E2E externo](https://github.com/AlterMundi/harmonic-beacon-webapp/actions/runs/35534941640/job/106142165503)
  pierde el botón durante el segundo click; el [interno](https://github.com/AlterMundi/harmonic-beacon-webapp/actions/runs/35534941749/job/106142308364)
  observa avance de `currentTime` con audio pausado. Ninguno demuestra por sí
  solo sonido audible indebido. Separar semántica nativa, fixture y producto
  antes de corregir assertions o comportamiento.
- [#552](https://github.com/AlterMundi/harmonic-beacon-webapp/pull/552) corrige el
  inventario de runtime del helper y fue omitida en la secuencia anterior.
  [#553](https://github.com/AlterMundi/harmonic-beacon-webapp/pull/553) proporciona
  productor/contratos; explícitamente no prueba instalación del consumidor ni
  adopción de genesis en Mona. El contrato mantiene hold legacy y exige v4.
- CI invoca e2e.yml, que también corre por evento PR. Existe duplicación real.
  [#541](https://github.com/AlterMundi/harmonic-beacon-webapp/pull/541) ya trabaja
  en eficiencia; reconciliarla antes de crear otra implementación competidora.
- CODEOWNERS requiere a `nicoechaniz` para workflows y audio. El último pusher
  no puede autoaprobarse. Un reviewer delegado no equivale a aprobación formal
  de GitHub; esto también limita a Codex cuando opera bajo esa identidad.

`doctor --service live` observó salud/readiness HTTP 200 y revisión pública
`9a40237a4042345c6c76c24ba4b492faa40ee03c`, además de gaps de catálogo y recovery.
No prueba audio real, restore, estado privado ni compatibilidad del rollout.

## Menos pasos, responsabilidades explícitas

| Capa | Responsabilidad | Eliminar |
| --- | --- | --- |
| Procedimiento común | Alcance, siguiente acción, review y handoff | Copias de política en skills y memorias |
| Owner de la tarea | Reparar hasta entregar o identificar bloqueo externo | Cadenas autor/reviewer/fixer sin responsable |
| CI | Calificar el candidato por riesgo | Matrices y builds duplicados |
| Gate protegido | Verificar evidencia y publicar decisión | Esperar 100 minutos después de un fallo terminal |
| Helper | Admitir artefacto, serializar cambios y recuperar | Compilar en Mona o redescubrir bootstrap en cada deploy |
| Adaptador del harness | Reanudar la tarea correcta | Callbacks que pisan instrucciones nuevas |

Una review integrada, con revisión independiente donde el contrato la exige.
El mismo reviewer comprueba la corrección y sus interacciones; no reiniciar una
auditoría global por cada commit. Mantener una continuación breve en el PR o
issue existente. Los artefactos y receipts de CI ya almacenan la prueba técnica.

## A. Entrada y diagnóstico — implementado

Archivos: AGENTS.md, OPERATOR_LOOP.md, fuente/distribuciones de la skill,
scripts/hb.mjs y scripts/ops/delivery-status.mjs.

Los párrafos técnicos de release se trasladan literalmente desde
OPERATING_CONTRACT.md a DELIVERY_INVARIANTS.md. Siguen siendo obligatorios al
preparar/desplegar/recuperar o modificar autoridad, pero un diagnóstico no carga
todas las reglas de migración y firma. No se relajan ni se duplican.

`hb delivery-status` usa GET, consulta dos veces la identidad del PR, presenta
head/base/merge, reviews, gate en ambos refs, todas las tentativas de checks y
fuentes desconocidas. No decide admisión. Exit 0 sólo significa diagnóstico
completo e identidad estable; exit 2 significa error o incertidumbre.

Validación: movimiento concurrente de refs, páginas incompletas, intento viejo
verde/nuevo rojo, null merge, fuentes inaccesibles y URLs sensibles; lectura de
#554/#550/#553 reales. La distribución Hermes se genera del mismo cuerpo que
Codex. Instalarla no demuestra discovery ni comportamiento del host remoto.

## B. Gate que converge — siguiente cambio de autoridad

Propietarios: delivery-gate-dispatch.yml, delivery-gate.yml, required-checks.mjs,
check-evidence.jq y sus tests. Conservar el evaluador de la base protegida y
vínculos de repo/PR/head/base/App/workflow/attempt. No ejecutar candidato con
credenciales de autoridad ni aceptar un status por nombre solamente.

Hacer una evaluación acotada por cambio de head/base y finalización de los
workflows constituyentes. Conservar una invalidación acotada cuando empieza
un nuevo intento requerido: si había success, debe pasar a pending mientras
ese intento está pendiente. Quitar todos los eventos requested/in_progress
sin reemplazar esa invalidación permitiría reutilizar una aprobación vieja.
Coalescer los eventos del mismo intento; no lanzar otro monitor de 100 minutos
por cada transición. Fallo terminal publica failure y termina; pendiente publica
pending y termina. API transitoria permite backoff acotado. Emitir razones e IDs
sanitizados y no cancelar continuamente evaluaciones cortas.

No basta escuchar completed: cubrir cambios de base y merge, eventos perdidos
y reinicios con reconciliación periódica o invocable por operador bajo la misma
autoridad. Reconciliar sólo PRs cuyo status esté ausente/obsoleto. Mantener por
ahora status en merge: al regenerarse, reevaluar inputs y publicar allí; no
copiar success por igualdad de árbol. Releer identidad antes del write; si
cambia después, la decisión vieja no autoriza al nuevo merge. El reconciliador
lo recupera. Un callback viejo puede pedir lectura vigente, nunca publicar la
evaluación vieja. El modo manual shadow continúa sin autorizar promoción.

Pruebas de aceptación: verde converge; rojo termina; rerun requerido invalida
success antes de su resultado; merge regenerado se
recupera sin recompilar; head/base nuevos no reutilizan autorización; eventos
duplicados, retarget, API parcial, timeout y rerun no autorizan indebidamente.
Medir runs, requests y minutos de runner antes/después. El gate viejo conserva
autoridad hasta integrar el cambio por la ruta protegida. Si impide su propia
reparación, registrar el bloqueo real; desproteger ramas no es operación normal.

## C. Una ejecución de cada suite — reconciliar #541

Corregir también clasificación excesiva: en este lote, agregar el diagnóstico
GET-only bajo scripts/ops y conectarlo a hb.mjs selecciona infraestructura
crítica, E2E de producto y recovery, aunque deployment.deploy=false. Crear un
perfil de herramientas de observación basado en dependencias y alcance reales,
con checks de herramienta/distribución. Los módulos compartidos con admisión
o ejecución privilegiada conservan su perfil crítico. No permitir bajar el
riesgo con labels ni eximir todo scripts/ops por nombre; comprobar sus callers.

Elegir CI como orquestador de matrices seleccionadas y e2e.yml como workflow
reutilizable. Actualizar el consumidor de evidencia antes de retirar el trigger
viejo. Bootstrap de compatibilidad: primero enseñar al evaluador protegido a
verificar la nueva forma; luego cambiar el emisor; finalmente retirar la vieja.
Cada forma debe probar todos sus checks, sin mezclar verde viejo con rojo nuevo.
La política de la base protegida elige la forma, no el candidato.

Secuencia ejecutable: C1 agrega el verificador de evidencia integrada y mantiene
la política `legacy-v1`; C2 selecciona `integrated-v2` conservando los emisores
existentes; sólo después C3 retira los disparadores duplicados. Cada etapa tiene
su propio commit y debe integrarse antes de activar la siguiente. La evidencia
integrada exige los jobs seleccionados del mismo run/attempt de CI; no completa
un intento nuevo incompleto con jobs verdes de una ejecución anterior.

Construir Next una vez por entorno de calificación y reutilizarlo entre browsers
si configuración/dependencias lo permiten. Mantener fixtures aislados antes de
paralelizar. Caché no equivale a calificación. El clasificador evita E2E/audio
para docs. La calificación final de la imagen no repite suites de fuente ya
válidas, pero sí prueba empaquetado, ejecución real y compatibilidad pertinente.

Aceptación: UI, producto, audio y migración seleccionan cobertura correcta;
una matriz, no dos; check seleccionado ausente sigue bloqueando. Conservar
cobertura de receptores WebKit y publishers realmente soportados. Emulación
WebKit no certifica iPhone físico. Configuración pública distinta invalida
reutilizar imágenes sin comprobar cómo se incorpora al bundle.

## D. Completar producción — bootstrap único

Resolver #552/#553 y consultar el estado privado mediante diagnóstico aprobado:
consumidor instalado, manifest v4, runtime, config, autorizaciones y transición
pendiente. No inferirlo del README ni fabricar current-state para pasar un gate.

La auditoría de ejecución encontró dos dependencias adicionales: la política
sudo del runner omite `artifact-impact-state` y `artifact-impact`, llamados por
`oci-promote.yml`; y no hay un diagnóstico privado independiente del flujo de
mutación. Corregir la correspondencia workflow/helper/sudo con una prueba de
contrato y agregar un readback acotado que no cree directorios ni locks. Leer
configuración instalada tampoco demuestra salud del runtime ni habilita deploy.
#553 sólo aporta el contrato/productor de genesis: no instala su consumidor ni
reconcilia Mona, por lo que su merge no cierra ese bootstrap.

Revisar #554 primero como arreglo base y recomponer #550 sobre main actualizado
con sus dos fallas resueltas. No exigir rebase por estética: merge normal sirve
si se revisa la composición. Si #554 entra por squash, reconciliar su contenido
duplicado. Integrar #552 y #553 con review del helper/autoridad sobre la base
actual. Ninguna de esas reviews por separado prueba el despliegue conjunto.

Demostrar staging, interrupción y recuperación antes de activar producción.
Después, deploy cotidiano = admitir candidate, comprobar entorno/migraciones
pertinentes, sustituir servicios seleccionados, verificar y conservar recovery.
Un nuevo botón no debe requerir repetir la ceremonia de genesis.

Aceptación: ambos operadores entregan por la misma ruta; Mona no compila; digest
desplegado coincide con calificado; fallo recupera versión compatible; ninguna
sesión activa se interrumpe. No integrar features pendientes de otro owner sin
transferir antes la responsabilidad de esa rama/entorno.

## E. Adaptación mínima de hosts y prueba de relevo

Comprobar discovery en Telegram/CLI/worktree en el Hermes real antes de tocar su
configuración. Exponer el router generado o leer directamente AGENTS y contrato
si falta discovery. Verificarlo desde la sesión efectiva, no sólo mirando una
carpeta. No copiar skills/memorias privadas ni sobrescribir configuración ajena.

Retirar fast-forward-mode no es por sí solo un defecto: las reglas útiles deben
quedar en el procedimiento normal. Mantenerla opcional; no exigir invocarla.
Usar review-agent para reviews de código, cargar referencias históricas sólo
cuando aplican y retirar límites arbitrarios de rondas de reparación.

Persistir qué tarea espera cada run. Usar el mecanismo existente del harness
con owner/tarea/repo/PR/head/base/run/attempt, deduplicación y checkpoint. Antes
de agregar webhooks/broker/otro daemon, reproducir callback viejo, doble, tardío
y posterior a reinicio. Codex debe superar la misma prueba en su propio host.

Ejercicio: un operador inicia reparación y CI; el otro retoma, recibe resultados
viejos/nuevos, completa reparación/review y entrega a staging. Repetir al revés.
Registrar corrección, tiempo, tokens, builds, repeticiones y pedidos humanos,
sin inventar plazos. El siguiente rollout productivo autorizado verifica la
operación real. No cambiar globalmente de modelo por una anécdota.

## Review disponible y seguridad

La dependencia personal de CODEOWNERS se resuelve nombrando revisores habilitados
o un servicio reviewer con identidad, evidencia y permisos propios. No compartir
el token de Nicolás ni usar dos cuentas para autorrevisarse. Acordar esa autoridad
es una decisión distinta del tuning técnico. Mientras falta reviewer, entregar
el candidato revisable e identificar ese bloqueo; continuar trabajo independiente.

La publicación prematura de notas privadas es un incidente aparte. Retirar el
bundle no demuestra ausencia de copias. Inventariar en privado lo expuesto,
revocar/rotar material potencialmente vigente, y luego resolver retención e
historia Git. No republicarlo para auditar ni purgar el worktree indiscriminadamente.

Resolver fixtures mediante diagnóstico aprobado con conteos y autoridad vigente,
sin PII. Si se confirma acceso peligroso, contenerlo dentro del mandato de
incidente; limpiar datos requiere alcance exacto y recuperación. No asumir que
toda limpieza necesita otra aprobación si ya está autorizada, ni inferir permiso
destructivo por sospechar que un registro es test.

## Cierre

Este lote establece la entrada y el diagnóstico; B–E siguen pendientes. No
modifica workflows de autoridad, ramas protegidas, datos ni producción. No
afirma que Hermes instaló la nueva skill ni que los PR de producto se desplegaron.
La operación compartida se demuestra con el relevo y la entrega, no con más
documentos o con el número de tests.

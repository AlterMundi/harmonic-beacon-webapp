# Harmonic Beacon: entrega eficiente y operación transferible

Fecha: 2026-09-09. Autor: Codex, a pedido de Nicolás. Estado: **propuesta de implementación, no cambio de política ya aplicado**.

Este documento permite continuar en reasoning medium sin reconstruir la investigación. La evidencia fechada no reemplaza consultar el estado al ejecutar. En este turno sólo se hicieron lecturas, actualización local de referencias Git y escritura de este plan; no se disparó CI, merge, deploy, restart, migración ni cambio de configuración productiva.

## 1. Decisión recomendada

Conservar GitHub Actions, Docker/Compose, Mona y los helpers existentes. Simplificar su uso alrededor de **un responsable de entrega, un candidato inmutable por servicio y una calificación proporcional al cambio**. No construir otra plataforma de orquestación ni hacer depender Beacon de terminar la mensajería Mona–Daimon.

La interfaz cotidiana debe ser: elegir el lote → trabajar y probar rápido → abrir un PR → integrar → calificar el artefacto una vez → staging → promover ese mismo artefacto → verificar producción. CompAII conserva la responsabilidad hasta el resultado, aunque otro contribuya código o revisión.

El objetivo no es reducir controles por cansancio. Es eliminar trabajo repetido y sustituir instrucciones recordadas por verificaciones mecánicas. Aceptamos que un candidato falle; no aceptamos que se despliegue fallando ni que un fallo mande el trabajo a una nueva ceremonia indefinida.

### Límites de alcance

- Este plan trata delivery y operación del ecosistema, no rediseña audio, membresías, identidad o analytics incidentalmente.
- Se preservan los límites previos: no DNSExit; Apple oculto; Meta Pixel intacto; ninguna compra, campaña, cobro, devolución, cambio de rol o evento real sin el alcance correspondiente.
- No trasladar secretos personales de Nicolás ni sus sesiones de navegador para simular que el nuevo operador es autónomo.
- No exigir Kubernetes, ArgoCD, Terraform generalizado, nuevo broker, nueva plataforma de agentes ni reorganización completa del monorepo.
- La unificación de procedimientos no implica que todos los servicios compartan repositorio, rama, imagen, esquema o calendario de deploy.

## 2. Diagnóstico con evidencia

### 2.1 Qué dice CompAII y qué no demuestra

El [reporte del 6–9 de septiembre](http://10.10.20.69:8377/shared/REPORT-TO-CODEX-operational-handoff-retrospective.md?raw=1) es una retrospectiva, no una auditoría en vivo. Describe trabajo sustancial sin la entrega productiva de su misión #495/#68/#70. Identifica congelamientos sucesivos, contextos autor/revisor/fixer, límite de rondas y herramientas auxiliares que se volvieron camino crítico. Reconoce que la autorización permitía continuar reparando y desplegar mediante el procedimiento acordado.

No atribuir sin evidencia a Codex el origen de la regla de dos rondas. Tampoco convertir alegaciones de sobrescritura concurrente o un razonamiento sobre el SDK sin comprobar el transporte objetivo en incidentes establecidos. A la inversa, una vulnerabilidad puede demostrarse mediante inspección concluyente: no exigir siempre explotación en producción para considerarla bloqueante.

Mi diagnóstico: hubo **dos fallas complementarias**. El procedimiento existente duplicaba trabajo y contenía conocimiento tácito; la ejecución de CompAII fragmentó la responsabilidad y amplió los prerrequisitos sin cerrar la entrega. Mi flujo anterior también contribuyó a esa carga: por ejemplo, el aumento de memoria del reconciler pasó por #517 y #518, antes de volver a calificarse y compilarse al desplegar.

### 2.2 Observación actual del 9 de septiembre

Lectura en Mona a las 15:34 UTC y referencias remotas consultadas en este turno:

| Observación | Evidencia / significado |
|---|---|
| Live sirve `9a40237a4042345c6c76c24ba4b492faa40ee03c` | `/api/health`: `status=ok`; app, reconciler y tapestry saludables con esa etiqueta. No equivale a prueba acústica. |
| Hubo deploy exitoso hoy | [Run 34305682416](https://github.com/AlterMundi/harmonic-beacon-webapp/actions/runs/34305682416), 03:04:20–03:23:11 UTC. No demuestra entrega del lote pendiente de CompAII. |
| PR de promoción volvió a ejecutar E2E | [Run 34304766816](https://github.com/AlterMundi/harmonic-beacon-webapp/actions/runs/34304766816), head `6fcc8a6…`: job de 14m02s; workflow aproximadamente 14m05s. |
| Deploy repitió calificación y build | E2E 11m01s; job Mona 7m45s. Dentro de Mona: verificaciones de código 2m17s y build app+tapestry 4m03s. Total workflow 18m51s. |
| Son más de 32 minutos sólo en esos dos workflows consecutivos | Excluye trabajo local, PR a main, reparaciones y revisiones. No es una estimación de implementación ni el promedio de todos los cambios. |
| Ramas sin protección | API: `main`, `release`, `early-birds` con `protected=false`; listado de rulesets vacío. Mucha ceremonia no equivale a gates efectivos. |
| Main no representa todavía todo Live productivo | main `1317a69…` es ancestro de release; 0 commits sólo-main, 90 sólo-release; diferencia de árboles: 39 archivos, 1.446 inserciones y 80 eliminaciones. Los 90 commits no son 90 features faltantes. |
| Staging Live está en `a0de5cc…` | Contenedor saludable pero distinto del candidato y de producción. Su contrato excluye LiveKit/tapestry/reconciler: no puede certificar una sesión completa. |
| Account/Listen y analytics tienen releases propios | Account/Listen `38b6665…`; analytics `207318a…`; Authority `29da6b8…`, según imágenes observadas. No asumir que un deploy Live actualiza esas superficies. |
| No hay urgencia actual de capacidad | Raíz 50% usada, 96 GiB disponibles; `/mnt/beacon-data` 15%, 79 GiB disponibles. No es motivo para mover Docker data-root o podar indiscriminadamente. |

El [takeover audit del 6 de septiembre](/home/nicolas/Downloads/takeover-audit-20260906.md) agrega hallazgos históricos útiles: cobertura de recuperación desigual, acceso API a PMP no verificado para CompAII, restricciones de runner no verificables con su permiso y alertas extremo a extremo pendientes. No se repitió en este turno toda aquella auditoría; esos puntos se reconfirman por servicio cuando corresponda.

### 2.3 Trabajo redundante comprobado en el código

Fuente Live inspeccionada: release `9a40237…`.

- `.husky/pre-commit` ejecuta lint-staged y **todo Vitest por commit**.
- `ci.yml` compila Next, corre suites y analytics en PRs a main/release sin clasificar alcance de servicio.
- `e2e.yml` instala/compila el load tester de LiveKit en cada ejecución: 68s en el PR examinado y 95s en el deploy, antes del pequeño perfil de carga.
- Cada comando separado de Playwright levanta un servidor cuyo `webServer.command` es `npm run build && next start`. Hay invocaciones separadas para Chromium, Firefox y WebKit en PR; dos invocaciones Chromium en release. Se vuelve a solicitar el build dentro de una misma calificación.
- Al final de E2E se vuelve a ejecutar `docker build` para comprobar imports/entrypoints. Luego Mona vuelve a compilar app y tapestry.
- El helper hace `build app tapestry`, `stop app`, migraciones y `--force-recreate app commerce-reconciler tapestry` en todos los deploys, incluso cuando un servicio no cambió.
- Firefox y WebKit se omiten en el gate de release. Tenerlos verdes en otro SHA no certifica automáticamente el candidato exacto. Más ejecución no implica una mejor trazabilidad de la cobertura.
- La instalación de dependencias WebKit cambia fuentes y afecta screenshots Chromium. El workaround de ordenar instalaciones muestra que hay que fijar y aislar el entorno visual, no agregar rondas de revisión.
- La base fixture compartida obliga actualmente a `workers: 1`. Aumentar workers sin aislar datos introduciría carreras y resultados engañosos.
- El build fija `NEXT_PUBLIC_LIVEKIT_URL`, usada también en clientes. **Hoy no se puede prometer promover cualquier imagen staging a producción cambiando sólo el env.** Next incorpora esas variables al bundle; hay que resolver primero esa diferencia. [Referencia oficial de Next.js](https://nextjs.org/docs/app/guides/environment-variables).

## 3. Contrato de trabajo: menos ceremonias, responsabilidad completa

### Un responsable y una cola por servicio

CompAII será el responsable primario del delivery y la operación. Codex puede ayudar con implementación o revisión, pero no será una dependencia de disponibilidad. Un lote tiene un único coordinador; los colaboradores no escriben simultáneamente el mismo worktree ni se adjudican el deploy por terminar una parte.

Antes de empezar basta con registrar: resultado, alcance, rama/base, dueño, criterios de aceptación, restricciones y siguiente acción. Un PR puede tener varios commits legibles; no abrir un PR por cada reparación del mismo objetivo. Separar sólo cambios con riesgos, autoridades o posibilidades de despliegue realmente diferentes.

Un fallo detiene **la promoción**, no la reparación. El responsable arregla, vuelve a ejecutar la evidencia invalidada y continúa. No hay límite arbitrario de dos rondas ni pedido de permiso para continuar una reparación ya autorizada. Si aumenta el alcance o aparece un riesgo concreto, se explicita; no se disfraza de trámite técnico.

### Revisión proporcional

- Todo lote tiene diff revisado, pruebas pertinentes y auto-revisión adversarial del resultado integrado.
- No se exige un segundo agente para copy, CSS acotado, documentación o ajustes operativos rutinarios.
- Para permisos/publicación, pagos, migraciones y helper privilegiado se propone una revisión independiente del diff de riesgo. Un único reviewer sigue las correcciones del mismo lote; no se forma una cadena reviewer-del-reviewer. Usar el mecanismo permitido por el operador; no inventar aprobación humana permanente ni falsa independencia.
- Una revisión comprueba también composición con la base vigente, no sólo componentes aislados.
- Los comentarios deben indicar violación/invariante, evidencia, impacto y condición de cierre. No todos los comentarios son blockers. Un riesgo crítico razonado sin mitigación sí puede bloquear aunque no sea cómodo reproducirlo.
- Fallos de audio, sesión, auth, pagos, datos o aislamiento no se convierten en warnings para acelerar. Mejoras generales fuera del cambio no secuestran cada release.

### Qué se deja de hacer

No congelar de nuevo todo el workspace por editar un README; no rehacer auditoría de todo el ecosistema por cada botón; no pedir a Nicolás autorización técnica ya otorgada; no exigir resolver mensajería/monitorización global para desplegar un cambio independiente; no usar screenshots, manifests o reportes como sustituto del servicio publicado.

La fase de desarrollo usa hot reload aislado y pruebas enfocadas. El checkpoint integrado usa el artefacto real. No convertir cada guardado o commit en un ensayo general de producción. La skill [`fast-forward-mode`](../../.agents/skills/fast-forward-mode/SKILL.md) orienta esta separación entre iteración rápida y validación del lote y queda empaquetada en este repositorio para que Codex, CompAII/Hermes u otro agente compatible puedan compartir el mismo contrato de ejecución.

## 4. Flujo objetivo y selección de pruebas

```text
Lote + propietario → desarrollo/preview → PR + comprobaciones rápidas
                                            ↓ merge controlado
                        candidato exacto → build único por servicio
                                            ↓
                    calificación por riesgo sobre ese artefacto
                                            ↓
                       staging completo → promoción por digest
                                            ↓
                       smoke productivo → entrega / recuperación
```

### Decisión sobre merge y candidato

Primera implementación simple: comprobaciones rápidas requeridas en PR; **la calificación productiva costosa corre una sola vez sobre el SHA integrado**, antes de que pueda desplegarse. Merge no equivale a autorización de deploy. Un build o E2E fallido post-merge deja producción en la versión anterior y genera reparación del candidato.

No introducir de entrada un sistema propio que deduzca equivalencia entre SHAs de PR, merge y release. Hasta migrar los gates, los checks actuales siguen vigentes. El workflow nuevo se prueba en paralelo sin desplegar y sustituye al anterior cuando se demuestra su rechazo de candidatos inválidos.

Si el volumen de contribuciones luego lo justifica, usar la merge queue nativa para calificar el árbol integrado antes del merge; no hacerla requisito del primer ahorro. Requiere soporte de `merge_group`, no sólo `pull_request`. [GitHub: eventos de workflow](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

### Matriz de riesgo propuesta

El clasificador es determinista y pequeño, con reglas testeadas. Examina **el diff completo respecto del release productivo del servicio**, no sólo el último PR: puede haber cambios integrados aún no desplegados. Paths desconocidos, lockfiles compartidos, framework, layout raíz, contratos o configuración de compilación amplían la cobertura. Un label no permite rebajar lo que detecta el código.

| Clase | Ejemplos | Validación y despliegue |
|---|---|---|
| Documentación no ejecutable | Runbook sin cambiar comandos ejecutados | Links/sintaxis aplicable; sin build ni deploy. Markdown que contiene contratos generados o fixtures ejecutadas no se exime a ciegas. |
| Operación de datos/configuración | Agenda, sala de prueba, límite de memoria | Herramienta autorizada, validación, dry-run/diff, auditoría e idempotencia. Sin imagen nueva si el código no cambia. Reiniciar sólo si la configuración lo exige y es seguro. |
| UI acotada | Copy, componentes visuales sin lifecycle | Tipos/lint, unidad/componente, build único; recorridos mínimos reales y screenshots del área afectada en tamaños pertinentes. Cubrir motores pertinentes sin ejecutar toda la carga de LiveKit/analytics. |
| Funcional | Rutas, formularios, consultas, estados | Lo anterior + integración del dominio, migraciones si existen y E2E de journeys afectados. |
| Crítica o transversal | Audio, grants, OIDC/logout, pagos, DB, worker, infraestructura privilegiada | Suites completas de los dominios impactados, motores pertinentes, concurrencia/red adversa cuando corresponda, revisión de riesgo y recuperación verificada. |

La reducción de pruebas es por contrato y dominio, no por intuición del LLM sobre que “parece chico”. Empezar con clasificación conservadora y pocas excepciones. La matriz de audio/identidad existente no se reduce por llamarle UI a un cambio en el componente que monta la sala.

Una suite nocturna recorre todo el ecosistema, incluyendo pruebas largas de red/carga y drift. No es excusa para postergar a mañana las pruebas que protegen el cambio de hoy. Ante un fallo nocturno, identificar versiones y servicios afectados: ni ignorarlo ni bloquear arbitrariamente todos los repositorios.

### Evidencia reutilizable sin un framework nuevo

Dentro del mismo pipeline, los jobs consumen el mismo artefacto y sus resultados. Si sólo falló infraestructura transitoria se reintenta ese job; si cambia el código se recalcula el impacto. Un retry nunca convierte una regresión intermitente de audio/seguridad en aceptación silenciosa.

No revalidar en Mona unit tests, lint y compilación ya aceptados del artefacto. En destino comprobar **lo que sólo destino puede demostrar**: digest, configuración, esquema real, aislamiento, salud, rutas públicas, sesión/synthetic smoke pertinente y posibilidad de recuperación.

Inicialmente no crear una caché distribuida de “pruebas aprobadas”. La caché de dependencias/build ahorra trabajo; no constituye evidencia. Cualquier reutilización futura entre runs debe ligar árbol, dependencias, definición de pruebas, toolchain, inputs, entorno y origen confiable. Las attestations acreditan procedencia, no ausencia de bugs. [GitHub: artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations).

## 5. Diseño técnico concreto

### 5.1 Separar rama de integración y estado desplegado

En Live, reconciliar release hacia main preservando los 39 archivos diferentes y los hotfixes productivos. Hoy main es ancestro; no se requiere recrear todo el historial. Hacerlo en un PR revisado, sin reset/force-push ni merge automático de `early-birds`. Verificar de nuevo la relación al ejecutar: las ramas pueden cambiar.

Durante la transición, mantener `release` como vía vigente y usar una promoción explícita. Después de la convergencia, `main` integra Live y los manifiestos de deployment indican qué está en staging/producción. Retirar la necesidad de un segundo PR de promoción; conservar `release` como referencia histórica o puntero automatizado sin desarrollo independiente. No retirar el workflow antiguo hasta que el nuevo pueda desplegar y recuperar un candidato seguro.

Account/Listener conservan provisionalmente su lane `early-birds`. Eliminar su deuda de rama es otro trabajo acotado, no condición para que Live entregue. Cada consumidor valida sus contratos frente a la versión realmente desplegada del proveedor; un cambio compatible no exige desplegar todo a la vez.

### 5.2 Builds fuera de Mona, artefactos identificados por digest

- Buildx en runners de CI, cache de registro con alcance por servicio/toolchain y referencias fijadas; GHCR es la primera opción si los permisos existentes alcanzan. [Docker: cache en GitHub Actions](https://docs.docker.com/build/ci/github-actions/cache/).
- Un build de app produce el artefacto que prueban API, navegador y workers. Tapestry sólo se construye si cambió su cierre de dependencias. Lo mismo para playlist, analytics, Account y Listener.
- Ningún job de PR no confiable recibe secretos de producción o se ejecuta en Mona. No usar `pull_request_target` para ejecutar código del contribuidor con privilegios.
- Construir/push/promover releases únicamente desde contexto confiable. Mona tiene acceso pull mínimo y ejecuta el helper restringido, sin ser servidor habitual de compilación.
- Conservar el helper root-owned y su comprobación de procedencia. Su actualización es un deploy de tooling versionado, no editar `/usr/local/sbin` a mano para vencer un `cmp`.
- Fijar imágenes base y herramientas; caché que falla puede volver a construir, jamás saltar validación. Separar cachés de contribuciones no confiables y del release. Auditar dependencias en el punto confiable de calificación y periódicamente, no varias veces idénticas en el mismo recorrido.
- Adelgazar el runtime con cierre de dependencias probado: Next standalone y bundles/targets explícitos para workers y migrator, en lugar de asumir que puede quitarse `node_modules` sin romper scripts. Es optimización posterior, no prerrequisito del primer deploy.

Manifiesto automático mínimo por release: servicio, repo, SHA fuente, digest OCI, versión de build/toolchain, revisión no secreta de configuración, conjunto de migraciones esperado, compatibilidad app/worker/esquema, IDs de CI/staging/smoke, target de recuperación y timestamp. Sin tokens, dumps, emails ni contenido de env. Guardar el manifiesto como artefacto de Actions y recibo de deployment; no transcribirlo manualmente en diez cards.

### 5.3 Resolver configuración build-time antes de prometer la misma imagen

Live: inventariar `NEXT_PUBLIC_LIVEKIT_URL` en `Dockerfile`, `src/context/AudioContext.tsx`, `src/app/session/[id]/page.tsx` y `src/lib/livekit-server.ts`. Preferir el endpoint/configuración de sesión emitido por servidor en runtime, validado contra allowlist, con fallback explícito sólo donde corresponda. Ningún secreto del backend se serializa al cliente. No introducir una carga de configuración que reconecte la sala o remonte audio al cambiar locale.

Prueba de aceptación: el mismo digest arranca en dos stacks aislados con URLs/configuración distintas; cada browser conecta sólo a su RTC/origen; CSP, cookies y callbacks son correctos; health identifica el artefacto real. Auditar también flags de pagos, analytics y test-login para no hornear un modo de testing productivo.

Mientras haya inputs legítimamente fijados al build, producir variantes explícitas identificadas por esos inputs y calificar el artefacto de destino con entorno aislado. No llamar a eso “la misma imagen”. No bloquear la entrega de #495/#68/#70 por completar esta refactorización si las variantes actuales pueden probarse de manera segura.

### 5.4 CI en grafo, fixtures aisladas y una sola compilación por candidato

Refactorizar `ci.yml`, `e2e.yml`, `playwright.config.ts` y scripts de arranque de tests:

1. Primera mejora: sacar `next build` de cada arranque Playwright. Construir una vez, arrancar el servidor una vez por entorno y reutilizarlo entre suites, reseteando fixtures según contrato. Después pasar al contenedor candidato como servidor de la suite.
2. Separar unidad/estáticos, integración PG, navegador y runtime smoke. Emitir un resultado agregado siempre, incluso para docs-only, indicando qué era requerido y por qué. Fallar si falta o se omitió una comprobación requerida; `skipped` no vale como verde.
3. Fijar entorno visual (OS, fuentes, Playwright, viewport, locale y reloj). No aprobar baselines por regenerarlas hasta que el pipeline pase.
4. Paralelizar primero por jobs con DB/LiveKit y fixtures independientes, no cambiando `workers: 1` sobre la base compartida. Empezar con dos particiones medidas y ampliar sólo si baja el tiempo sin aumentar carreras/costo desproporcionado. [Playwright: CI](https://playwright.dev/docs/ci), [sharding](https://playwright.dev/docs/test-sharding).
5. Reutilizar el load tester compilado por checksum de fuente/toolchain. Mantener su pequeña prueba cuando el dominio de media/capacidad cambie; la carga larga va a ejecución programada o release que la necesite.
6. El workflow EarlyBirds ya tiene una matriz de red específica, incluida Firefox en macOS por codecs. Preservarla; no reemplazarla por Firefox Linux declarando equivalencia. Navegador móvil emulado no es un iPhone físico.
7. Registrar fallos en primer intento, retries, skips esperados y cobertura efectiva. Tests críticos inestables se reparan; no se silencian. `--only-changed` sirve de feedback local, no como selector único de aceptación.

### 5.5 Staging suficiente, sin exigir un espejo caro de todo

Reutilizar dominios y aislamiento existentes, sin DNSExit. Extender staging Live con LiveKit, tapestry y worker compatibles, datos sintéticos y origen de audio controlado. Separar claves, DB, red, volúmenes y room names de producción. Verificar WebSocket/TURN según el recorrido que se esté aceptando, no sólo HTTP 200.

Staging no debe compartir a ciegas el control-plane de eventos, pagos reales o sesiones productivas. Puede vivir inicialmente en Mona con límites de CPU/RAM/I/O y datos en el disco adicional; pruebas pesadas quedan fuera de Mona. Si una pieza requiere capacidad externa, sólo bloquea los cambios que necesitan esa prueba.

Preservar un workbench hot reload para UI y un staging de aceptación con imágenes inmutables. El workbench existente de Listener ya demuestra esta separación. Mostrar claramente en herramientas operativas qué modo es cuál; no agregar banners técnicos a la UI pública.

### 5.6 Deploy acotado, idempotente y recuperable

Extender el helper existente en vez de escribir otro executor general. Inputs tipados y allowlisted: servicio, digest aceptado, manifiesto, entorno y operación. Validar procedencia y permisos antes de cualquier mutación.

- Lock único por entorno/servicio y compare-and-swap del release base. Un run viejo no puede sobrescribir una versión más nueva. Cancelar CI obsoleto es correcto; cancelar un deploy ya migrando no.
- Antes de mutar: validar digest/manifest, diferencias de configuración, drift, capacidad real, estado de migraciones, conexiones/sesiones si afectan disponibilidad y target de rollback compatible.
- Sólo ejecutar migraciones si hay pendientes; no inferirlo únicamente del diff Git. Separar validación de estado y operación de migración del restart rutinario.
- No reiniciar tapestry, playlist u otros servicios intactos. App y worker se despliegan juntos cuando su contrato lo requiera, no por hábito.
- Mantener la protección de sesiones activas para cambios que puedan interrumpirlas. Estado DB y realidad LiveKit deben concordar. Cero `LIVE` en DB no basta si hay medios activos inesperados.
- No prometer hot deploy de WebRTC sin demostrar continuidad de mounts, leases, cookies, assets y workers. Blue/green puede reducir downtime de web stateless después; no es el primer requisito ni habilita duplicar publishers/workers.
- Job interrumpido: el sucesor lee recibo y estado real y continúa desde un checkpoint idempotente. No vuelve a aplicar migraciones, grants o side effects para “empezar limpio”.
- Health público comprueba SHA/digest servido y rutas relevantes. Smoke sintético aislado comprueba comportamiento; no cobrar, crear membresías reales ni manipular eventos existentes.

La aplicación de hoy marca migración intentada y quiesce incluso para cambios de código sin esquema. Separar esos caminos hará más frecuente el rollback simple sin relajar los bloqueos reales de grants.

### 5.7 Backups y rollback: trabajo correcto una vez, no omisión ni ceremonia universal

Construir sobre scripts existentes de analytics, PMP y Account, con un adaptador específico Live si falta. Nada de nueva plataforma de recovery como requisito general.

- Mapa explícito servicio → DB/archivos → backup → clave disponible en host autorizado → restore → RPO/RTO medidos. Confirmar cobertura real; PMP no respalda todas las DB de Beacon.
- Copias cifradas por servicio bajo `/mnt/beacon-data/backups`, mount real obligatorio, permisos restrictivos, capacidad de reserva y retención. Mantener off-host donde ya exista; comprobar frescura/decryptabilidad sin copiar secretos al agente.
- Backup/restore periódico automatizado fuera del camino crítico de UI. Antes de una migración, backup fresco del servicio y restore aislado de ese artefacto, aplicando la migración candidata sobre la copia cuando corresponda. Un checksum o `pg_restore --list` solo no demuestra recuperación funcional.
- UI sin esquema: comprobar salud del régimen de recuperación y rollback de imagen/configuración; no volcar y restaurar todas las DB para cambiar un texto.
- Schema expand/contract, compatibilidad N/N-1 y migraciones destructivas separadas. No “revertir DB” automáticamente después de aceptar nuevas escrituras: podría perder pagos/eventos/grants legítimos.
- Grants: conservar compatibilidad de app, worker y esquema; no declarar seguro un rollback por existir un tag o dos archivos. Probarlo con deuda y fences activas, efectos sin aplicar y horizonte vencido. Si la recuperación segura exige mantener un worker compatible, ese comportamiento debe quedar implementado y probado antes de usarlo.
- Si el rollback no es seguro, fallar cerrado según el contrato y usar un artefacto de forward-repair compatible. No desbloquearlo borrando outbox/grants ni apagando workers por intuición.
- Ensayar en staging fallo de pull, arranque, migración, health y pérdida del runner; verificar qué permanece sirviendo y cómo recupera el siguiente run.

Retención: conservar release actual, al menos dos anteriores **compatibles**, cualquier candidato/rollback fijado por una operación activa, manifests/configuración necesarios y backups pertinentes. Podar sólo caché builder y artefactos demostrablemente no referenciados con TTL/cuota. Prohibido `docker system prune -a --volumes`. Reducir builds antes de aumentar capacidad.

### 5.8 Separar operaciones de producto de releases de código

Los cambios de agenda y la creación de un ensayo aparecen hoy como migraciones y PRs. Darles un camino operativo existente o un comando pequeño, versionado, autorizado e idempotente con dry-run y recibo. Cambiar un horario no debería requerir compilar Next, tapestry y LiveKit. No convertir cambios arbitrarios de datos en SQL libre.

Lo mismo para parámetros de infraestructura: un límite de memoria no cambia la imagen, aunque sí necesita validación y un restart seguro del servicio afectado. Un control runtime de ganancia sólo se usa si ya existe contrato seguro; este proyecto no introduce remotamente DSP o recargas forzadas bajo la etiqueta de optimización del workflow.

## 6. Cobertura del ecosistema y transferencia a CompAII

### Catálogo de servicios, no otro manual duplicado

Proponer `deploy/platform-services.yml` como inventario pequeño validado, un `docs/ops/OPERATING_CONTRACT.md` y un `AGENTS.md` raíz corto que enlace esos dos y los runbooks existentes. No copiar todos los runbooks al prompt ni guardar SHAs “actuales” en memoria permanente.

| Superficie | Autoridad inicial que debe figurar | Adaptación del workflow |
|---|---|---|
| Home | `AlterMundi/harmonicbeacon.com`, main, hosting actual | Mantener build estático y deploy propio. CI observado tarda segundos, no arrastrarlo al Docker de Live. Verificar fingerprint/links y contratos compartidos. |
| Live / Ops | `AlterMundi/harmonic-beacon-webapp`, hoy release | Piloto completo de este plan. Reconciliar main/release sin perder comportamiento productivo. |
| Tapestry / playlist / media | Servicios del repo webapp, runtime propio | Imágenes independientes y pruebas de contrato/bytes. No reiniciarlos por cambios ajenos. Fijar versión real de LiveKit, no confiar en la etiqueta `latest`. |
| Account / Listen | webapp, lane early-birds | Envolver los scripts existentes de preparación, activation, smoke y rollback; pruebas OIDC/cookies/logout, cuota/listening y contratos de Authority. No exigir merge global a main. |
| Analytics | `services/analytics`, `ops/analytics` del webapp | Pipeline, esquema y backups propios. Ningún deploy Live por cambiar una consulta del dashboard, ni viceversa salvo contrato compartido. Epic de producto sigue separada. |
| Pagos / Authority / PMP | Auditoría histórica identifica runtime y repo PMP canónico | Confirmar por servicio repo/SHA/DB/comando antes de automatizar. Verificar permiso PR/CI de CompAII; acceso Git desde Mona no equivale a API. Sandbox para pruebas; nada de dinero real. |

### Lo necesario para que opere desde su host

Un diagnóstico read-only `doctor` debe devolver por servicio: source/deployed revision, accesos concretos (sin valores secretos), workflow, runner permitido, staging, salud, recuperación, alerts y drift. No inspeccionar toda la red ni inferir autoridad a partir de sudo.

Instalar la skill versionada desde `.agents/skills/fast-forward-mode/` en el directorio de skills del perfil activo. En Hermes ese destino es el `skills/` físico del perfil bajo `~/.hermes/profiles/<perfil>/`; hay que usar el perfil que efectivamente ejecuta CompAII, no adivinar su nombre. Reiniciar o recargar la sesión para que vuelva a descubrir skills. La carpeta incluye sólo instrucciones y metadata: no ejecuta código ni concede permisos. Verificar luego que `$fast-forward-mode` aparezca en el catálogo y hacer una invocación de prueba sin mutaciones.

Verificar una sola vez permisos GitHub de PR/merge/Actions/packages/deploy y restricciones de runner; refrescar ante cambio o error. Si hace falta admin para una regla o autorización de paquete, pedir el cambio puntual: no un token omnipotente ni acceso a la cuenta de Nicolás.

Las entradas antiguas de skill/memoria de CompAII que indican `/opt/beacon/app`, alias SSH inexistentes o Compose directo se marcan históricas y enlazan el contrato actual. No borrar historia ni volcar credenciales a HMK. Este plan no modifica su host ni su skill remota sin el paso explícito de implementación.

Operación disponible significa recepción y tratamiento de alertas, no sólo host encendido. Integrar con el canal operativo ya disponible; un mecanismo simple existente de alerta + consulta programada de estado basta. La nueva mensajería bilateral no bloquea Beacon. Evitar wakeups LLM constantes para preguntar si CI terminó: aprovechar eventos/esperas del producto y resúmenes de Actions.

### Estado persistente mínimo

Un recibo canónico por intento, generado por CI/helper, y un pequeño puntero de trabajo para el operador:

`objetivo; propietario; repo/lane; base; candidate/digest; gates y run IDs; staging; production anterior/actual; recovery target; blocker concreto; siguiente comando seguro`.

Estados distinguibles: trabajando, esperando CI, reparando, candidato apto, desplegando, verificando, entregado, bloqueado externamente. Sólo el último requiere input. Esperar CI no es “stalled”, ni terminar un commit es “entregado”. Actualizar al cambiar de fase, no narrar cada herramienta ni producir un documento nuevo por reparación.

## 7. Implementación en lotes verificables

No abrir una gran epic de infraestructura que impida terminar el trabajo funcional existente. Cada lote deja el sistema entregable. Las rutas nuevas de esta sección son propuestas, no comandos ya instalados.

### Lote A — Destrabar ownership y recuperar el trabajo en curso

1. Leer este plan y reconfirmar sólo repos/PRs/SHAs/health que puedan haber cambiado.
2. Obtener el puntero vigente de CompAII a `agent-memory/state/GOAL-beacon-495-68-70-PROGRESS.md` y su worktree/branch real. El reporte lo cita; no se obtuvo su contenido en esta auditoría. No asumir que lo local de Nicolás contiene el trabajo.
3. Inventariar cambios y revisiones pendientes del lote #495/#68/#70, sin absorber #519/#520, #93, el overhaul completo #469 ni analytics. Respetar la composición/aceptación ya acordada en esas issues.
4. Adoptar un propietario y resolver los blockers concretos. Reutilizar backup/restore existente o adaptador mínimo; no terminar Matrix para poder desplegar Live.
5. Publicar un único PR integrado, calificar y desplegar mediante el camino vigente cuando esté realmente listo. Si conviene aplicar antes una mejora mínima de CI del lote B, hacerlo acotadamente; no condicionar esta entrega a construir todo el plan.

Aceptación: se conoce dónde está el trabajo, qué falta de verdad y quién lo lleva hasta producción. Su entrega final se acredita con candidato, checks, smoke y evidencia del comportamiento; no declarar #495/#68/#70 listas desde esta auditoría.

### Lote B — Quitar recomputación sin cambiar aún la política de cobertura

Archivos: `.husky/pre-commit`, `.github/workflows/e2e.yml`, `.github/workflows/ci.yml`, `playwright.config.ts`, script existente de load tester; añadir un script pequeño de arranque fixture si hace falta.

1. Medir baseline de runs por job/step/build, incluido tiempo de cola y costo de runner; conservar números del apartado 2.
2. Quitar todo Vitest del hook por commit; mantener lint-staged y comando explícito para test local pertinente. La suite sigue en CI.
3. Compilar una vez por entorno E2E, no en cada invocation; probar reset de DB/browser y no compartir servidores entre candidatos.
4. Cachear load tester por inputs verificables y fijar entorno visual. No actualizar dependencias/SDK audio incidentalmente.
5. Separar jobs sólo donde haya aislamiento demostrado. Mantener misma lista de tests requeridos y comparar resultado/skip/retries.

Aceptación: idéntica cobertura efectiva del lote base, menos builds contados, menos duración medida, ningún código de producción/audio modificado. Un cambio equivalente al ajuste de memoria no vuelve a compilar por cada motor.

### Lote C — Autoridad, protección y ramas coherentes

Archivos: `AGENTS.md`, `docs/ops/OPERATING_CONTRACT.md`, `deploy/platform-services.yml`, docs existentes; reglas de GitHub en cambio explícito auditable.

1. Catálogo de servicios y contrato de permisos, responsable y camino de recuperación.
2. Convergencia Live release → main preservando hotfixes. Mantener EB separado; actualizar PRs afectados sin sobrescribir trabajo ajeno.
3. Checks requeridos con un agregador siempre emitido; prohibir force-push y pushes directos rutinarios. Proteger cambios de workflows/helper y ambiente productivo con identidades/caminos explícitos.
4. Comprobar restricciones reales del runner Mona. Nunca correr PR no confiable allí.
5. Hacer tests negativos: check faltante, fallido, cancelado, skipped requerido, candidato/base obsoleto. Deben impedir promoción, no dejar un verde engañoso.

GitHub puede dejar pendientes checks de workflows omitidos por filtros de paths; filtrar jobs y emitir un agregador evita ese bloqueo. [GitHub: sintaxis de workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

Aceptación: un contributor no puede saltar el gate normal y CompAII conoce un solo camino válido por servicio. Si falta permiso admin, preparar y pedir exclusivamente ese cambio; no detener trabajo de código independiente.

### Lote D — Artefacto único, staging real y promoción del mismo digest

Archivos: Dockerfile, compose, workflows de build/qualify/deploy, helper root, configuración runtime indicada en 5.3 y staging.

1. Resolver inputs runtime o declarar variantes; prueba de doble entorno sin contaminación.
2. Build confiable en CI, registry y manifest. Ejecutar runtime smoke sobre el mismo digest, incluidos imports de workers/migrator.
3. Completar staging Live necesario para media; usar fixtures y secretos separados.
4. Workflow de promoción verifica calificación del SHA integrado y digest exacto; no `docker build` ni `npm ci/test/lint` de nuevo en Mona.
5. Transición controlada: primero modo shadow sin deploy; luego un servicio/cambio reversible; conservar workflow/helper anterior utilizable hasta probar recuperación. Retirar doble PR/calificación al demostrar la nueva barrera.

Aceptación: pruebas consumen el digest que termina en staging y producción; manipular digest/origen/configuración invalida promoción. Ningún build routine en Mona; una falla de CI no cambia producción.

### Lote E — Gates por impacto, operación de datos y recuperación integrada

Archivos propuestos: `scripts/ci/change-impact.mjs`, catálogo de suites; adaptar scripts de deploy/backup existentes y la superficie/comando de agenda.

1. Implementar clasificador conservador con fixtures de diffs; contra release desplegado, incluyendo cambios acumulados y dependencias compartidas.
2. UI, funcional y crítica con matrices explícitas; suite completa periódica; no bajar cobertura crítica a nightly.
3. Pull/replace sólo de servicios afectados; migración condicional según estado DB real; back up/restore requerido por cambio de datos/esquema.
4. Recuperación ensayada con fallos y restart del runner; compatibles app/worker/DB y fences, sin eliminación de datos.
5. Sacar agenda/configuración operativa del circuito de builds donde exista autorización: herramienta pequeña idempotente, diff, auditoría y rollback/compensación aplicable.

Aceptación: docs no despliegan; CSS no migra DB ni reinicia tapestry; cambios auth/audio/grants conservan su matriz crítica; una operación de agenda no necesita imagen nueva; candidato viejo no pisa uno nuevo; operaciones repetidas no duplican efectos.

### Lote F — Extender a Account, Listen, analytics y Authority; takeover probado

1. Adoptar el mismo contrato con adaptadores por servicio, reusando los scripts de su lane y repo propietario.
2. Resolver accesos estrictamente faltantes, sin copiar credenciales personales. Auditoría de alertas y backup/restore por servicio.
3. E2E cross-domain de contratos para cambios que lo necesitan; sandbox/fixtures canónicas de pagos. No tocar proveedores reales para demostrar delivery.
4. CompAII ejecuta desde su host un cambio pequeño real autorizado de principio a fin; Codex no rellena pasos manuales ocultos.
5. Recuperar un intento interrumpido y ensayar rollback en staging; demostrar que apagar la computadora de Nicolás no deja huérfano el proceso.
6. Actualizar runbooks/memoria por enlace, archivar instrucciones supersedidas y medir resultados. Volver al goal analytics con esta base, sin mezclarlo silenciosamente en los PRs del pipeline.

Aceptación: cada superficie tiene fuente, workflow, digest/fingerprint, observabilidad y recuperación identificables; una entrega repetible no depende de la memoria ni del navegador de Nicolás/Codex.

## 8. Cómo medimos que mejoró

No dar una duración humana de implementación disfrazada de certeza. Instrumentar tiempos reales: desde candidato listo hasta verificado en producción, cola, build, tests, revisión, reparación, deploy, rollbacks y tiempo del agente consumido esperando/reconstruyendo contexto. Separar latencia total de minutos de cómputo facturados.

Indicadores de aceptación:

- Un build de release por servicio/input que cambió; cero recompilaciones al promover el mismo digest.
- Cero pedidos de aprobación para continuar reparaciones ya autorizadas; sí escalación clara de credenciales/autoridad/riesgo real.
- Cero merges/promociones normales saltando sus checks efectivos.
- Menor tiempo mediano y p95 por clase sin aumento de fallos escapados; registrar retries y rollbacks, no esconderlos.
- Cero escritura fallback en raíz cuando falte el disco de backups; retención que conserva recuperación compatible.
- Ejercicio de takeover y recuperación desde el host de CompAII sin intervención de Codex.

Presupuestos iniciales de latencia **a validar, no promesas**: operación simple/config 2–5 min; cambio UI con caché 5–10 min hasta deploy; lote funcional/crítico ordinario 10–20 min más pruebas largas que efectivamente necesite. El punto de partida observado de promoción Live es ~33 min entre PR E2E y Deploy, además del resto del proceso. Meta inicial: reducir al menos a la mitad ese recorrido comparable, no quitar pruebas hasta cumplir un cronómetro.

No introducir esperas universales de observación de una hora. Ventana post-deploy según el modo de fallo: smoke inmediato más monitoreo automático; audio/red o colas necesitan su ventana contractual, no el mismo cooldown aplicado a todo.

## 9. Arranque para la próxima sesión en medium

Leer este documento. Mantener el trabajo actual del usuario en `feat/ux-professionalization` intacto: al investigar había `docs/README.md` modificado, `docs/research/` sin tracking y un archivo de nombre extraño sin tracking. No limpiar ni agregar esos archivos a un commit propio. Crear un worktree dedicado bajo `Projects/harmonic-beacon-worktrees/` cuando se autorice implementar.

Orden de ejecución: A para recuperar ownership; B para ahorro inmediato compatible con la entrega pendiente; C y D para automatización segura; E para proporcionalidad; F para ecosistema completo. Avanzar el producto pendiente en cuanto sus gates estén cumplidos, sin esperar completar C–F.

Antes de actuar, verificar remotos y nuevos cambios. Las referencias de este documento son evidencia del 9 de septiembre, no targets permanentes. No reiniciar la auditoría global salvo que haya drift relevante. No crear otro controlador ni una nueva ronda de planificación por defecto.

Mensaje de continuidad sugerido:

> Implementá el plan `docs/plans/2026-09-09-efficient-delivery-and-operations.md` por lotes, empezando por recuperar el trabajo vigente de CompAII y quitar compilaciones repetidas sin reducir cobertura. Mantené un responsable hasta producción y preservá los cambios ajenos. Cada lote debe dejar una mejora utilizable y evidencia; no hagas de toda la modernización un prerrequisito para terminar #495/#68/#70. Conservá los límites de DNSExit, pagos reales, Apple y Meta Pixel. Informá bloqueos concretos y sólo pedí la autoridad externa que realmente falte.

## 10. Fuentes y límites de esta auditoría

- Retrospectiva CompAII enlazada arriba: leída íntegra; informe histórico de su misión, no logs completos ni estado actual de su worktree. Su progress file referenciado no estuvo disponible en la URL compartida consultada.
- Takeover audit 2026-09-06 en Downloads: contratos/observaciones históricos; no reutilizar sus timestamps de backups, fences o permisos como estado de hoy.
- [Código exacto Live auditado](https://github.com/AlterMundi/harmonic-beacon-webapp/tree/9a40237a4042345c6c76c24ba4b492faa40ee03c): workflows, Dockerfile, Playwright, helper y staging.
- [Lane EarlyBirds auditada](https://github.com/AlterMundi/harmonic-beacon-webapp/tree/7d54c05ba65d4dae9eca75744dc6c2af2bfdaed5): workflow, workbench UI y scripts de Account/Listener.
- [PR #529](https://github.com/AlterMundi/harmonic-beacon-webapp/pull/529), runs indicados y API de branches/rulesets. [#517](https://github.com/AlterMundi/harmonic-beacon-webapp/pull/517) y [#518](https://github.com/AlterMundi/harmonic-beacon-webapp/pull/518) documentan el doble circuito del ajuste de memoria.
- Issues [#495](https://github.com/AlterMundi/harmonic-beacon-webapp/issues/495), [#68](https://github.com/AlterMundi/harmonic-beacon-webapp/issues/68), [#70](https://github.com/AlterMundi/harmonic-beacon-webapp/issues/70): batch aprobado, aún abiertas al consultar. No se auditó ni calificó su implementación pendiente en este turno.
- Mona: lectura de contenedores, health Live y disco; sin inspección de datos personales, joins, pagos, prueba audible, restore o reinicios. Salud del proceso no prueba ausencia de regresiones del producto.
- Documentación técnica primaria enlazada junto a las decisiones. Se validaron mecanismos, no se recomienda actualizar ciegamente a las versiones de ejemplo que muestran las páginas hoy.

Este archivo es el único artefacto nuevo de la propuesta. No se modificaron issues, reglas, skills remotas, pipelines ni producción; ninguna de las optimizaciones descritas está declarada implementada.

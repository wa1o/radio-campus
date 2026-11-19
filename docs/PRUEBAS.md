# Pruebas y evidencias

## Pruebas automáticas

```bash
cd server
npm test        # unitarias
TEST_DATABASE_URL=postgres://usuario:clave@localhost/radio_test npm run test:e2e
```

### Unitarias (`test/context.test.js`, `test/youtube.test.js`)

11 pruebas, todas aprobadas. Cubren rangos horarios que cruzan medianoche, evaluación de condiciones, combinación de reglas por prioridad (la temperatura ajusta el ambiente dentro de la franja horaria), regla exclusiva de exámenes, selección temática por festividad, relajación de reglas, caso sin reglas e importación de playlists de YouTube.

### Integración: ronda completa (`test/e2e.test.js`)

Levanta el servidor real contra PostgreSQL 16, simula la pantalla del campus con un cliente Socket.IO y varios teléfonos con cookies independientes. Ronda de 3 segundos. Salida de una ejecución (19/11/2026, aprobada en 4 de 4 ejecuciones):

- login de administrador OK; /api/admin sin token → 401
- catálogo: 8 canciones, 2 reglas, lista de respaldo #1
- ronda #1: Pop 1 vs Pop 3 (regla: Día energético)
- votos: Pop 1=2, Pop 3=1; voto repetido → 409 «Ya votaste en esta ronda»
- cierre automático: ganó «Pop 1» (votos); voto tardío → 409
- reproduce la ganadora: https://audio.example.edu/Pop%201.mp3
- contexto cambiado a exámenes: Pop 2 vs Rock 1 → Instrumental 3 vs Instrumental 1
- ronda sin votos → «Rock 1» (sin votos: respaldo)
- anuncio #1 entre canciones; luego suena «Rock 1»
- tras reiniciar: ajustes iguales, 8 canciones, 2 rondas cerradas en historial
- respaldo exportado (8 canciones, 2 reglas) y restaurado

Qué comprueba cada paso:

| Criterio de aceptación | Verificación automática |
|---|---|
| Selección contextual de dos canciones | Las candidatas cumplen la regla activa (pop/rock), excluyen la canción `explicit` y la canción actual |
| Registro de votos desde distintos dispositivos | Tres dispositivos votan; el voto repetido y el voto a una opción ajena se rechazan |
| Cierre automático y resultado | El servidor cierra la ronda con su temporizador, declara la ganadora por votos y rechaza votos tardíos |
| Reproducción de la ganadora | Al terminar la canción, la pantalla recibe el comando `play` con la canción ganadora |
| Un cambio de contexto cambia las opciones | Al activar un evento de exámenes, la ronda regenerada solo ofrece instrumental |
| Rondas sin participación | Se resuelven con la lista de respaldo, según la regla configurada |
| Anuncio autorizado entre canciones | Suena el anuncio vigente (no el vencido) y después la música, sin superponerse |
| Ajustes persistentes al recargar | Tras reiniciar el servidor, los ajustes, el catálogo y el historial se conservan |
| Respaldos | El respaldo JSON se exporta y restaura los valores modificados |
| Seguridad | El panel sin token responde 401 |

## Pruebas manuales (en el entorno publicado)

Elementos que la prueba automática simula y deben verificarse a mano con la pantalla real:

| # | Prueba | Resultado esperado | Resultado |
|---|---|---|---|
| 1 | Abrir `/screen?key=…` en la pantalla horizontal y pulsar *Activar pantalla* | Suena la música de YouTube; se ven canción actual, dos opciones, QR, temporizador y avisos | |
| 2 | Escanear el QR con dos teléfonos distintos (Android e iPhone) y votar | Confirmación en cada teléfono; el conteo sube en la pantalla al instante | |
| 3 | Intentar votar dos veces desde el mismo teléfono | Mensaje «Ya votaste en esta ronda» | |
| 4 | Esperar el fin del temporizador | La pantalla muestra la ganadora; al terminar la canción suena esa canción | |
| 5 | Ajustes → simular evento Exámenes → Control → *Regenerar ronda* | Las nuevas opciones son de la regla de exámenes | |
| 6 | Crear anuncio → *Generar voz* → *Escuchar* → *Aprobar* (frecuencia 1) | Al terminar la canción se oye el anuncio y luego la siguiente canción | |
| 7 | Cambiar la duración de la ronda y recargar el panel | El valor se conserva | |
| 8 | Desconectar la red de la pantalla 10 s y reconectar | Indicador «Sin conexión», reconexión automática y reproducción continúa | |
| 9 | *Pausar* y *Reanudar* desde el panel | Música y temporizador se detienen y continúan | |

Se recomienda grabar un video corto de los pasos 1 a 6 como evidencia de la demostración integrada.

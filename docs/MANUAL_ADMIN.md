# Manual de operación para el administrador

Entra a `https://<tu-dominio>/admin` con tu correo y contraseña. La sesión dura 8 horas.

## Control (pantalla principal)

- **Estado**: fase (reproduciendo, anuncio, en espera), si la pantalla del campus está conectada, reglas aplicadas y contexto actual (hora, temperatura, eventos). Si ves «Contexto simulado activo», alguien dejó una simulación en Ajustes.
- **Sonando / Ronda / Cola**: canción actual, votos en vivo y la que sigue.
- **Pausar / Reanudar**: detiene música y temporizador; al reanudar la ronda continúa con el tiempo que le quedaba.
- **Saltar**: termina la canción o el anuncio actual y pasa a la siguiente.
- **Regenerar ronda**: descarta la votación abierta y propone dos opciones nuevas con el contexto actual (útil tras cambiar reglas o eventos).
- **Fijar como siguiente**: elige manualmente la próxima canción; tiene prioridad sobre la votación.
- **Último error**: fallas del reproductor o falta de canciones.

## Canciones

Cada canción necesita título, artista, proveedor y referencia:

- **YouTube**: el ID de 11 caracteres del video (lo que sigue a `v=` en el enlace).
- **Audio licenciado**: URL directa HTTPS a un archivo de audio con licencia de reproducción pública.

Etiquetas que usa el algoritmo: **género**, **energía** (baja/media/alta), **ambiente** (p. ej. alegre, tranquilo, fresco), **temáticas** (p. ej. navidad, día-del-estudiante) y **restricciones** (p. ej. `explicit`). Usa siempre las mismas palabras, en minúsculas, porque las reglas comparan texto exacto.

**Traer playlist de YouTube**: pega el enlace de una playlist pública; se importan hasta 500 videos sin etiquetas y se crea una lista con ellos. Después edita cada canción para etiquetarla. Desactiva (no borres) las canciones que ya no quieras ofrecer; las que tienen historial no se pueden eliminar.

## Listas

Agrupan canciones. Al menos una debe ser la **lista de respaldo** (se elige en Ajustes): música segura para cualquier momento, con varias canciones, que se usa cuando no hay opciones suficientes o faltan datos de clima o calendario.

## Reglas contextuales

Una regla tiene **condiciones** (cuándo aplica) y **filtros** (qué música permite).

- Condiciones: rango horario (admite cruzar medianoche, p. ej. 22:00–02:00), temperatura mínima y/o máxima, tipo de evento activo. Las condiciones vacías no restringen.
- Filtros: géneros, energías (`low`, `medium`, `high`), ambientes y temáticas, separados por comas. Vacío = cualquiera.
- **Prioridad**: número mayor gana. Si varias reglas coinciden, se combinan: cada filtro lo define la de mayor prioridad que lo tenga y las demás completan el resto.
- **Exclusiva**: si coincide, se ignoran las reglas de menor prioridad.

Ejemplo de configuración:

| Regla | Prioridad | Condición | Filtros |
|---|---|---|---|
| Mañana | 1 | 07:00–12:00 | energía: medium |
| Mediodía | 1 | 12:00–15:00 | energía: high |
| Calor | 2 | temp. mín. 32 | ambientes: fresco, tranquilo |
| Navidad | 5 | evento: Festividad | temáticas: navidad |
| Exámenes | 10, exclusiva | evento: Exámenes | géneros: instrumental · energía: low |

Si una combinación deja menos de dos canciones, el sistema descarta primero las reglas de menor prioridad; si aun así no alcanza, usa la lista de respaldo.

## Eventos

Registra festividades (tipo *Festividad*), periodos de exámenes (*Exámenes*) y otros (*Evento*) con inicio y fin. Mientras un evento está vigente activa las reglas de su tipo. Los tres más próximos se muestran en la pantalla pública.

## Anuncios

1. **Crear**: escribe el texto (claro y breve; se lee en voz alta), la vigencia (desde/hasta), el horario del día en que puede sonar y la frecuencia (cada *N* canciones).
2. **Generar voz**: crea el audio con Google Text-to-Speech.
3. **Escuchar**: revisa la vista previa.
4. **Aprobar**: solo los anuncios aprobados y con voz se reproducen y se muestran en la pantalla.

Si editas el texto, el audio se borra y el anuncio vuelve a borrador para que lo revises de nuevo. Los anuncios vencidos o fuera de horario no suenan. **Retirar** lo devuelve a borrador.

## Estadísticas

Rondas cerradas, rondas sin votos, total y promedio de votos, historial de las últimas 50 rondas (candidatas, votos, ganadora, cómo se resolvió y qué regla aplicó) y de reproducciones. Desde el historial puedes ver los votos de cada ronda.

## Ajustes

- **Duración de la ronda** en segundos (recomendado: 60–120; si es mayor que la canción, la ronda cierra cuando termina la canción).
- **Desempate**: aleatorio, la menos reproducida o la primera opción.
- **Ronda sin votos**: aleatoria entre las dos o una canción de la lista de respaldo.
- **Evitar repetir** las últimas *N* canciones.
- **Restricciones excluidas**: etiquetas que nunca se ofrecen (p. ej. `explicit`).
- **Lista de respaldo**.
- **Simulación de contexto**: fija hora, temperatura o evento para demostraciones. Déjala vacía en operación normal.
- **Respaldo de configuración**: *Descargar respaldo* (JSON) y *Restaurar desde archivo*.

Los cambios se guardan en la base de datos y se aplican desde la siguiente ronda (o de inmediato con *Regenerar ronda*), sin tocar el código.

## Rutina sugerida

- Inicio del día: revisar en Control que la pantalla esté conectada y sin errores.
- Semanal: registrar eventos próximos, preparar anuncios y descargar un respaldo.
- Al iniciar exámenes o festividades: comprobar que exista el evento y que la regla correspondiente tenga canciones suficientes.

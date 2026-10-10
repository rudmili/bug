---
name: conventional-commits
description: Reglas para crear commits de git con Conventional Commits, en inglés, agrupando los cambios en commits atómicos. Usar SIEMPRE que el usuario pida hacer un commit, commitear, guardar cambios en git, agrupar cambios, escribir un mensaje de commit, o cuando termine una tarea y haya cambios pendientes que registrar, aunque no mencione "Conventional Commits".
---

# Conventional Commits

Los commits siguen el formato Conventional Commits, se escriben **en inglés** y
agrupan los cambios en unidades lógicas pequeñas.

## Formato

```
<type>(<scope>): <description>

<body optional>

<footer optional>
```

Ejemplo:

```
feat(order): add cancellation endpoint

Allow customers to cancel an order while it is still in PENDING state.
Cancelled orders keep their record with a CANCELLED status instead of
being deleted, so reports stay consistent.
```

## Tipos permitidos

| Tipo | Uso |
|---|---|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de un error |
| `refactor` | Cambio de código sin alterar el comportamiento |
| `test` | Añadir o modificar tests |
| `docs` | Solo documentación |
| `chore` | Mantenimiento (dependencias, configuración) |
| `build` | Cambios en el build (Gradle) |
| `ci` | Integración continua |
| `perf` | Mejora de rendimiento |
| `style` | Formato, sin cambio de lógica |

No usar otros tipos.

## Scope

- El scope es **el nombre de la feature** (paquete): `user`, `order`, `product`.
- Para cambios transversales usar `shared` o `config`.
- Para `build`, `ci` y `chore` que afectan a todo el proyecto, omitir el scope.
- Un commit tiene un solo scope. Si el cambio toca dos features, son dos commits.

## Asunto (primera línea)

- Máximo 50 caracteres (límite duro: 72), incluyendo tipo y scope.
- Modo imperativo: `add`, `fix`, `remove`, `rename`. Nunca `added`, `adds`, `fixing`.
- En minúscula tras los dos puntos y **sin punto final**.
- Específico: qué se cambia, no "update code" ni "fix bug".

## Cuerpo (opcional)

- Solo cuando el asunto no basta: explica **el porqué** y el contexto, decisiones
  tomadas o efectos secundarios. No explica el cómo (eso lo muestra el código).
- Separado del asunto por una línea en blanco. Líneas de máximo 72 caracteres.
- En cambios triviales, omitirlo.

## Footer

- **Solo se usa `BREAKING CHANGE:`**, para cambios incompatibles, explicando cómo
  migrar. Además se marca con `!` tras el tipo o scope: `feat(api)!: remove v1 endpoints`.
- **No usar** `Co-authored-by`, `Reviewed-by`, `Signed-off-by` ni ningún otro trailer
  de coautoría, revisión o firma.
- **No añadir** referencias a tickets ni issues (`Closes`, `Fixes`, `Refs`). El
  proyecto no usa tickets.
- No añadir firmas, frases de "generado con" ni menciones a herramientas.

## Cómo agrupar los cambios

1. **Commits atómicos**: un cambio lógico por commit. Cada commit debe compilar
   y pasar los tests.
2. **Separar por tipo**: un refactor previo va en su propio commit (`refactor`),
   la funcionalidad en otro (`feat`). Igual con dependencias (`build`), tests
   (`test`) y documentación (`docs`).
3. **Separar por feature**: un commit no mezcla cambios de `user` y de `order`.
4. **Estilo vertical**: dentro de una feature, un commit con todo lo necesario para
   que la funcionalidad funcione (controlador, servicio, repositorio, DTOs, mapper
   y sus tests). No hacer un commit por capa salvo que cada paso compile.
5. Si un archivo contiene cambios de dos temas distintos, separarlos con `git add -p`.
6. Nunca mezclar formato o limpieza con cambios de lógica en el mismo commit.

## Procedimiento antes de commitear

1. Ejecutar `git status` y `git diff` para ver qué hay realmente pendiente.
2. Identificar los grupos lógicos según las reglas anteriores.
3. Añadir solo los archivos de cada grupo (`git add <archivos>` o `git add -p`).
   No usar `git add .` ni `git add -A` sin revisar.
4. Comprobar que no se incluyen secretos (`.env`, credenciales) ni archivos
   generados (`build/`, `.gradle/`, `out/`, `*.class`).
5. Crear el commit con el mensaje. Repetir por cada grupo.
6. Mostrar al usuario el resumen de los commits creados (`git log --oneline`).
7. **No hacer `git push`** ni reescribir el historial (`rebase`, `amend`,
   `reset`) salvo que el usuario lo pida.

## Qué NO hacer

- Mensajes vagos: `fix`, `changes`, `wip`, `update`.
- Un único commit con todo el trabajo pendiente.
- Mensajes en español.
- Mezclar features, o refactor con funcionalidad, en un mismo commit.
- Añadir trailers de coautoría, revisión o firma, o referencias a tickets.
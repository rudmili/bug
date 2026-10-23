# DEBUG 8086

Simulador web del DEBUG de MS-DOS: escribe instrucciones assembler 8086, ejecútalas paso a paso y observa cómo cambian los registros, las banderas, la memoria y la pila.

![Simulador en escritorio: terminal de DEBUG a la izquierda y panel de estado a la derecha](screenshots/desktop.png)

## Qué es

Reproduce el programa `DEBUG` de MS-DOS tal como se comporta dentro de DOSBox, para practicar assembler sin instalar nada. Se usa igual que el original: se escriben comandos de una letra en una terminal y las respuestas tienen el mismo formato.

Junto a la terminal, un panel muestra el estado de la máquina después de cada comando:

- **Registros y banderas**, con lo que cambió en el último comando resaltado en ámbar.
- **Memoria de código**, que sigue a `CS:IP` y marca la instrucción que se ejecuta a continuación.
- **Memoria de datos**, que salta a la última dirección escrita por el programa.

Las dos ventanas de memoria se recorren por páginas con ◀ ▶ (o RePág y AvPág), o se llevan a una dirección escribiéndola en "ir a…" (la de datos acepta otro segmento, como `es:200`). Movida a mano, una ventana queda fija hasta pulsar **Seguir**; un `d` o un `e` también mueven la de datos.
- **Pila**, con la posición de `SP`, las palabras apiladas y las posiciones libres.

En el móvil el panel se divide en pestañas; en tableta se muestra como una franja sobre la terminal. Con pantalla táctil aparecen botones para `t`, `p`, `g` y `r`, para avanzar sin abrir el teclado.

Lo escrito se guarda en el navegador y sobrevive a una recarga. Sobre la terminal hay cuatro botones:

- **Compartir** copia un enlace que abre el simulador con el mismo programa y la misma hora de arranque (va en el `#` de la dirección, así que no pasa por ningún servidor).
- **Guardar** descarga la sesión como `.txt`, una línea por comando después de una línea `@reloj` con la hora de arranque, y **Abrir** carga uno.
- **Reiniciar** deja la máquina como al abrir la página.

Después de la primera visita funciona sin conexión y se puede instalar como aplicación.

## Comandos

| Comando | Qué hace |
|---|---|
| `a [dirección]` | Ensambla instrucciones línea por línea. Una línea vacía termina. |
| `u [rango]` | Desensambla la memoria. |
| `r [registro]` | Muestra los registros, o cambia el valor de uno. |
| `t [=dirección] [cantidad]` | Ejecuta una instrucción (o varias) y muestra los registros. |
| `p [=dirección] [cantidad]` | Como `t`, pero un `CALL` o un `LOOP` se ejecutan enteros. |
| `g [=dirección] [paradas]` | Ejecuta hasta que el programa termina o llega a un punto de parada. |
| `d [rango]` | Muestra la memoria en hexadecimal y ASCII. |
| `e dirección [lista]` | Escribe bytes o cadenas en memoria. |
| `f rango lista` | Llena el rango repitiendo la lista. |
| `m rango dirección` | Copia el rango a otra dirección. |
| `c rango dirección` | Compara el rango con otra dirección y muestra las diferencias. |
| `s rango lista` | Busca la lista en el rango. |
| `h valor valor` | Muestra la suma y la resta de los dos valores. |
| `q` | Reinicia la máquina y limpia la terminal. |
| `man [comando]` | Explica un comando, con ejemplos (no es de DEBUG). |
| `clear` | Limpia la terminal sin tocar la máquina (no es de DEBUG). |

Todos los números son hexadecimales. Un rango es `inicio fin` o `inicio L longitud`, y una dirección puede llevar segmento (`cs:100`).

## Ejemplo

Un programa que imprime un saludo siete veces:

```
-a 100
jmp 130

-e 102 "que tengas un feliz dia!" 0d 0a "$"
-a 130
mov bx,7
mov dx,102
mov ah,9
int 21
dec bx
jnz 138
int 20

-g
```

Para verlo instrucción por instrucción, usa `t` en lugar de `g`.

## Qué simula

- El juego de instrucciones completo del 8086: transferencia, aritmética, lógica, desplazamientos, cadenas con `REP`, saltos, llamadas, pila, interrupciones y prefijos de segmento.
- Las mismas codificaciones que elige DEBUG al ensamblar (`mov ax,8` → `B8 08 00`).
- Las interrupciones como en el 8086: `INT` apila FLAGS, CS e IP y salta por la tabla de vectores de `0000:0000` (la misma de DOSBox), e `IRET` vuelve. Un programa puede instalar su propio manejador con `INT 21` `AH=25` (o escribiendo la tabla) y consultarlo con `AH=35`.
- La lectura del teclado como en DOSBox: `INT 21` con las funciones `01`, `06`, `07`, `08`, `0A`, `0B` y `0C`, e `INT 16` (`00`, `01`, `02`, `05` y sus versiones `1x`), con los códigos de tecla del teclado estadounidense. Cuando el programa espera una tecla, la línea de comandos se la manda apenas se pulsa, sin Enter; Ctrl+C lo corta.
- El reloj como en DOSBox: arranca con la fecha y la hora de la PC y los ticks del BIOS (`0040:006C`) avanzan 18,2 veces por segundo. Lo leen `INT 21` `AH=2A` (fecha y día de la semana) y `AH=2C` (hora), `INT 1A` (`00` ticks, `02` hora y `04` fecha en BCD), y lo cambian `AH=2B`, `AH=2D` e `INT 1A` `AH=01`.
- La consola de DOS: `0D` vuelve al principio de la línea, `0A` baja sin cambiar de columna, `08` retrocede y `09` avanza hasta la siguiente columna múltiplo de 8.
- Los servicios de DOS más usados: `INT 20`, `INT 21` con las funciones `00`, `02`, `09`, `25`, `35` y `4C`, `INT 10` `AH=0E` para escribir un carácter, y el error de división (`Divide overflow`) mientras nadie cambie el vector 0. Como en DOSBox, viven en manejadores de `F000` que piden el servicio con la instrucción `FE 38`.

Diferencias con el DEBUG real:

- `q` reinicia la sesión en lugar de cerrar el programa.
- `t` sobre un `INT` de DOS o del BIOS lo resuelve en un solo paso; si el vector apunta a un manejador propio, entra en él como el DEBUG real.
- `g` se detiene tras 1.000.000 de instrucciones, para no congelar la pestaña.
- Un programa que consulta el teclado sin parar (`INT 21` `AH=0B`, `AH=06` con `DL=FF`, `INT 16` `AH=01`) no corre en tiempo real como en DOSBox: tras 100 consultas seguidas sin tecla, la ejecución se pausa hasta que se pulse una.
- El reloj no corre solo: avanza con las instrucciones ejecutadas, a la velocidad por defecto de DOSBox (`cycles=3000`, unas 165.000 instrucciones por tick). No avanza mientras se escriben comandos ni mientras el programa espera una tecla, y un `g` llega a un tercio de segundo antes del límite de instrucciones. A cambio, recargar, compartir o abrir el `.txt` repite la sesión desde la misma hora y da los mismos valores. Tras `q`, la máquina nueva arranca a la hora que marcaba el reloj.
- El tick del temporizador suma en `0040:006C` sin pasar por `INT 08` ni `INT 1C`: un manejador propio de `INT 1C` no se llama.
- No hay comandos de archivos, de disco ni de puertos (`n`, `l`, `w`, `i`, `o`).
- La máquina arranca con los valores de una sesión concreta de DOSBox: segmento `073F`, `SP=00FD` y el PSP que deja DOS. El resto de la memoria arranca en cero, así que lo que haya más allá del programa puede no coincidir con el de otro equipo.

## Desarrollo

Requiere Node 24 y pnpm.

```bash
pnpm install
pnpm dev      # servidor de desarrollo
pnpm test     # tests en modo watch (Vitest)
pnpm test:run # tests una sola vez
pnpm coverage # tests con informe de cobertura en coverage/
pnpm build    # compilación de producción en dist/
pnpm lint
```

Hecho con React 19, TypeScript, Vite y el React Compiler. La lógica del simulador no depende de React y se puede usar sola desde Node; en el navegador corre en un Web Worker, así que un programa largo no congela la página.

```
src/
  debug/   lógica del simulador, un módulo por archivo con sus tests
           hex → state → memory → flags → decoder → disassembler
           → executor → dos → assembler → commands → view → session
           host y worker la sirven desde otro hilo
  ui/      componentes de la interfaz, estilos y sus tests (jsdom)
  service-worker.js   plantilla del modo sin conexión (vite.config.ts la completa)
docs/      especificación original y diseño de referencia
```

La interfaz y la lógica se comunican solo a través de `src/debug/types.ts`: la lógica produce un `DebugView` después de cada línea, y la interfaz lo dibuja.

## Licencia

Copyright (C) 2026 Mikell Bobadila

Este proyecto se distribuye bajo la [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). Puedes usarlo, modificarlo y redistribuirlo, pero cualquier versión modificada, incluida una que se ofrezca como servicio web, debe publicarse con su código fuente bajo la misma licencia.

Si quieres usarlo bajo otras condiciones, por ejemplo en un producto cerrado, escríbeme para hablar de una licencia comercial.

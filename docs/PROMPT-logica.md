# Prompt de implementación: lógica del simulador DEBUG 8086

Implementa en TypeScript la lógica de un simulador del programa DEBUG de MS-DOS, tal como se comporta dentro de DOSBox. La interfaz ya existe (React) y solo consume el contrato de `types.ts`. Tu trabajo es todo lo que hay detrás de `DebugSession`.

## 0. Reglas generales

1. **Fidelidad.** Ante cualquier duda, se hace lo que hace DEBUG real en DOSBox. Las desviaciones permitidas están listadas en la sección 12 y son las únicas.
2. **TypeScript puro.** Sin React, sin DOM, sin dependencias en tiempo de ejecución. Debe poder ejecutarse en Node para los tests.
3. **Todo es hexadecimal.** Lo que escribe el usuario y lo que se imprime. Las letras se imprimen en mayúsculas. La entrada no distingue mayúsculas de minúsculas.
4. **La CPU ejecuta bytes, no texto.** `a` traduce texto a bytes y lo olvida. `t`, `g` y `u` leen los bytes de la memoria y los decodifican. Si un byte cambia con `e`, cambia la instrucción.
5. **Un módulo por archivo**, con las dependencias en un solo sentido: cada módulo solo importa de los que están antes en esta lista. Ninguno importa de `session` salvo el punto de entrada.
6. **Cada módulo trae sus tests.** Los casos de aceptación de la sección 11 son obligatorios.

Orden de construcción y dependencias:

```
state → memory → flags → decoder → disassembler → executor → dos
                          ↘ assembler (usa las mismas tablas de opcodes que decoder)
commands (usa todos los anteriores) → view → session
```

## 1. Módulo `state`: estado de la máquina

Define el tipo `Machine` y la función `createMachine()`.

Contenido: ocho registros de 16 bits (AX, CX, DX, BX, SP, BP, SI, DI, en ese orden de codificación), cuatro de segmento (ES, CS, SS, DS), IP, las nueve banderas (CF, PF, AF, ZF, SF, TF, IF, DF, OF) y la memoria.

Acceso a mitades de 8 bits: AL, CL, DL, BL, AH, CH, DH, BH (en ese orden de codificación). Escribir una mitad no altera la otra.

Estado inicial (el de DEBUG en el DOSBox del usuario; la primera versión copiaba DOSBox-X):

| Elemento | Valor |
|---|---|
| CS, DS, SS, ES | 073F |
| IP | 0100 |
| SP | 00FD |
| AX, BX, CX, DX, BP, SI, DI | 0000 |
| Banderas | NV UP EI PL NZ NA PO NC (IF=1, el resto en 0) |

## 2. Módulo `memory`

- 1 MB (`Uint8Array` de 0x100000). Dirección física = `(segmento * 16 + desplazamiento) mod 0x100000`. El desplazamiento da la vuelta dentro de 16 bits.
- Lectura y escritura de byte y de palabra. Las palabras son little endian: el byte bajo en la dirección menor.
- Contenido inicial: el PSP que deja DOS en 073F:0000 (INT 20, tope de memoria, tabla de archivos, versión 5.00, `CD 21 CB`, dos FCB vacíos y la línea de comandos vacía en 0080), ceros desde 0100 y los restos `34 00 2E 07` en 011C. Todo lo demás en `00`. Los bytes exactos están en `memory.ts`, copiados de `d 0 ff` y `d 100 17f`.
- Registro de escrituras: cada escritura anota dirección física y valor anterior en una lista que `session` vacía y consulta después de cada comando. Es lo que usa la interfaz para resaltar cambios.

## 3. Módulo `flags`

Funciones puras que reciben operandos, resultado y tamaño (8 o 16 bits) y devuelven las banderas.

- **Suma y resta** (ADD, ADC, SUB, SBB, CMP, NEG): CF, PF, AF, ZF, SF, OF.
  - CF: acarreo o préstamo fuera del bit más alto.
  - AF: acarreo o préstamo entre el bit 3 y el 4.
  - OF: el resultado con signo no cabe.
  - PF: 1 si el byte bajo del resultado tiene cantidad par de bits en 1.
- **INC y DEC**: igual, pero no tocan CF.
- **Lógicas** (AND, OR, XOR, TEST): CF=0, OF=0, y PF, ZF, SF según el resultado.
- **Desplazamientos** (SHL, SHR, SAR): CF = último bit que salió. PF, ZF, SF según el resultado. OF: en SHL es bit alto del resultado XOR CF; en SHR es el bit alto del valor original; en SAR es 0.
- **Rotaciones** (ROL, ROR, RCL, RCR): solo CF y OF. OF en las de izquierda es bit alto del resultado XOR CF; en las de derecha es XOR de los dos bits más altos del resultado.
- **MUL e IMUL**: CF=OF=1 si la mitad alta del resultado es significativa. SF y PF se calculan sobre la mitad baja del resultado; ZF y AF no cambian. (Así coincide con las trazas del práctico.)
- **MOV, PUSH, POP, saltos, LEA, XCHG, NOT**: no tocan banderas.

Texto de DEBUG, en este orden: OF (NV/OV), DF (UP/DN), IF (DI/EI), SF (PL/NG), ZF (NZ/ZR), AF (NA/AC), PF (PO/PE), CF (NC/CY).

## 4. Módulo `decoder`

`decode(memory, cs, ip)` devuelve una instrucción estructurada: mnemónico, operandos, tamaño en bytes y los bytes crudos.

- Juego completo del 8086 documentado: transferencia, aritmética, lógica, desplazamientos y rotaciones, cadenas con REP, saltos, llamadas, retornos, pila, interrupciones, banderas, E/S, y los prefijos de segmento, REP/REPNE y LOCK.
- Byte ModR/M con sus ocho combinaciones de direccionamiento (BX+SI, BX+DI, BP+SI, BP+DI, SI, DI, BP o directo, BX) y desplazamiento de 0, 8 o 16 bits.
- Segmento por defecto: SS si la base es BP, DS en el resto, salvo prefijo.
- Un opcode no definido en el 8086 se decodifica como `DB xx` de un byte.
- Las tablas de opcodes se exportan para que `assembler` use las mismas.

## 5. Módulo `disassembler`

`format(instr)` devuelve el texto como lo muestra DEBUG:

- Mnemónico en mayúsculas, rellenado con espacios hasta 8 columnas, y luego los operandos separados por coma sin espacio: `MOV     AH,08`.
- Inmediatos con 2 o 4 dígitos según el tamaño del operando. Direcciones de memoria con 4 dígitos entre corchetes: `[0200]`. Con registros: `[BX+SI]`, `[BX+02]`, `[BP-04]`.
- `BYTE PTR` o `WORD PTR` solo cuando ningún operando es un registro: `MOV     BYTE PTR [2000],08`.
- Saltos y llamadas: la dirección de destino con 4 dígitos, no el desplazamiento relativo.
- Nombres de saltos condicionales que usa DEBUG: JO, JNO, JB, JNB, JZ, JNZ, JBE, JA, JS, JNS, JPE, JPO, JL, JGE, JLE, JG.

## 6. Módulo `executor`

`step(machine)` decodifica la instrucción en CS:IP, la ejecuta, actualiza banderas mediante `flags` y deja IP en la siguiente.

Puntos que suelen fallar:

- **PUSH** resta 2 a SP y después escribe. **POP** lee y después suma 2.
- **MUL/IMUL** de 8 bits dejan el resultado en AX; de 16 bits, en DX:AX.
- **DIV/IDIV** de 8 bits dividen AX y dejan cociente en AL y resto en AH; de 16 bits dividen DX:AX y dejan cociente en AX y resto en DX. División por cero o cociente que no cabe: interrupción 0 (ver `dos`).
- **LOOP** resta 1 a CX y salta si no es cero. No toca banderas. **JCXZ** salta si CX es cero.
- **Desplazamientos**: el 8086 solo admite 1 o CL como cantidad.
- **RET** saca IP de la pila. Con la pila inicial salta a 0000, donde está el INT 20.
- **IN** devuelve FF; **OUT** se ignora. **HLT** detiene la ejecución.

## 7. Módulo `dos`: interrupciones simuladas

DOS no es parte del procesador, así que se simula lo mínimo. `INT n` se resuelve completo dentro de un solo paso (no se entra a código de DOS).

| Interrupción | Comportamiento |
|---|---|
| INT 20 | Termina el programa |
| INT 21, AH=02 | Escribe el carácter de DL en la salida |
| INT 21, AH=09 | Escribe la cadena que empieza en DS:DX hasta el carácter `$`, sin incluirlo |
| INT 21, AH=4C | Termina el programa |
| INT 21, otras funciones | Se ignoran |
| INT 0 (división) | Imprime `Divide overflow` y termina el programa |
| INT 3 | Detiene `g` y muestra los registros |
| Otras | Se ignoran |

La salida de texto va a la terminal: 0D se descarta y 0A corta la línea. Al terminar el programa se imprime `Program terminated normally` y los registros quedan como estaban.

## 8. Módulo `assembler`

`assemble(text, address)` devuelve los bytes de una instrucción o un error con la columna donde falló.

- Sintaxis de DEBUG: números hexadecimales sin prefijo ni sufijo, sin etiquetas, sin nombres de variables. Destinos de salto como dirección absoluta (`jnz 138`).
- Acepta `byte ptr` y `word ptr` (también `byte` y `word` solos). Sin registro y sin tamaño es error, salvo en PUSH y POP, que asumen palabra.
- Acepta inmediatos negativos (`mov cx,-1`) y `DB` con bytes y cadenas entre comillas simples o dobles.
- Codificaciones que elige DEBUG (deben coincidir byte a byte):

| Instrucción | Bytes |
|---|---|
| `mov ah,8` | B4 08 |
| `mov ax,8` | B8 08 00 |
| `add ah,3` | 80 C4 03 |
| `sub ah,c` | 80 EC 0C |
| `add ax,3` | 05 03 00 |
| `add bx,3` | 83 C3 03 |
| `mov ax,bx` | 89 D8 |
| `mov [0200],ax` | A3 00 02 |
| `mov ax,[0200]` | A1 00 02 |
| `add ax,[0203]` | 03 06 03 02 |
| `mov [2000],ah` | 88 26 00 20 |
| `mov byte ptr [2000],8` | C6 06 00 20 08 |
| `mul cx` | F7 E1 |
| `imul cl` | F6 E9 |
| `div bl` | F6 F3 |
| `shr al,1` | D0 E8 |
| `push [1100]` | FF 36 00 11 |
| `jmp 130` (desde 0100) | EB 2E |
| `jnz 138` (desde 013B) | 75 FB |
| `loop 138` (desde 013A) | E2 FC |
| `int 21` | CD 21 |

- Salto corto (EB) cuando el destino está entre −128 y +127 bytes; si no, cercano (E9). Los condicionales, LOOP y JCXZ solo admiten salto corto: fuera de rango es error.
- Errores: dos operandos de memoria, tamaños distintos, inmediato que no cabe, registro inválido entre corchetes (solo BX, BP, SI, DI), mnemónico desconocido.

## 9. Módulo `commands`: los comandos de DEBUG

Analiza una línea y la ejecuta contra la máquina. Devuelve las líneas a imprimir y el modo en que queda la terminal.

**Modos de la terminal**

| Modo | Prompt | Cómo se entra | Cómo se sale |
|---|---|---|---|
| Comando | `-` | Es el inicial | |
| Ensamblado | `073F:0100 ` (segmento:desplazamiento y un espacio) | `a` | Línea vacía |
| Edición de registro | `:` | `r <registro>` | Cualquier línea (vacía conserva el valor) |
| Edición de memoria | `073F:1100  69.` | `e <dirección>` sin lista | Línea vacía |

**Comandos de la primera versión**

| Comando | Comportamiento |
|---|---|
| `a [dirección]` | Entra en modo ensamblado. Sin dirección: 0100 la primera vez y luego continúa donde quedó. Cada línea se ensambla en la dirección actual, escribe sus bytes y avanza. Si hay error, se informa y la dirección no avanza. |
| `u [rango]` | Desensambla. Sin rango: 20h bytes desde CS:IP la primera vez, y luego continúa donde quedó. Nunca corta una instrucción por la mitad. |
| `r` | Imprime el volcado de tres líneas. |
| `r <registro>` | Imprime `IP 0108` y pasa a edición de registro. El valor escrito se guarda; una línea vacía lo deja igual. Vale para los trece registros. |
| `t [=dirección] [cantidad]` | Ejecuta una instrucción (o la cantidad indicada) e imprime el volcado después de cada una. |
| `d [rango]` | Vuelca memoria. Sin rango: 80h bytes desde DS:0100 la primera vez, y luego continúa. |
| `e <dirección> <lista>` | Escribe la lista: bytes hexadecimales y cadenas entre comillas, separados por espacios o comas. |
| `e <dirección>` | Edición interactiva: muestra el byte actual seguido de un punto; el valor escrito lo reemplaza y avanza al siguiente. |
| `g [=dirección]` | Ejecuta hasta que el programa termina. |
| `q` | Vuelve todo al estado inicial y limpia la terminal. |

Agregados después, con el formato del DEBUG de MS-DOS:

| Comando | Comportamiento |
|---|---|
| `p [=dirección] [cantidad]` | Como `t`, pero un CALL o un LOOP/LOOPZ/LOOPNZ se ejecuta hasta que CS:IP llega a la instrucción siguiente. |
| `h <valor> <valor>` | Imprime la suma y la resta en 16 bits: `0008  0002`. |
| `f <rango> <lista>` | Llena el rango repitiendo la lista. El rango es obligatorio (`inicio fin` o `inicio L longitud`). |
| `m <rango> <dirección>` | Copia el rango; funciona aunque origen y destino se superpongan. |
| `c <rango> <dirección>` | Una línea por cada byte distinto: `073F:0201  4F  45  073F:0301`. |
| `s <rango> <lista>` | La dirección de cada aparición de la lista que entra entera en el rango. |

Rangos: `inicio fin` o `inicio L longitud`. Una dirección puede llevar segmento (`cs:100`). Se admite el comando pegado a su argumento (`e1100`, `u100`).

**Formato exacto de las salidas**

Volcado de `r` y `t` (dos espacios entre registros y tres antes de las banderas, como en MS-DOS):

```
AX=FF00  BX=0000  CX=0000  DX=0000  SP=00FD  BP=0000  SI=0000  DI=0000
DS=073F  ES=073F  SS=073F  CS=073F  IP=0108   NV UP EI NG NZ AC PE CY
073F:0108 88260020      MOV     [2000],AH                   DS:2000=00
```

- Tercera línea: dirección, un espacio, los bytes sin separar rellenados hasta 14 columnas, y la instrucción.
- Si la instrucción tiene un operando de memoria, se agrega al final `SEG:DESP=valor` con 2 o 4 dígitos según el tamaño, alineado a la derecha para que termine en la columna 70.

Salida de `u`: una línea por instrucción, con el mismo formato que la tercera línea del volcado, sin la nota de memoria.

Salida de `d`: dirección, dos espacios, 16 bytes separados por espacio con un guion entre el octavo y el noveno, y la columna ASCII (punto para los no imprimibles).

```
073F:0100  B4 08 80 C4 03 80 EC 0C-00 00 00 00 00 00 00 00   ................
```

Errores: una línea con el acento circunflejo bajo la columna donde está el problema, seguido de ` Error`. El modo no cambia.

```
073F:0100 -r
          ^ Error
```

Las columnas exactas de la nota de memoria, del volcado `d` y del mensaje de error deben verificarse contra capturas de DOSBox antes de darlas por cerradas. Si una captura contradice este documento, manda la captura.

## 10. Módulos `view` y `session`

`session` implementa la interfaz `DebugSession` de `types.ts`: guarda la máquina, el historial de líneas y el modo, y en cada `submit(línea)`:

1. Agrega al historial la línea escrita, con el prompt que tenía delante (tipo `command`).
2. Guarda una copia de registros y banderas, y vacía el registro de escrituras de memoria.
3. Pasa la línea a `commands` y agrega su salida (tipo `output` o `error`).
4. Construye el `DebugView` con `view`.

`view` arma el `DebugView` a partir de la máquina, la copia previa y las escrituras:

- **Registros y banderas**: `changed` es verdadero si el valor difiere de la copia previa. Si el comando no modificó la máquina (`u`, `d`, `r` sin cambios, un error), se conservan los resaltados del comando anterior.
- **Etiquetas de banderas**: Desb., Direc., Interr., Signo, Cero, Aux., Paridad, Acarreo.
- **Ventana de código**: 8 filas de 16 bytes del segmento CS. Empieza en la fila que contiene 0100 y solo se mueve cuando IP queda fuera de la ventana; entonces arranca en la fila que contiene IP. Marca `isIp` en el byte de CS:IP.
- **Ventana de datos**: 8 filas del segmento DS. Se posiciona en la fila de la última escritura hecha por una instrucción en memoria que no sea de pila (PUSH, CALL, INT), o en la dirección del último `d` o `e`. Arranca en 0200. `captionValue` es esa dirección entre corchetes y `captionHot` es verdadero si la escritura ocurrió en el último comando.
- **Bytes**: `changed` es verdadero para los bytes escritos por el último comando que modificó la máquina.
- **Pila**: filas de mayor a menor dirección. Incluye hasta 4 palabras apiladas por encima de SP, la fila de SP y las 3 posiciones libres siguientes. `start` es 00FD, el SP inicial. La pila arranca dentro del PSP, debajo del programa, así que `limit` es 0000: el principio del segmento. `usedBytes` es `start − SP`, `totalBytes` es `start − limit` y `position` es el cociente entre ambos.
- **Notas de pila**: la fila de 00FD con el valor inicial lleva "tope · retorno a DOS" cuando SP está ahí; la primera libre lleva "libre · próximo push"; las demás libres, "libre".

## 11. Casos de aceptación

Cada caso parte del estado inicial. Los valores de segmento, SP y bandera de signo son los de DOSBox, no los del PDF del práctico.

| Programa | Después del último `t` |
|---|---|
| `mov ah,8` / `add ah,3` / `sub ah,4` | AX=0700, IP=0108, `NV UP EI PL NZ NA PO NC` |
| Ídem, tras el primer `t` | AX=0800, IP=0102, banderas sin cambios (`PL` sigue) |
| `mov ah,8` / `add ah,3` / `sub ah,c` | AX=FF00, `NV UP EI NG NZ AC PE CY` |
| `mov ah,a` / `sub ah,a` | AX=0000, `NV UP EI PL ZR NA PE NC` |
| `mov ah,a` / `add ah,a` | AX=1400, `NV UP EI PL NZ AC PE NC` |
| `mov ax,8` / `mov [0200],ax` / `mov ax,3` / `mov [0203],ax` / `mov ax,[0200]` / `add ax,[0203]` / `mov [0205],ax` | AX=000B, IP=0116, memoria 0200: `08 00 00 03 00 0B 00` |
| `mov ax,ffff` / `mov cx,ffff` / `mul cx` | AX=0001, DX=FFFE, `OV` y `CY` |
| `mov ax,4` / `mov cx,-1` / `imul cl` | AX=FFFC, DX=0000, `NV … NG NZ NA PE NC` |
| `mov ax,7` / `mov bl,3` / `div bl` | AX=0102 |
| `mov ax,1c` / `mov bl,ff` / `idiv bl` | AX=00E4 |
| `mov al,a0` / `shr al,1` | AX=0050, `OV … PL NZ NA PE NC` |
| `mov al,a0` / `rol al,1` | AX=0041, `OV` y `CY` |
| `mov al,a0` / `ror al,1` | AX=0050, `OV` y `NC` |
| `mov al,a0` / `rcl al,1` | AX=0040, `OV` y `CY` |
| `mov al,a0` / `rcr al,1` | AX=0050, `OV` y `NC` |

Programa con salida (se ejecuta con `g`):

```
-a 0100
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

Debe imprimir siete veces `que tengas un feliz dia!` y luego `Program terminated normally`. Lo mismo con las variantes que usan `jcxz` y `loop`.

Pila:

```
-e 1100 d8 d7
-a 0100
mov ax,d5d6
mov bx,d3d4
mov cx,d1d2
push [1100]
push ax
push bx
push cx
pop ax
pop bx
pop cx
pop dx
int 20
```

Tras los cuatro PUSH, SP=00F5. Al final AX=D1D2, BX=D3D4, CX=D5D6, DX=D7D8 y SP=00FD.

Otros:

- Con el estado inicial, `r` muestra en la tercera línea `073F:0100 0000          ADD     [BX+SI],AL` y la nota `DS:0000=CD`.
- `u 100 106` con el estado inicial muestra cuatro `ADD     [BX+SI],AL`.
- `g` con el estado inicial recorre los ceros, da la vuelta al segmento y termina en el INT 20 del PSP con `Program terminated normally`.
- Escribir `-r` en modo ensamblado produce `^ Error` y la dirección no avanza.
- `r ip` seguido de `0100` deja IP=0100; seguido de una línea vacía no lo cambia.
- Cambiar con `e` un byte de una instrucción ya ensamblada cambia lo que muestra `u` y lo que ejecuta `t`.

## 12. Desviaciones permitidas respecto de DEBUG real

1. `q` reinicia la sesión en vez de cerrar el programa.
2. `t` sobre una instrucción INT resuelve la interrupción entera en un paso.
3. `g` se detiene tras 1.000.000 de instrucciones con un aviso, para no congelar la pestaña.
4. Ejecutar un opcode no definido detiene la ejecución con un aviso.
5. No hay comandos de archivos, de disco ni de puertos (`n`, `l`, `w`, `i`, `o`).
6. La memoria fuera del PSP y de los restos copiados de DOSBox empieza en cero, así que la "basura" después del programa puede no coincidir con la de otro equipo.

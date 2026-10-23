import { describe, expect, it } from 'vitest';
import { createCommandState, promptFor, run } from './commands';
import type { CommandState } from './commands';
import { bootMachine, readByte } from './memory';
import { AX, BX, CX, DX, SP } from './state';
import type { Machine } from './state';

/** Ejecuta líneas como si se escribieran en la terminal; devuelve la salida de todas. */
function session() {
  const m: Machine = bootMachine();
  const state: CommandState = createCommandState(m);
  const type = (...lines: string[]): string[] =>
    lines.flatMap((line) => run(m, state, line).output.map((o) => o.text));
  return { m, state, type, prompt: () => promptFor(m, state) };
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

describe('commands: r', () => {
  it('muestra el volcado de tres líneas', () => {
    // Copiado de `r` en DOSBox: dos espacios entre registros, tres antes de las banderas y la nota hasta la columna 70
    expect(session().type('r')).toEqual([
      'AX=0000  BX=0000  CX=0000  DX=0000  SP=00FD  BP=0000  SI=0000  DI=0000',
      'DS=073F  ES=073F  SS=073F  CS=073F  IP=0100   NV UP EI PL NZ NA PO NC',
      '073F:0100 0000          ADD     [BX+SI],AL                  DS:0000=CD',
    ]);
  });

  it('agrega la nota de memoria alineada a la derecha', () => {
    const s = session();
    s.type('a', 'mov ah,8', 'add ah,3', 'sub ah,c', 'mov [2000],ah', '');
    const lines = s.type('t 3');
    expect(lines.slice(-3)).toEqual([
      'AX=FF00  BX=0000  CX=0000  DX=0000  SP=00FD  BP=0000  SI=0000  DI=0000',
      'DS=073F  ES=073F  SS=073F  CS=073F  IP=0108   NV UP EI NG NZ AC PE CY',
      '073F:0108 88260020      MOV     [2000],AH                   DS:2000=00',
    ]);
  });

  it('r ip seguido de un valor lo cambia; seguido de línea vacía no', () => {
    const s = session();
    s.m.ip = 0x108;
    expect(s.type('r ip')).toEqual(['IP 0108']);
    expect(s.prompt()).toBe(':');
    s.type('0100');
    expect(s.m.ip).toBe(0x100);
    expect(s.prompt()).toBe('-');
    s.type('r ip', '');
    expect(s.m.ip).toBe(0x100);
  });

  it('vale para los trece registros', () => {
    const s = session();
    s.type('r bx', '1234', 'r ds', '2000');
    expect(s.m.regs[BX]).toBe(0x1234);
    expect(s.m.sregs[3]).toBe(0x2000);
  });

  it('registro desconocido es error', () => {
    expect(session().type('r zz')).toEqual(['   ^ Error']);
  });
});

describe('commands: a y u', () => {
  it('u 100 106 con el estado inicial', () => {
    expect(session().type('u 100 106')).toEqual([
      '073F:0100 0000          ADD     [BX+SI],AL',
      '073F:0102 0000          ADD     [BX+SI],AL',
      '073F:0104 0000          ADD     [BX+SI],AL',
      '073F:0106 0000          ADD     [BX+SI],AL',
    ]);
  });

  it('u sin rango muestra 20h bytes desde CS:IP y luego continúa', () => {
    const s = session();
    const first = s.type('u');
    expect(first[0]).toBe('073F:0100 0000          ADD     [BX+SI],AL');
    // Los restos de DOS en 011C: 34 00 (XOR AL,00) y 2E 07 (prefijo CS: y POP ES)
    expect(first.slice(-3)).toEqual([
      '073F:011C 3400          XOR     AL,00',
      '073F:011E 2E            CS:',
      '073F:011F 07            POP     ES',
    ]);
    expect(s.type('u')[0]).toMatch(/^073F:0120 /);
  });

  it('a avanza la dirección y una línea vacía sale', () => {
    const s = session();
    s.type('a');
    expect(s.prompt()).toBe('073F:0100 ');
    s.type('mov ah,8');
    expect(s.prompt()).toBe('073F:0102 ');
    s.type('');
    expect(s.prompt()).toBe('-');
    s.type('a');
    expect(s.prompt()).toBe('073F:0102 ');
  });

  it('-r en modo ensamblado da error y no avanza', () => {
    const s = session();
    s.type('a');
    expect(s.type('-r')).toEqual(['          ^ Error']);
    expect(s.prompt()).toBe('073F:0100 ');
  });

  it('cambiar un byte con e cambia lo que muestra u y lo que ejecuta t', () => {
    const s = session();
    s.type('a', 'mov ah,8', '');
    s.type('e 101 9');
    expect(s.type('u 100 100')).toEqual(['073F:0100 B409          MOV     AH,09']);
    s.type('t');
    expect(hex(s.m.regs[AX])).toBe('0900');
  });

  it('comando pegado al argumento', () => {
    const s = session();
    expect(s.type('u100 100')).toEqual(['073F:0100 0000          ADD     [BX+SI],AL']);
    s.type('e1100 41');
    expect(readByte(s.m, 0x073f, 0x1100)).toBe(0x41);
  });
});

describe('commands: d y e', () => {
  it('d muestra 80h bytes desde DS:0100 con guion y ASCII', () => {
    const s = session();
    s.type('a', 'mov ah,8', 'add ah,3', 'sub ah,c', '');
    const lines = s.type('d');
    expect(lines).toHaveLength(8);
    expect(lines[0]).toBe('073F:0100  B4 08 80 C4 03 80 EC 0C-00 00 00 00 00 00 00 00   ................');
    expect(s.type('d')[0]).toMatch(/^073F:0180 /);
  });

  it('d con rango que no empieza en fila', () => {
    const s = session();
    s.type('e 200 "Hola"');
    const [line] = s.type('d 202 l 4');
    expect(line.startsWith('073F:0200        6C 61 00 00 ')).toBe(true);
    // La columna ASCII empieza en 61, igual que en una fila completa; las dos primeras celdas van en blanco
    expect(line.indexOf('la..')).toBe(63);
    expect(line.endsWith('la..')).toBe(true);
  });

  it('e con lista de bytes y cadenas', () => {
    const s = session();
    s.type('e 102 "hi" 0d,0a "$"');
    expect([0x102, 0x103, 0x104, 0x105, 0x106].map((o) => readByte(s.m, 0x073f, o))).toEqual([0x68, 0x69, 0x0d, 0x0a, 0x24]);
  });

  it('e interactivo muestra el byte y avanza', () => {
    const s = session();
    s.type('e 1100 69');
    s.type('e 1100');
    expect(s.prompt()).toBe('073F:1100  69.');
    s.type('70');
    expect(s.prompt()).toBe('073F:1101  00.');
    s.type('');
    expect(s.prompt()).toBe('-');
    expect(readByte(s.m, 0x073f, 0x1100)).toBe(0x70);
  });
});

describe('commands: t y g', () => {
  const greeting = (loop: string[]) => {
    const s = session();
    s.type('a 0100', 'jmp 130', '');
    s.type('e 102 "que tengas un feliz dia!" 0d 0a "$"');
    s.type('a 130', ...loop, '');
    return s.type('g');
  };

  it('programa del saludo con dec/jnz', () => {
    const lines = greeting(['mov bx,7', 'mov dx,102', 'mov ah,9', 'int 21', 'dec bx', 'jnz 138', 'int 20']);
    expect(lines).toEqual([...Array(7).fill('que tengas un feliz dia!'), 'Program terminated normally']);
  });

  it('variante con loop', () => {
    const lines = greeting(['mov cx,7', 'mov dx,102', 'mov ah,9', 'int 21', 'loop 138', 'int 20']);
    expect(lines).toEqual([...Array(7).fill('que tengas un feliz dia!'), 'Program terminated normally']);
  });

  it('variante con jcxz', () => {
    const lines = greeting(['mov cx,7', 'mov dx,102', 'mov ah,9', 'int 21', 'dec cx', 'jcxz 13f', 'jmp 138', 'int 20']);
    expect(lines).toEqual([...Array(7).fill('que tengas un feliz dia!'), 'Program terminated normally']);
  });

  it('programa de pila', () => {
    const s = session();
    s.type('e 1100 d8 d7');
    s.type('a 0100', 'mov ax,d5d6', 'mov bx,d3d4', 'mov cx,d1d2', 'push [1100]', 'push ax', 'push bx', 'push cx',
      'pop ax', 'pop bx', 'pop cx', 'pop dx', 'int 20', '');
    s.type('t 7');
    expect(hex(s.m.regs[SP])).toBe('00F5');
    s.type('t 4');
    expect([AX, BX, CX, DX, SP].map((r) => hex(s.m.regs[r]))).toEqual(['D1D2', 'D3D4', 'D5D6', 'D7D8', '00FD']);
    expect(s.type('t')).toEqual(['Program terminated normally']);
  });

  it('t =dirección y cantidad', () => {
    const s = session();
    s.type('a 200', 'mov ax,1', 'mov bx,2', '');
    const lines = s.type('t =200 2');
    expect(lines).toHaveLength(6);
    expect(hex(s.m.ip)).toBe('0206');
  });

  it('g con el estado inicial: recorre los ceros, da la vuelta al segmento y termina en el INT 20 del PSP', () => {
    expect(session().type('g')).toEqual(['Program terminated normally']);
  });

  it('INT 3 detiene g y muestra los registros', () => {
    const s = session();
    s.type('a', 'mov ax,1', 'int 3', 'mov ax,2', '');
    const lines = s.type('g');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^AX=0001 /);
  });

  it('opcode no definido detiene con aviso', () => {
    const s = session();
    s.type('e 100 0f');
    expect(s.type('g')[0]).toMatch(/Opcode no definido \(0F\) en 073F:0100/);
  });

  it('división por cero', () => {
    const s = session();
    s.type('a', 'mov bl,0', 'div bl', '');
    expect(s.type('g')).toEqual(['Divide overflow', 'Program terminated normally']);
  });
});

describe('commands: h, f, m, c y s', () => {
  const bytesAt = (m: Machine, off: number, n: number) =>
    Array.from({ length: n }, (_, i) => readByte(m, 0x073f, off + i));

  it('h muestra la suma y la resta en 16 bits', () => {
    expect(session().type('h 5 3')).toEqual(['0008  0002']);
    expect(session().type('h 3 5')).toEqual(['0008  FFFE']);
    expect(session().type('h ffff 1')).toEqual(['0000  FFFE']);
    expect(session().type('h 5')).toEqual(['    ^ Error']);
    expect(session().type('h 1 2 3')).toEqual(['       ^ Error']);
  });

  it('f llena un rango repitiendo la lista', () => {
    const s = session();
    s.type('f 200 l 7 41 "BC"');
    expect(bytesAt(s.m, 0x200, 8)).toEqual([0x41, 0x42, 0x43, 0x41, 0x42, 0x43, 0x41, 0]);
    s.type('f 300 303 ff');
    expect(bytesAt(s.m, 0x300, 5)).toEqual([0xff, 0xff, 0xff, 0xff, 0]);
    expect(run(s.m, s.state, 'f 400 l 2 1').dataFocus).toBe(0x400);
  });

  it('f sin rango completo o sin lista es error', () => {
    expect(session().type('f')).toEqual(['  ^ Error']);
    expect(session().type('f 200')).toEqual(['      ^ Error']);
    expect(session().type('f 200 l 4')).toEqual(['          ^ Error']);
  });

  it('m copia, también si origen y destino se superponen', () => {
    const s = session();
    s.type('e 200 1 2 3 4', 'm 200 203 300');
    expect(bytesAt(s.m, 0x300, 4)).toEqual([1, 2, 3, 4]);
    s.type('m 200 l 4 201');
    expect(bytesAt(s.m, 0x200, 5)).toEqual([1, 1, 2, 3, 4]);
    expect(run(s.m, s.state, 'm 200 l 1 500').dataFocus).toBe(0x500);
  });

  it('c muestra cada byte distinto con las dos direcciones', () => {
    const s = session();
    s.type('e 200 "HOLA"', 'e 300 "HELA"');
    expect(s.type('c 200 l 4 300')).toEqual(['073F:0201  4F  45  073F:0301']);
    expect(s.type('c 200 203 300 x')).toEqual(['               ^ Error']);
  });

  it('s busca la lista y muestra cada aparición', () => {
    const s = session();
    s.type('e 200 "abcabc"');
    expect(s.type('s 200 l 6 "bc"')).toEqual(['073F:0201', '073F:0204']);
    expect(s.type('s 200 l 5 "bc"')).toEqual(['073F:0201']);
    expect(s.type('s 200 l 6 7a')).toEqual([]);
  });
});

describe('commands: p', () => {
  it('ejecuta una llamada entera y se detiene en la instrucción siguiente', () => {
    const s = session();
    s.type('a 100', 'call 200', 'nop', '', 'a 200', 'mov ax,1', 'mov bx,2', 'ret', '');
    const lines = s.type('p');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^AX=0001 {2}BX=0002/);
    expect(hex(s.m.ip)).toBe('0103');
    expect(hex(s.m.regs[SP])).toBe('00FD');
  });

  it('ejecuta un LOOP hasta que termina', () => {
    const s = session();
    s.type('a 100', 'mov cx,5', 'inc ax', 'loop 103', 'nop', '');
    s.type('p 2');
    expect(hex(s.m.ip)).toBe('0104');
    s.type('p');
    expect([hex(s.m.ip), s.m.regs[CX], s.m.regs[AX]]).toEqual(['0106', 0, 5]);
  });

  it('en el resto de las instrucciones es igual a t', () => {
    const a = session();
    const b = session();
    for (const s of [a, b]) s.type('a 100', 'mov ax,1', 'add ax,2', '');
    expect(a.type('p 2')).toEqual(b.type('t 2'));
  });

  it('se detiene si el programa termina dentro de la llamada', () => {
    const s = session();
    s.type('a 100', 'call 200', '', 'a 200', 'int 20', '');
    expect(s.type('p')).toEqual(['Program terminated normally']);
  });
});

describe('commands: otros', () => {
  it('comando desconocido es error bajo la letra', () => {
    expect(session().type('x')).toEqual([' ^ Error']);
    expect(session().type('  z')).toEqual(['   ^ Error']);
  });

  it('q pide reiniciar', () => {
    const s = session();
    expect(run(s.m, s.state, 'q').reset).toBe(true);
  });

  it('una línea vacía en modo comando no hace nada', () => {
    expect(session().type('')).toEqual([]);
  });

  it('d y e indican a la ventana de datos dónde mirar', () => {
    const s = session();
    expect(run(s.m, s.state, 'd 300').dataFocus).toBe(0x300);
    expect(run(s.m, s.state, 'e 400 1').dataFocus).toBe(0x400);
  });
});

describe('commands: man', () => {
  it('man a explica el comando a', () => {
    const lines = session().type('man a');
    expect(lines[0]).toBe('NOMBRE');
    expect(lines[1]).toContain('a - ensambla instrucciones');
    expect(lines).toContain('SINOPSIS');
    expect(lines).toContain('DESCRIPCIÓN');
    expect(lines).toContain('EJEMPLOS');
  });

  it('acepta mayúsculas y espacios', () => {
    expect(session().type('  MAN   D ')[1]).toContain('d - muestra la memoria');
  });

  it('sin argumentos lista las páginas', () => {
    const lines = session().type('man');
    for (const c of ['a', 'u', 't', 'g', 'r', 'd', 'e', 'q', 'man']) {
      expect(lines.some((l) => l.trim().startsWith(`${c} - `))).toBe(true);
    }
  });

  it('avisa si no hay página', () => {
    expect(session().type('man z')).toEqual(['No hay entrada de manual para z']);
  });

  it('no cambia de modo ni toca la máquina', () => {
    const s = session();
    s.type('man r');
    expect(s.prompt()).toBe('-');
  });

  it('todas las líneas entran en 77 columnas', () => {
    const s = session();
    const all = ['', 'a', 'u', 't', 'g', 'r', 'd', 'e', 'q', 'clear', 'man'].flatMap((c) => s.type(`man ${c}`));
    for (const l of all) expect(l.length).toBeLessThanOrEqual(77);
  });

  it('una m sola es el comando m sin rango, no man', () => {
    expect(session().type('m')).toEqual(['  ^ Error']);
  });
});

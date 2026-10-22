import { describe, expect, it } from 'vitest';
import { assemble } from './assembler';
import { decode } from './decoder';
import { format } from './disassembler';
import { bootMachine, phys } from './memory';

function bytes(text: string, addr = 0x100): string {
  const r = assemble(text, addr);
  if (!r.ok) throw new Error(`"${text}" falló en la columna ${r.column}`);
  return r.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

function errorColumn(text: string, addr = 0x100): number {
  const r = assemble(text, addr);
  if (r.ok) throw new Error(`"${text}" no dio error`);
  return r.column;
}

describe('assembler: codificaciones de DEBUG', () => {
  it.each([
    ['mov ah,8', 0x100, 'B4 08'],
    ['mov ax,8', 0x100, 'B8 08 00'],
    ['add ah,3', 0x100, '80 C4 03'],
    ['sub ah,c', 0x100, '80 EC 0C'],
    ['add ax,3', 0x100, '05 03 00'],
    ['add bx,3', 0x100, '83 C3 03'],
    ['mov ax,bx', 0x100, '89 D8'],
    ['mov [0200],ax', 0x100, 'A3 00 02'],
    ['mov ax,[0200]', 0x100, 'A1 00 02'],
    ['add ax,[0203]', 0x100, '03 06 03 02'],
    ['mov [2000],ah', 0x100, '88 26 00 20'],
    ['mov byte ptr [2000],8', 0x100, 'C6 06 00 20 08'],
    ['mul cx', 0x100, 'F7 E1'],
    ['imul cl', 0x100, 'F6 E9'],
    ['div bl', 0x100, 'F6 F3'],
    ['shr al,1', 0x100, 'D0 E8'],
    ['push [1100]', 0x100, 'FF 36 00 11'],
    ['jmp 130', 0x100, 'EB 2E'],
    ['jnz 138', 0x13b, '75 FB'],
    ['loop 138', 0x13a, 'E2 FC'],
    ['int 21', 0x100, 'CD 21'],
  ])('%s → %s', (text, addr, expected) => {
    expect(bytes(text, addr as number)).toBe(expected);
  });
});

describe('assembler: sintaxis', () => {
  it('no distingue mayúsculas y tolera espacios', () => {
    expect(bytes('  MOV  AH , 8 ')).toBe('B4 08');
    expect(bytes('Mov Ax,FfFf')).toBe('B8 FF FF');
  });

  it('inmediatos negativos', () => {
    expect(bytes('mov cx,-1')).toBe('B9 FF FF');
    expect(bytes('mov al,-80')).toBe('B0 80');
    expect(bytes('add bx,-1')).toBe('83 C3 FF');
  });

  it('byte y word con o sin ptr', () => {
    expect(bytes('mov byte [2000],8')).toBe('C6 06 00 20 08');
    expect(bytes('inc word ptr [bx]')).toBe('FF 07');
    expect(bytes('mov word [bx+si+2],1234')).toBe('C7 40 02 34 12');
  });

  it('direccionamiento con registros', () => {
    expect(bytes('mov ax,[bx]')).toBe('8B 07');
    expect(bytes('mov ax,[bp]')).toBe('8B 46 00');
    expect(bytes('mov ax,[bp-4]')).toBe('8B 46 FC');
    expect(bytes('mov ax,[bx+1234]')).toBe('8B 87 34 12');
    expect(bytes('mov al,[bx+di]')).toBe('8A 01');
    expect(errorColumn('mov al,[si+di]')).toBe(11);
  });

  it('prefijo de segmento', () => {
    expect(bytes('mov ax,es:[200]')).toBe('26 A1 00 02');
    expect(bytes('es:')).toBe('26');
  });

  it('saltos cortos y cercanos', () => {
    expect(bytes('jmp 200')).toBe('E9 FD 00');
    expect(bytes('jmp 181')).toBe('EB 7F');
    expect(bytes('jmp 182')).toBe('E9 7F 00');
    expect(bytes('call 200')).toBe('E8 FD 00');
    expect(bytes('jcxz 104')).toBe('E3 02');
    expect(bytes('jmp 0dab:0100')).toBe('EA 00 01 AB 0D');
    expect(bytes('jmp bx')).toBe('FF E3');
    expect(bytes('call far [bx]')).toBe('FF 1F');
  });

  it('registro dentro del opcode: cada registro con su byte', () => {
    const regs16 = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
    const regs8 = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
    const hex2 = (n: number) => n.toString(16).toUpperCase();
    regs16.forEach((r, i) => {
      expect(bytes(`inc ${r}`)).toBe(hex2(0x40 + i));
      expect(bytes(`dec ${r}`)).toBe(hex2(0x48 + i));
      expect(bytes(`push ${r}`)).toBe(hex2(0x50 + i));
      expect(bytes(`pop ${r}`)).toBe(hex2(0x58 + i));
      expect(bytes(`mov ${r},1`)).toBe(`${hex2(0xb8 + i)} 01 00`);
      expect(bytes(`xchg ax,${r}`)).toBe(hex2(0x90 + i));
      expect(bytes(`xchg ${r},ax`)).toBe(hex2(0x90 + i));
    });
    regs8.forEach((r, i) => expect(bytes(`mov ${r},1`)).toBe(`${hex2(0xb0 + i)} 01`));
  });

  it('NOP, y AAM y AAD sin operando en base 10', () => {
    expect(bytes('nop')).toBe('90');
    expect(bytes('aam')).toBe('D4 0A');
    expect(bytes('aad')).toBe('D5 0A');
    expect(bytes('aam 8')).toBe('D4 08');
  });

  it('alias y formas cortas', () => {
    expect(bytes('je 100')).toBe('74 FE');
    expect(bytes('inc ax')).toBe('40');
    expect(bytes('push ax')).toBe('50');
    expect(bytes('pop [1100]')).toBe('8F 06 00 11');
    expect(bytes('xchg bx,ax')).toBe('93');
    expect(bytes('add al,3')).toBe('04 03');
    expect(bytes('int 3')).toBe('CC');
    expect(bytes('mov ds,ax')).toBe('8E D8');
    expect(bytes('ret')).toBe('C3');
    expect(bytes('rep movsb')).toBe('F3 A4');
    expect(bytes('lea dx,[200]')).toBe('8D 16 00 02');
    expect(bytes('shl bx,cl')).toBe('D3 E3');
  });

  it('DB con bytes y cadenas', () => {
    expect(bytes('db 41,42 "c" \'d,e\' 0d 0a')).toBe('41 42 63 64 2C 65 0D 0A');
  });
});

describe('assembler: errores', () => {
  it('mnemónico desconocido', () => {
    expect(errorColumn('xyz ax,1')).toBe(0);
    expect(errorColumn('-r')).toBe(0);
    expect(errorColumn('  foo')).toBe(2);
  });

  it('dos operandos de memoria', () => {
    expect(errorColumn('mov [100],[200]')).toBe(10);
  });

  it('tamaños distintos', () => {
    expect(errorColumn('mov ax,bl')).toBe(7);
  });

  it('inmediato que no cabe', () => {
    expect(errorColumn('mov ah,100')).toBe(7);
    expect(errorColumn('mov ax,10000')).toBe(7);
  });

  it('registro inválido entre corchetes', () => {
    expect(errorColumn('mov ax,[ax]')).toBe(8);
    expect(errorColumn('mov ax,[bx+bp]')).toBe(11);
  });

  it('memoria sin registro y sin tamaño', () => {
    expect(errorColumn('mov [2000],8')).toBe(11);
    expect(errorColumn('inc [bx]')).toBe(4);
  });

  it('salto condicional fuera de rango', () => {
    expect(errorColumn('jnz 200')).toBe(4);
    expect(errorColumn('loop 300')).toBe(5);
  });
});

describe('assembler ↔ disassembler', () => {
  it.each([
    'MOV     AH,08',
    'ADD     BX,+03',
    'MOV     BYTE PTR [2000],08',
    'MOV     AX,[BP-04]',
    'PUSH    [1100]',
    'SHR     AL,1',
    'LOOP    0138',
    'XCHG    AX,BX',
    'MOV     ES,AX',
    'CALL    FAR [BX+SI+10]',
  ])('%s', (text) => {
    const r = assemble(text.replace('+03', '3'), 0x13a);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = bootMachine();
    m.mem.set(r.bytes, phys(0x0dab, 0x13a));
    expect(format(decode(m, 0x0dab, 0x13a))).toBe(text);
  });
});

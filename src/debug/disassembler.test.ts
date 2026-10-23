import { describe, expect, it } from 'vitest';
import { decode } from './decoder';
import { format, formatLine } from './disassembler';
import { bootMachine, phys } from './memory';

function text(bytes: number[], ip = 0x100): string {
  const m = bootMachine();
  m.mem.set(bytes, phys(0x0dab, ip));
  return format(decode(m, 0x0dab, ip));
}

describe('disassembler', () => {
  it.each([
    [[0xb4, 0x08], 'MOV     AH,08'],
    [[0xb8, 0x08, 0x00], 'MOV     AX,0008'],
    [[0x80, 0xc4, 0x03], 'ADD     AH,03'],
    [[0x80, 0xec, 0x0c], 'SUB     AH,0C'],
    [[0x05, 0x03, 0x00], 'ADD     AX,0003'],
    [[0x83, 0xc3, 0x03], 'ADD     BX,+03'],
    [[0x83, 0xe9, 0xff], 'SUB     CX,-01'],
    [[0x89, 0xd8], 'MOV     AX,BX'],
    [[0xa3, 0x00, 0x02], 'MOV     [0200],AX'],
    [[0xa1, 0x00, 0x02], 'MOV     AX,[0200]'],
    [[0x03, 0x06, 0x03, 0x02], 'ADD     AX,[0203]'],
    [[0x88, 0x26, 0x00, 0x20], 'MOV     [2000],AH'],
    [[0xc6, 0x06, 0x00, 0x20, 0x08], 'MOV     BYTE PTR [2000],08'],
    [[0xc7, 0x07, 0x34, 0x12], 'MOV     WORD PTR [BX],1234'],
    [[0xf7, 0xe1], 'MUL     CX'],
    [[0xf6, 0xe9], 'IMUL    CL'],
    [[0xf6, 0xf3], 'DIV     BL'],
    [[0xd0, 0xe8], 'SHR     AL,1'],
    [[0xd2, 0x27], 'SHL     BYTE PTR [BX],CL'],
    [[0xff, 0x36, 0x00, 0x11], 'PUSH    [1100]'],
    [[0xfe, 0x07], 'INC     BYTE PTR [BX]'],
    [[0xcd, 0x21], 'INT     21'],
    [[0xcc], 'INT     3'],
    [[0x00, 0x00], 'ADD     [BX+SI],AL'],
    [[0x8b, 0x46, 0xfc], 'MOV     AX,[BP-04]'],
    [[0x8b, 0x47, 0x02], 'MOV     AX,[BX+02]'],
    [[0x8b, 0x87, 0x34, 0x12], 'MOV     AX,[BX+1234]'],
    [[0x8d, 0x16, 0x00, 0x02], 'LEA     DX,[0200]'],
    [[0xff, 0x1f], 'CALL    FAR [BX]'],
    [[0xea, 0x00, 0x01, 0xab, 0x0d], 'JMP     0DAB:0100'],
    [[0xd4, 0x0a], 'AAM'],
    [[0xc3], 'RET'],
    [[0xa4], 'MOVSB'],
    [[0x26], 'ES:'],
    [[0xf3], 'REPZ'],
    [[0x0f], 'DB      0F'],
    [[0xfe, 0x38], '???     [BX+SI]'],
  ])('%j → %s', (bytes, expected) => {
    expect(text(bytes)).toBe(expected);
  });

  it('saltos con destino absoluto de 4 dígitos', () => {
    expect(text([0xeb, 0x2e])).toBe('JMP     0130');
    expect(text([0x75, 0xfb], 0x13b)).toBe('JNZ     0138');
    expect(text([0xe2, 0xfc], 0x13a)).toBe('LOOP    0138');
    expect(text([0xe3, 0x02])).toBe('JCXZ    0104');
  });

  it('línea completa como la de u', () => {
    const m = bootMachine();
    expect(formatLine(0x073f, 0x100, decode(m, 0x073f, 0x100))).toBe('073F:0100 0000          ADD     [BX+SI],AL');
    m.mem.set([0x88, 0x26, 0x00, 0x20], phys(0x0dab, 0x108));
    expect(formatLine(0x0dab, 0x108, decode(m, 0x0dab, 0x108))).toBe('0DAB:0108 88260020      MOV     [2000],AH');
  });
});

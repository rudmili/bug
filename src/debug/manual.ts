/**
 * Páginas de `man`, al estilo de Linux. No es un comando de DEBUG: es una ayuda de este simulador.
 * Todo entra en las 77 columnas que la terminal muestra sin scroll horizontal en móvil:
 * la descripción se vuelve a cortar sola; un '' separa párrafos.
 */

interface ManPage {
  name: string;
  synopsis: string[];
  description: string[];
  examples: string[];
}

const PAGES: Record<string, ManPage> = {
  a: {
    name: 'a - ensambla instrucciones en memoria',
    synopsis: ['a [dirección]'],
    description: [
      'Entra en modo ensamblado: cada línea que escribas se traduce a código',
      'máquina y se guarda en memoria, una instrucción detrás de otra. El prompt',
      'muestra la dirección (segmento:desplazamiento) donde irá la siguiente.',
      '',
      'Sin dirección continúa donde quedó el último `a`; al empezar es CS:0100.',
      'Una línea vacía sale del modo ensamblado y vuelve al prompt `-`.',
      'Si una instrucción no es válida, `^ Error` marca la columna del problema.',
    ],
    examples: [
      'a 100         ensambla desde CS:0100',
      'mov ax,5      guarda B8 05 00 en memoria',
      'add ax,3',
      '(línea vacía) termina',
    ],
  },
  u: {
    name: 'u - desensambla la memoria',
    synopsis: ['u [dirección]', 'u dirección fin', 'u dirección L longitud'],
    description: [
      'Lee la memoria como código y la muestra como instrucciones: dirección,',
      'bytes y su traducción a ensamblador.',
      '',
      'Sin argumentos muestra 20h bytes desde donde quedó el último `u`; la',
      'primera vez arranca en CS:IP. Nunca corta una instrucción por la mitad.',
    ],
    examples: [
      'u             desde CS:IP (o donde quedó)',
      'u 100         20h bytes desde CS:0100',
      'u 100 10a     de CS:0100 a CS:010A',
      'u 100 l 8     8 bytes desde CS:0100',
    ],
  },
  t: {
    name: 't - ejecuta paso a paso (trace)',
    synopsis: ['t [=dirección] [cantidad]'],
    description: [
      'Ejecuta una instrucción en CS:IP y muestra los registros, las banderas y',
      'la siguiente instrucción. Con cantidad, ejecuta esa cantidad de pasos y',
      'muestra el estado después de cada uno.',
      '',
      'Con =dirección, primero mueve CS:IP a esa dirección.',
      'Se detiene si el programa termina (por ejemplo con INT 20 o RET a DOS).',
    ],
    examples: [
      't             un paso',
      't 3           tres pasos',
      't =100        ejecuta desde CS:0100',
    ],
  },
  g: {
    name: 'g - ejecuta hasta el final (go)',
    synopsis: ['g [=dirección] [punto de parada ...]'],
    description: [
      'Ejecuta el programa desde CS:IP hasta que termine. Muestra lo que el',
      'programa imprima y, al final, "Program terminated normally".',
      '',
      'Con =dirección, primero mueve CS:IP a esa dirección. Las direcciones que',
      'siguen son puntos de parada: al llegar a una se detiene y muestra los',
      'registros. INT 3 también detiene la ejecución.',
      'Por seguridad se detiene tras 1.000.000 de instrucciones.',
    ],
    examples: [
      'g             hasta el final',
      'g 108         se detiene al llegar a CS:0108',
      'g =100 10a    desde CS:0100 hasta CS:010A',
    ],
  },
  r: {
    name: 'r - muestra o cambia registros',
    synopsis: ['r', 'r registro'],
    description: [
      'Sin argumentos muestra todos los registros, las banderas y la',
      'instrucción en CS:IP.',
      '',
      'Con un registro muestra su valor y pide uno nuevo con el prompt `:`.',
      'Escribe el valor en hexadecimal, o deja la línea vacía para no cambiarlo.',
      'Registros: AX BX CX DX SP BP SI DI DS ES SS CS IP (o PC).',
    ],
    examples: [
      'r             muestra todo',
      'r ax          muestra AX y pide el valor nuevo',
      ':1234         AX pasa a valer 1234',
    ],
  },
  d: {
    name: 'd - muestra la memoria (dump)',
    synopsis: ['d [dirección]', 'd dirección fin', 'd dirección L longitud'],
    description: [
      'Muestra la memoria en filas de 16 bytes: dirección, los bytes en',
      'hexadecimal y, a la derecha, los mismos bytes como texto (un punto si no',
      'es imprimible).',
      '',
      'Sin argumentos muestra 80h bytes desde donde quedó el último `d`; la',
      'primera vez arranca en DS:0100. El segmento por defecto es DS.',
    ],
    examples: [
      'd             80h bytes (o donde quedó)',
      'd 200         desde DS:0200',
      'd 200 l 10    16 bytes desde DS:0200',
      'd cs:100      desde CS:0100',
    ],
  },
  e: {
    name: 'e - escribe en memoria (enter)',
    synopsis: ['e dirección [lista]'],
    description: [
      'Con una lista, escribe esos bytes a partir de la dirección. La lista',
      'admite bytes en hexadecimal y texto entre comillas.',
      '',
      'Sin lista, entra en modo edición: el prompt muestra la dirección y el byte',
      'actual; escribe el valor nuevo y pasa al siguiente. Una línea vacía sale.',
      'El segmento por defecto es DS.',
    ],
    examples: [
      'e 200 41 42 43       escribe 41 42 43 en DS:0200',
      'e 200 "Hola$"        escribe el texto',
      'e 200                edita byte a byte',
    ],
  },
  q: {
    name: 'q - reinicia la máquina (quit)',
    synopsis: ['q'],
    description: [
      'En el DEBUG original sale al DOS. Aquí borra la terminal y deja la',
      'máquina como al abrir la página: memoria vacía y registros iniciales.',
    ],
    examples: ['q'],
  },
  man: {
    name: 'man - muestra el manual de un comando',
    synopsis: ['man [comando]'],
    description: [
      'Explica qué hace un comando, cómo se escribe y da ejemplos.',
      'Sin comando, lista las páginas disponibles.',
      'Los números de todos los comandos van en hexadecimal.',
    ],
    examples: ['man a', 'man d'],
  },
};

const INDENT = '    ';
const WIDTH = 77;

function section(title: string, lines: string[]): string[] {
  return [title, ...lines.map((l) => (l === '' ? '' : INDENT + l)), ''];
}

/** Une las líneas de cada párrafo (separados por '') y las vuelve a cortar al ancho de la terminal. */
function reflow(lines: string[]): string[] {
  const width = WIDTH - INDENT.length;
  const result: string[] = [];
  const paragraphs = lines.join('\n').split('\n\n');
  paragraphs.forEach((paragraph, i) => {
    if (i > 0) result.push('');
    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      if (current !== '' && current.length + 1 + word.length > width) {
        result.push(current);
        current = word;
      } else {
        current = current === '' ? word : `${current} ${word}`;
      }
    }
    result.push(current);
  });
  return result;
}

/** Líneas de salida de `man <args>`. `ok: false` si no hay página. */
export function manual(args: string): { ok: boolean; lines: string[] } {
  const topic = args.trim().toLowerCase();
  if (topic === '') {
    return {
      ok: true,
      lines: [
        'Páginas disponibles. Escribe `man <comando>`, por ejemplo `man a`:',
        '',
        ...Object.values(PAGES).map((p) => INDENT + p.name),
      ],
    };
  }
  const page = PAGES[topic];
  if (!page) return { ok: false, lines: [`No hay entrada de manual para ${args.trim()}`] };
  return {
    ok: true,
    lines: [
      ...section('NOMBRE', [page.name]),
      ...section('SINOPSIS', page.synopsis),
      ...section('DESCRIPCIÓN', reflow(page.description)),
      ...section('EJEMPLOS', page.examples),
    ],
  };
}

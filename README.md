# Lector con guía de lectura

Lector web de **PDF, EPUB, MOBI/AZW3** (también FB2 y CBZ) con una guía de
resaltado de línea que se maneja con teclado y mouse. Todo ocurre en el
navegador: los archivos no se suben a ningún servidor.

## Cómo usarlo

```bash
python3 serve.py
```

Abrí <http://127.0.0.1:8765> y arrastrá un libro a la ventana (o usá **Abrir**).
No hace falta instalar nada: no hay paso de build.

## Usarlo en el iPhone

La app se instala desde Safari y no necesita App Store. Primero hay que publicarla:

```bash
python3 tools/build_pwa.py
```

Eso crea `dist/`, con solo lo necesario. Subí esa carpeta a un servicio de páginas
estáticas con HTTPS, como Netlify Drop (<https://app.netlify.com/drop>) o GitHub Pages.
Después de cada cambio, volvé a generarla y a subirla.

En el iPhone: abrí la dirección en Safari, tocá **Compartir → Agregar a pantalla de inicio**
y abrí la app una vez con internet. A partir de ahí funciona sin conexión.
Los libros no se suben a ningún lado: se abren desde el teléfono.

- **▲ / ▼**: línea o palabra anterior / siguiente.
- **Tocar el texto**: lleva la franja a esa línea o palabra.
- **Deslizar a los costados**: cambia de página en EPUB y MOBI; en PDF se desplaza con el dedo.

## Guía de lectura

- **Texto resaltado** / **Texto no resaltado**: opacidad de cada parte (0–100 %).
- **Líneas**: cuántas líneas abarca la franja.
- **Modo**: *Ajustar a línea* (la franja se ajusta a las líneas reales del texto)
  o *Franja libre* (alto fijo; sirve para PDFs escaneados sin texto).
- **Letra A− / A+** en la barra superior: tamaño de letra en EPUB/MOBI (zoom en PDF); el porcentaje vuelve al tamaño original.
- **Palabra por palabra** (`W`): la franja resalta una sola palabra; `↓`/`↑` pasan a la
  palabra siguiente/anterior y, al final de la línea, siguen en la próxima. Solo en modo *Ajustar a línea*.
- **⚙ Opciones**: oculta o muestra la barra de opciones de la guía para dejar más espacio al texto.
- **☰ Índice** (`I`): lista de capítulos o secciones del documento; un clic lleva a esa parte y la sección actual aparece marcada.
- **Seguir puntero**, **color** e **intensidad** del resaltado, y **tema** claro / sepia / oscuro.

Los ajustes y la última posición de cada libro se guardan en el navegador.

### Teclado

| Tecla | Acción |
|---|---|
| `↓` / `J` · `↑` / `K` | Línea siguiente / anterior (cambia de página al llegar al borde) |
| `Shift` + `↓` / `↑` | Saltar 5 líneas |
| `→` `←` `AvPág` `RePág` `Espacio` | Cambiar de página |
| `+` / `-` | Más / menos líneas (alto de la franja en modo libre) |
| `[` / `]` | Opacidad del texto no resaltado |
| `{` / `}` | Opacidad del texto resaltado |
| `Ctrl`/`⌘` + `+` / `-` / `0` | Agrandar / achicar la letra (zoom en PDF) / tamaño original |
| `G` · `M` · `F` · `W` | Guía sí/no · modo · seguir puntero · palabra por palabra |
| `I` | Mostrar / ocultar el índice de contenido |
| `O` · `?` | Abrir archivo · ayuda |

### Mouse

- Mover el puntero: la franja sigue la línea bajo el cursor.
- Clic: lleva la franja a esa línea.
- `Alt`/`⌥` + rueda: avanzar o retroceder línea por línea.
- Modo libre: arrastrá la manija bajo la franja para cambiar su alto.

## Estructura

- `src/readers/pdfReader.js`: PDF con pdf.js (scroll continuo, capa de texto).
- `src/readers/bookReader.js`: EPUB/MOBI/AZW3 con foliate-js (paginado).
- `src/guide/lineDetector.js`: agrupa rectángulos de texto en líneas y columnas.
- `src/guide/readingGuide.js`: la franja y el velo que atenúa el resto.
- `src/guide/controls.js`: teclado y mouse.
- `src/vendor/foliate-js/`: [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT), que incluye pdf.js (Apache 2.0).

Para probar rápido se puede abrir un archivo servido desde esta carpeta con
`?url=`, por ejemplo `http://127.0.0.1:8765/?url=.samples/quijote.epub`.

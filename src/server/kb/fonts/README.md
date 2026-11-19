# Fonts for PDF exports

`NotoEmoji-Regular.ttf` draws emoji in exported knowledge base articles
(`src/server/kb/export-pdf.ts`). It is Noto Emoji by Google, under the SIL Open
Font License 1.1 (`NotoEmoji-OFL.txt`), made from `ofl/notoemoji/NotoEmoji[wght].ttf`
in github.com/google/fonts:

```bash
pip install fonttools
python3 -m fontTools.varLib.instancer "NotoEmoji[wght].ttf" wght=400 -o NotoEmoji-Regular.ttf
python3 - <<'PY'
from fontTools.ttLib import TTFont
font = TTFont("NotoEmoji-Regular.ttf")
font["glyf"].padding = 4
font.save("NotoEmoji-Regular.ttf")
PY
```

The variable font is fixed at Regular because pdf-lib cannot subset a variable
font. Every glyph is padded to a multiple of four bytes because pdf-lib's
subsetter copies glyphs byte for byte into a font whose `loca` table cannot
point at an odd offset: an odd-length glyph draws as nothing, and so does every
glyph after it. `export-pdf.test.ts` checks the padding.

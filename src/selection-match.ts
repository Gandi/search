import {EditorView, ViewPlugin, Decoration, DecorationSet, ViewUpdate, themeClass} from "@codemirror/next/view"
import {Facet, combineConfig, Text, Extension, CharCategory} from "@codemirror/next/state"
import {findClusterBreak} from "@codemirror/next/text"
import {SearchCursor} from "./cursor"

type HighlightOptions = {
  /// Determines whether, when nothing is selected, the word around
  /// the cursor is matched instead. Defaults to false.
  highlightWordAroundCursor?: boolean,
  /// The minimum length of the selection before it is highlighted.
  /// Defaults to 1 (always highlight non-cursor selections).
  minSelectionLength?: number,
  /// The amount of matches (in the viewport) at which to disable
  /// highlighting. Defaults to 100.
  maxMatches?: number
}

const defaultHighlightOptions = {
  highlightWordAroundCursor: false,
  minSelectionLength: 1,
  maxMatches: 100
}

const highlightConfig = Facet.define<HighlightOptions, Required<HighlightOptions>>({
  combine(options: readonly HighlightOptions[]) {
    return combineConfig(options, defaultHighlightOptions, {
      highlightWordAroundCursor: (a, b) => a || b,
      minSelectionLength: Math.min,
      maxMatches: Math.min
    })
  }
})

/// This extension highlights text that matches the selection. It uses
/// the `$selectionMatch` theme class for the highlighting. When
/// `highlightWordAroundCursor` is enabled, the word at the cursor
/// itself will be highlighted with `selectionMatch.main`.
export function highlightSelectionMatches(options?: HighlightOptions): Extension {
  let ext = [defaultTheme, matchHighlighter]
  if (options) ext.push(highlightConfig.of(options))
  return ext
}

function wordAt(doc: Text, pos: number, check: (ch: string) => CharCategory) {
  let line = doc.lineAt(pos)
  let from = pos - line.from, to = pos - line.from
  while (from > 0) {
    let prev = findClusterBreak(line.text, from, false)
    if (check(line.text.slice(prev, from)) != CharCategory.Word) break
    from = prev
  }
  while (to < line.length) {
    let next = findClusterBreak(line.text, to)
    if (check(line.text.slice(to, next)) != CharCategory.Word) break
    to = next
  }
  return from == to ? null : line.text.slice(from, to)
}

const matchDeco = Decoration.mark({class: themeClass("selectionMatch")})
const mainMatchDeco = Decoration.mark({class: themeClass("selectionMatch.main")})

const matchHighlighter = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = this.getDeco(view)
  }

  update(update: ViewUpdate) {
    if (update.selectionSet || update.docChanged || update.viewportChanged) this.decorations = this.getDeco(update.view)
  }

  getDeco(view: EditorView) {
    let conf = view.state.facet(highlightConfig)
    let {state} = view, sel = state.selection
    if (sel.ranges.length > 1) return Decoration.none
    let range = sel.main, query, check = null
    if (range.empty) {
      if (!conf.highlightWordAroundCursor) return Decoration.none
      check = state.charCategorizer(range.head)
      query = wordAt(state.doc, range.head, check)
      if (!query) return Decoration.none
    } else {
      let len = range.to - range.from
      if (len < conf.minSelectionLength || len > 200) return Decoration.none
      query = state.sliceDoc(range.from, range.to).trim()
      if (!query) return Decoration.none
    }
    let deco = []
    for (let part of view.visibleRanges) {
      let cursor = new SearchCursor(state.doc, query, part.from, part.to)
      while (!cursor.next().done) {
        let {from, to} = cursor.value
        if (!check || ((from == 0 || check(state.sliceDoc(from - 1, from)) != CharCategory.Word) &&
                       (to == state.doc.length || check(state.sliceDoc(to, to + 1)) != CharCategory.Word))) {
          if (check && from <= range.from && to >= range.to)
            deco.push(mainMatchDeco.range(from, to))
          else if (from >= range.to || to <= range.from)
            deco.push(matchDeco.range(from, to))
          if (deco.length > conf.maxMatches) return Decoration.none
        }
      }
    }
    return Decoration.set(deco)
  }
}, {
  decorations: v => v.decorations
})

const defaultTheme = EditorView.baseTheme({
  "$selectionMatch": { backgroundColor: "#99ff7780" },
  "$searchMatch $selectionMatch": {backgroundColor: "transparent"}
})

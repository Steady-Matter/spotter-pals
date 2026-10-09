// The pixel Pals: one for the bar and one per helper agent, picked by the job it runs. A Pal starts
// as an egg, hatches small and grows as its agent works; a Lucky one is bigger and sparkles; one
// whose agent failed is knocked out. Which Pal goes with which job is in core.ts.
import type { Pal, PalLook } from '../types'
import { EGG_SPRITE, PAL_SPRITES } from './pal-sprites'

/** The Pals' grid: 40×38 cells; a drawing of it at `scale` is this many pixels. */
export const PAL_GRID = { w: 40, h: 38 }

// How much of the drawing each stage fills, by its stars (0 is the egg). A Lucky Pal fills all of it.
const SIZE: Record<PalLook['stars'], number> = { 0: 0.65, 1: 0.57, 2: 0.72, 4: 0.87 }

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const CROSS = ['xx...xx', 'xxx.xxx', '.xxxxx.', '..xxx..', '.xxxxx.', 'xxx.xxx', 'xx...xx']
const GHOST = ['..www..', '.wwwww.', 'wwkwkww', 'wwwwwww', 'wwwwwww', '.wwwww.', '.ww.ww.', '..w..w.', '...w...']
const SPARKLE = ['.g.', 'gwg', '.g.']
const INKS: Record<string, string> = { x: '#F04A4A', w: '#E9EEF5', k: '#3A3A45', g: '#F5C542' }

// Pure CSS, run by the compositor: no redraws. A working Pal hops and a working egg rocks; a Lucky
// Pal's sparkles blink and a knocked-out Pal's ghost drifts whenever motion is on.
export const PAL_CSS = `
.pal g{transform-box:fill-box}
.run .bd{animation:hop .5s steps(1) infinite}
.run .eg{transform-origin:50% 100%;animation:rock .7s ease-in-out infinite}
.mv .sp{animation:blink .8s steps(1) infinite}.mv .sp2{animation:blink .8s steps(1) infinite -.4s}
.mv .gh{animation:drift 1.6s ease-in-out infinite}
@keyframes hop{50%{transform:translateY(-1px)}}@keyframes rock{25%{transform:rotate(-7deg)}75%{transform:rotate(7deg)}}
@keyframes blink{50%{opacity:.15}}@keyframes drift{50%{transform:translateY(-2px)}}
@media (prefers-reduced-motion: reduce){.pal g{animation:none!important}}
`

// One path per colour, each run of cells along a row a single box: a Pal is a dozen paths, not a
// thousand rectangles.
const paths = (rows: string[], colorOf: (ch: string) => string, ox = 0, oy = 0) => {
  const d = new Map<string, string>()
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const ch = row[x] ?? '.'
      let n = 1
      while (row[x + n] === ch) n += 1
      if (ch !== '.') {
        const c = colorOf(ch)
        d.set(c, `${d.get(c) ?? ''}M${ox + x} ${oy + y}h${n}v1h-${n}z`)
      }
      x += n
    }
  })
  return [...d].map(([c, p]) => `<path fill="${c}" d="${p}"/>`).join('')
}

const ink = (rows: string[], x: number, y: number) => paths(rows, ch => INKS[ch] ?? '', x, y)

// A knocked-out Pal's colours: its own, drained to grey and a little darker.
const drained = (c: string) => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
  const v = Math.round((0.3 * r + 0.59 * g + 0.11 * b) * 0.8 + 5)
  return `rgb(${v},${v},${v})`
}

/**
 * One Pal as SVG markup at (x, y), standing on the bottom of a `PAL_GRID` box at `scale`. It is
 * drawn at its stage's size inside that box, or filling it when `fills` (a drawing too small to
 * show growth). Needs `PAL_CSS` in the drawing.
 */
export const pal = (x: number, y: number, k: Pal, look: PalLook, scale: number, isWorking: boolean, hasMotion = true, fills = false) => {
  const s = PAL_SPRITES[k]
  const isEgg = look.stars === 0 && !look.isDown
  const isLucky = look.isLucky && !isEgg && !look.isDown
  const size = fills || isLucky ? 1 : SIZE[look.isDown ? 4 : look.stars]
  const colorOf = (ch: string) => s.colors[LETTERS.indexOf(ch)] ?? ''
  const body = isEgg
    ? `<g class="eg">${paths(EGG_SPRITE.rows, ch => (ch === '*' ? s.egg : (EGG_SPRITE.colors[LETTERS.indexOf(ch)] ?? '')))}</g>`
    : `<g class="bd">${paths(s.rows, look.isDown ? ch => drained(colorOf(ch)) : colorOf)}${look.isDown ? s.eyes.map(([ex, ey]) => ink(CROSS, ex - 3, ey - 3)).join('') : ''}</g>`
  const ghost = look.isDown ? `<g class="gh">${ink(GHOST, 33, 0)}</g>` : ''
  const sparkles = isLucky
    ? `<g class="sp">${ink(SPARKLE, 1, 3)}${ink(SPARKLE, 36, 29)}${ink(SPARKLE, 33, 0)}</g><g class="sp2">${ink(SPARKLE, 36, 5)}${ink(SPARKLE, 2, 30)}</g>`
    : ''
  const dx = x + ((PAL_GRID.w * (1 - size)) / 2) * scale
  const dy = y + PAL_GRID.h * (1 - size) * scale
  return `<g transform="translate(${dx.toFixed(2)},${dy.toFixed(2)}) scale(${(scale * size).toFixed(3)})" shape-rendering="crispEdges"><g class="pal${hasMotion ? ' mv' : ''}${isWorking && hasMotion ? ' run' : ''}">${body}${ghost}${sparkles}</g></g>`
}

/** A Pal on its own, for an agent's row: it hops while its agent works. */
export const palSvg = (k: Pal, look: PalLook, scale: number, isWorking: boolean, hasMotion = true, fills = false) => {
  const w = Math.ceil(PAL_GRID.w * scale)
  const h = Math.ceil(PAL_GRID.h * scale)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>${PAL_CSS}</style>${pal(0, 0, k, look, scale, isWorking, hasMotion, fills)}</svg>`
}

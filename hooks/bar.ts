// The progress bar's desktop drawing: one SVG row above the prompt. Its look (the colours, the
// dithered fill and the label pill) is adapted from savvy-progress,
// https://github.com/JohnnyVizz/claude-kit, MIT License, Copyright (c) 2026 johnnyvizz.
import type { Plan } from '../types'
import { palOf, planHype, planLabel, planLook, planRatio } from './core'
import { PAL_CSS, PAL_GRID, pal } from './pals'

export const ACCENT = '#8f8cf4'
export const DONE = '#5fbf8f'

export const BAR_HEIGHT = 22
const FILL_H = 16
const PAL_W = 26
const CELL = 3
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

const xml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// Rough advance of system UI text, in em: good enough to size the title's slot.
const charEm = (ch: string) => (/[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Zmw@%]/.test(ch) ? 0.72 : 0.56)
const textWidth = (s: string, size: number) => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

const fitText = (s: string, size: number, maxW: number) => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(`${out}${ch}…`, size) > maxW) break
    out += ch
  }
  return `${out}…`
}

// Deterministic noise, so the dither does not shimmer between redraws.
const noise = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

const CSS = (isFinished: boolean) => `<style>
.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}
.t0,.t1,.t2,.t3{animation:tw ${isFinished ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${isFinished ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${isFinished ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${isFinished ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${isFinished ? 0.8 : 0.3}}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none!important}}
${PAL_CSS}</style>`

/**
 * The whole row as one drawing `width` pixels wide: title, the step under way, bar, label pill,
 * percent and a Pal, picked by the job the title names: an egg at first, Lucky when it is done.
 */
export const barSvg = (p: Plan, width: number, isWorking: boolean) => {
  // The title and the words beside it take what they need, up to 45% of the row; the bar takes the rest.
  const slot = Math.max(60, width * 0.45)
  const title = fitText(p.title, 13, Math.min(slot, Math.max(60, width * 0.28)))
  const subRoom = slot - textWidth(title, 13) - 10
  const sub = subRoom >= 44 ? fitText(planHype(p), 12, subRoom) : ''
  const subX = Math.round(16 + textWidth(title, 13) + 8)
  const barX = Math.round(sub ? subX + textWidth(sub, 12) + 12 : subX + 4)
  const barW = Math.max(60, width - barX - 46 - PAL_W)
  const color = p.isFinished ? DONE : ACCENT
  const fillW = Math.round(barW * planRatio(p))

  // Dithered fill: sparse at the start, dense toward the head.
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(FILL_H / CELL)
  const dots: string[] = []
  for (let c = 0; c < cols; c += 1) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r += 1) {
      if (noise(c, r) < density) dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
  }

  // One tick per step still ahead.
  const ticks: string[] = []
  for (let i = 1; i < p.total && p.total <= 40; i += 1) {
    const x = Math.round((barW * i) / p.total)
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${FILL_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }

  const label = planLabel(p)
  const pillW = Math.round(18 + label.length * 6.6)
  const pillX = Math.max(0, Math.min(barW - pillW, fillW - pillW))
  const mid = BAR_HEIGHT / 2

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAR_HEIGHT}" viewBox="0 0 ${width} ${BAR_HEIGHT}">
${CSS(p.isFinished)}
<defs><clipPath id="c"><rect x="0" y="0" width="${barW}" height="${FILL_H}" rx="${FILL_H / 2}"/></clipPath></defs>
<circle cx="5" cy="${mid}" r="4" fill="${color}"/>
<text class="t" x="16" y="${mid + 4.5}" font-family="${FONT}" font-size="13" font-weight="600">${xml(title)}</text>
${sub ? `<text ${p.isFinished ? `fill="${DONE}"` : 'class="m"'} x="${subX}" y="${mid + 4.5}" font-family="${FONT}" font-size="12">${xml(sub)}</text>` : ''}
<g transform="translate(${barX},${(BAR_HEIGHT - FILL_H) / 2})">
<rect class="k" width="${barW}" height="${FILL_H}" rx="${FILL_H / 2}"/>
<g clip-path="url(#c)"><g fill="${color}">${dots.join('')}</g><g class="tk">${ticks.join('')}</g></g>
<rect x="${pillX}" width="${pillW}" height="${FILL_H}" rx="${FILL_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${FILL_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(label)}</text>
</g>
<text class="m" x="${width - PAL_W - 6}" y="${mid + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${Math.round(planRatio(p) * 100)}%</text>
${pal(width - PAL_W + 2, 0, palOf({ type: '', description: p.title, model: '' }), planLook(p), BAR_HEIGHT / PAL_GRID.h, isWorking && !p.isFinished, true, true)}
</svg>`
}

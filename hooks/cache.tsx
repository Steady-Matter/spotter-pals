// The prompt cache's countdown, ticking on the surface's frame clock so it stays right while idle.
// `expiresAt` and `now` come from the hooks module's $.clock; the wording matches cacheLabel in core.ts.
import type { ClientModule } from 'claude-code'

type Props = { expiresAt: number; now: number; plain: string; soon: string; cold: string }
type Ref = { left: number; lastNow: number }
type State = { ref: Ref }

const Cache: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const ref = surface.state?.ref ?? { left: 0, lastNow: -1 }
  if (props.now !== ref.lastNow) {
    // A fresh reading from the hooks module: restart the local count from it.
    ref.lastNow = props.now
    ref.left = props.expiresAt - props.now
  }
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(15_000, () => {
      ref.left -= 15_000
      surface.setState({ ref })
    })
  }
  const min = Math.ceil(ref.left / 60_000)
  if (min <= 0) return <Text color={props.cold}>cold · next message re-reads it all</Text>
  return (
    <Text color={min <= 10 ? props.soon : props.plain} wrap="truncate">
      {`warm · ~${min} min left`}
    </Text>
  )
}

export default Cache

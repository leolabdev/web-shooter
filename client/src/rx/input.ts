import {
  combineLatest,
  distinctUntilChanged,
  filter,
  fromEvent,
  map,
  merge,
  type Observable,
  sampleTime,
  scan,
  startWith,
  timestamp,
} from 'rxjs'
import { ARENA, type ClientToServerEvents, type Keys, type Vec2 } from '@shared/protocol'

const initialKeys: Keys = { up: false, down: false, left: false, right: false }

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const mapAimToArena = (event: MouseEvent, canvas: HTMLCanvasElement): Vec2 => {
  const rect = canvas.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * ARENA.w
  const y = ((event.clientY - rect.top) / rect.height) * ARENA.h
  return { x: clamp(x, 0, ARENA.w), y: clamp(y, 0, ARENA.h) }
}

export const createInputPackets = (
  canvas: HTMLCanvasElement,
  options?: {
    isChatActive?: () => boolean
    resetKeys$?: Observable<void>
    isShootEnabled?: () => boolean
  },
) => {
  const reset$ = options?.resetKeys$?.pipe(map(() => ({ type: 'reset' as const })))

  const keyEvents$ = merge(
    fromEvent<KeyboardEvent>(window, 'keydown').pipe(map((event) => ({ event, down: true }))),
    fromEvent<KeyboardEvent>(window, 'keyup').pipe(map((event) => ({ event, down: false }))),
  ).pipe(filter(({ event }) => ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)))

  const keyActions$ = merge(
    keyEvents$.pipe(
      map(({ event, down }) => ({
        type: 'key' as const,
        code: event.code,
        down,
        repeat: event.repeat,
      })),
    ),
    reset$ ?? [],
  )

  const keys$ = keyActions$.pipe(
    scan((keys, action) => {
      if (action.type === 'reset') return initialKeys
      if (action.repeat && action.down) return keys
      const next = { ...keys }
      if (action.code === 'KeyW') next.up = action.down
      if (action.code === 'KeyS') next.down = action.down
      if (action.code === 'KeyA') next.left = action.down
      if (action.code === 'KeyD') next.right = action.down
      return next
    }, initialKeys),
    startWith(initialKeys),
    distinctUntilChanged(
      (prev, next) =>
        prev.up === next.up &&
        prev.down === next.down &&
        prev.left === next.left &&
        prev.right === next.right,
    ),
  )

  const aim$ = fromEvent<MouseEvent>(canvas, 'mousemove').pipe(
    map((event) => mapAimToArena(event, canvas)),
    startWith({ x: ARENA.w / 2, y: ARENA.h / 2 }),
    distinctUntilChanged((a, b) => a.x === b.x && a.y === b.y),
  )

  const shoot$ = merge(
    fromEvent<MouseEvent>(canvas, 'mousedown').pipe(map(() => true)),
    fromEvent<MouseEvent>(window, 'mouseup').pipe(map(() => false)),
  ).pipe(startWith(false), distinctUntilChanged())

  const item$ = fromEvent<KeyboardEvent>(window, 'keydown').pipe(
    filter((event) => (event.code === 'KeyQ' || event.key === 'q') && !event.repeat),
    map(() => 1),
    scan((count, inc) => count + inc, 0),
    startWith(0),
  )

  const combined$ = combineLatest({ keys: keys$, aim: aim$, shoot: shoot$, itemCount: item$ })

  return combined$.pipe(
    sampleTime(50),
    timestamp(),
    scan(
      (acc, sample) => {
        const dt = acc.lastTs === 0 ? 50 : sample.timestamp - acc.lastTs
        const useItem = sample.value.itemCount !== acc.lastItemCount
        const chatActive = options?.isChatActive?.() ?? false
        const shootEnabled = options?.isShootEnabled?.() ?? true
        const packet: Parameters<ClientToServerEvents['player:input']>[0] = {
          seq: acc.seq + 1,
          dt,
          keys: chatActive ? initialKeys : sample.value.keys,
          aim: sample.value.aim,
          shoot: chatActive || !shootEnabled ? false : sample.value.shoot,
          useItem: chatActive ? false : useItem,
        }
        return {
          seq: acc.seq + 1,
          lastTs: sample.timestamp,
          lastItemCount: sample.value.itemCount,
          packet,
        }
      },
      {
        seq: 0,
        lastTs: 0,
        lastItemCount: 0,
        packet: null as Parameters<ClientToServerEvents['player:input']>[0] | null,
      },
    ),
    map((state) => state.packet),
    filter(
      (packet): packet is Parameters<ClientToServerEvents['player:input']>[0] => packet !== null,
    ),
  )
}

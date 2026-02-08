import { useEffect, useRef, useState } from 'react'
import {
  animationFrames,
  filter,
  interval,
  map,
  shareReplay,
  Subject,
  Subscription,
  withLatestFrom,
} from 'rxjs'
import { ARENA, type ChatMessage, type MatchState, type StateSnapshot } from '@shared/protocol'
import './App.css'
import { connectSocket } from './net/socket'
import { createInputPackets } from './rx/input'
import { createSnapshotInterpolator } from './rx/interpolation'
import { renderSnapshot, type BeamFx, type NovaFx } from './render/canvasRenderer'
import { colorFromId } from './render/colors'
import { updateFxRegistry, type FxState } from './render/fx'

function App() {
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [roomInfo, setRoomInfo] = useState<{ roomId: string; playerId: string } | null>(null)
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null)
  const [pingMs, setPingMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rooms, setRooms] = useState<
    { roomId: string; playerCount: number; maxPlayers: number; isPrivate: boolean }[]
  >([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatOpen, setChatOpen] = useState(false)
  const [chatText, setChatText] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [durationSec, setDurationSec] = useState(300)
  const [maxPlayers, setMaxPlayers] = useState(6)
  const [isPrivate, setIsPrivate] = useState(false)
  const [connection, setConnection] = useState<ReturnType<typeof connectSocket> | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fxRef = useRef<Map<string, FxState>>(new Map())
  const interpolatorRef = useRef(createSnapshotInterpolator())
  const chatInputRef = useRef<HTMLInputElement | null>(null)
  const chatOpenRef = useRef(false)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const resetKeysRef = useRef(new Subject<void>())
  const beamsRef = useRef<BeamFx[]>([])
  const novasRef = useRef<NovaFx[]>([])

  useEffect(() => {
    const conn = connectSocket()
    setConnection(conn)
    return () => {
      conn.socket.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!connection) return
    const subs = new Subscription()

    subs.add(
      connection.wsIn$.subscribe((event) => {
        if (event.type === 'room:created' || event.type === 'room:joined') {
          setRoomInfo({ roomId: event.payload.roomId, playerId: event.payload.playerId })
          setRoomId(event.payload.roomId)
          setError(null)
          setChatMessages([])
        } else if (event.type === 'rooms:list') {
          setRooms(event.payload.rooms)
        } else if (event.type === 'error') {
          setError(event.payload.message)
        } else if (event.type === 'net:pong') {
          setPingMs(Date.now() - event.payload.t)
        } else if (event.type === 'chat:history') {
          setChatMessages(event.payload.messages.slice(-200))
        } else if (event.type === 'chat:message') {
          setChatMessages((prev) => [...prev, event.payload].slice(-200))
        } else if (event.type === 'match:toast') {
          setToast(event.payload.message)
        }
      }),
    )

    subs.add(interval(1000).subscribe(() => connection.send.ping({ t: Date.now() })))

    return () => subs.unsubscribe()
  }, [connection])

  useEffect(() => {
    if (!connection || !roomInfo) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const state$ = connection.wsIn$.pipe(
      filter((event) => event.type === 'game:state'),
      map((event) => event.payload),
      shareReplay({ bufferSize: 1, refCount: true }),
    )

    const subs = new Subscription()
    subs.add(
      state$.subscribe((nextSnapshot) => {
        updateFxRegistry(nextSnapshot, fxRef.current, performance.now())
        const now = performance.now()
        nextSnapshot.events.forEach((event) => {
          if (event.type === 'beam_fire') {
            beamsRef.current.push({
              from: event.from,
              to: event.to,
              until: now + 120,
            })
          } else if (event.type === 'nova_fire') {
            const player = nextSnapshot.players.find((entry) => entry.id === event.byId)
            if (player) {
              novasRef.current.push({ x: player.x, y: player.y, until: now + 120 })
            }
          }
        })
        interpolatorRef.current.pushSnapshot(nextSnapshot, performance.now())
        setSnapshot(nextSnapshot)
      }),
    )
    subs.add(
      createInputPackets(canvas, {
        isChatActive: () => chatOpenRef.current,
        resetKeys$: resetKeysRef.current,
      }).subscribe((packet) => connection.send.input(packet)),
    )
    subs.add(
      animationFrames()
        .pipe(withLatestFrom(state$))
        .subscribe(([frame, latest]) => {
          const renderState = interpolatorRef.current.getInterpolatedState(frame.timestamp)
          beamsRef.current = beamsRef.current.filter((beam) => beam.until > frame.timestamp)
          novasRef.current = novasRef.current.filter((nova) => nova.until > frame.timestamp)
          if (renderState) {
            renderSnapshot(
              ctx,
              renderState,
              fxRef.current,
              frame.timestamp,
              beamsRef.current,
              novasRef.current,
            )
          } else {
            renderSnapshot(
              ctx,
              latest,
              fxRef.current,
              frame.timestamp,
              beamsRef.current,
              novasRef.current,
            )
          }
        }),
    )

    return () => subs.unsubscribe()
  }, [connection, roomInfo])

  const canCreate = name.trim().length > 0
  const canJoin = canCreate && roomId.trim().length > 0

  const localPlayer = snapshot?.players.find((player) => player.id === roomInfo?.playerId)
  const realPlayers = snapshot?.players.filter((player) => !player.isEcho) ?? []
  const hasActiveEcho = (playerId: string) =>
    snapshot?.players.some((player) => player.isEcho && player.ownerId === playerId) ?? false
  const heldItem = localPlayer?.heldItem ?? null
  const shieldHp = localPlayer?.shieldHp ?? 0
  const match: MatchState | null = snapshot?.match ?? null
  const isHost = match?.hostId === roomInfo?.playerId
  const hostName =
    snapshot?.players.find((player) => player.id === match?.hostId)?.name ?? 'Unknown'
  const timeLeftSec = match?.endsAtMs
    ? Math.max(0, Math.ceil((match.endsAtMs - Date.now()) / 1000))
    : null

  const openChat = () => {
    chatOpenRef.current = true
    setChatOpen(true)
  }

  const closeChat = () => {
    chatOpenRef.current = false
    setChatOpen(false)
    setChatText('')
    resetKeysRef.current.next()
    canvasRef.current?.focus()
  }

  useEffect(() => {
    chatOpenRef.current = chatOpen
    if (chatOpen) {
      chatInputRef.current?.focus()
    } else {
      resetKeysRef.current.next()
      canvasRef.current?.focus()
    }
  }, [chatOpen])

  useEffect(() => {
    const container = chatScrollRef.current
    if (!container) return
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40
    if (isNearBottom) {
      container.scrollTop = container.scrollHeight
    }
  }, [chatMessages.length])

  useEffect(() => {
    if (!match) return
    setDurationSec(match.durationSec)
  }, [match?.durationSec])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2500)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!roomInfo) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Enter' && !chatOpenRef.current) {
        event.preventDefault()
        openChat()
      } else if (event.code === 'Escape' && chatOpenRef.current) {
        event.preventDefault()
        closeChat()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [roomInfo])

  const submitChat = () => {
    const text = chatText.trim()
    if (!text || !connection) return
    connection.send.chatSend({ text })
    setChatText('')
    closeChat()
  }

  const handleDurationChange = (value: number) => {
    setDurationSec(value)
    if (!connection) return
    connection.send.configureMatch({ durationSec: value })
  }

  return (
    <div className="app">
      {!roomInfo ? (
        <section className="lobby">
          <div className="lobby-header">
            <p className="kicker">Multiverse Arena</p>
            <h1>Portal Echo Skirmish</h1>
            <p className="subtle">Create a room or join a squad by room id.</p>
          </div>

          <div className="lobby-form">
            <label className="field">
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Pilot name"
              />
            </label>
            <label className="field">
              <span>Room</span>
              <input
                value={roomId}
                onChange={(event) => setRoomId(event.target.value.toUpperCase())}
                placeholder="ABCD"
              />
            </label>
            <label className="field">
              <span>Max players</span>
              <select
                value={maxPlayers}
                onChange={(event) => setMaxPlayers(Number(event.target.value))}
              >
                {Array.from({ length: 11 }, (_, index) => index + 2).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="field checkbox">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(event) => setIsPrivate(event.target.checked)}
              />
              <span>Private room</span>
            </label>
          </div>

          <div className="lobby-actions">
            <button
              className="primary"
              disabled={!canCreate || !connection}
              onClick={() =>
                connection?.send.createRoom({
                  name: name.trim(),
                  maxPlayers,
                  isPrivate,
                })
              }
            >
              Create Room
            </button>
            <button
              className="ghost"
              disabled={!canJoin || !connection}
              onClick={() =>
                connection?.send.joinRoom({ roomId: roomId.trim(), name: name.trim() })
              }
            >
              Join Room
            </button>
          </div>

          <div className="room-list">
            <div className="room-list-header">
              <h2>Active Rooms</h2>
              <span className="subtle">{rooms.length} live</span>
            </div>
            {rooms.length === 0 ? (
              <p className="subtle">No rooms yet. Create one to start the match.</p>
            ) : (
              <div className="room-list-body">
                {rooms.map((room) => (
                  <div key={room.roomId} className="room-row">
                    <div>
                      <p className="room-id">{room.roomId}</p>
                      <p className="room-meta">
                        {room.playerCount}/{room.maxPlayers} pilots
                      </p>
                    </div>
                    <button
                      className="ghost"
                      disabled={!canCreate || !connection || room.playerCount >= room.maxPlayers}
                      onClick={() =>
                        connection?.send.joinRoom({ roomId: room.roomId, name: name.trim() })
                      }
                    >
                      Join
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error ? <p className="error">{error}</p> : null}
        </section>
      ) : (
        <section className="game">
          <header className="hud">
            <div>
              <p className="hud-label">Room</p>
              <p className="hud-value">{roomInfo.roomId}</p>
            </div>
            <div>
              <p className="hud-label">Ping</p>
              <p className="hud-value">{pingMs !== null ? `${pingMs}ms` : '...'}</p>
            </div>
            <div>
              <p className="hud-label">HP</p>
              <p className="hud-value">{localPlayer ? localPlayer.hp : '...'}</p>
            </div>
            <div>
              <p className="hud-label">Status</p>
              <p className="hud-value">{localPlayer?.alive ? 'Alive' : 'Down'}</p>
            </div>
            <div>
              <p className="hud-label">Held Item</p>
              <p className="hud-value">{heldItem ?? 'None'}</p>
            </div>
            <div>
              <p className="hud-label">Shield</p>
              <p className="hud-value">{shieldHp > 0 ? `${shieldHp} HP` : 'None'}</p>
            </div>
            <div>
              <p className="hud-label">Ability</p>
              <p className="hud-value">Press Q to use</p>
            </div>
            <div>
              <p className="hud-label">Phase</p>
              <p className="hud-value">{match?.phase ?? '...'}</p>
            </div>
            <div>
              <p className="hud-label">Host</p>
              <p className="hud-value">{hostName}</p>
            </div>
            <div>
              <p className="hud-label">Timer</p>
              <p className="hud-value">
                {match?.phase === 'playing'
                  ? `${timeLeftSec ?? 0}s`
                  : `${durationSec}s`}
              </p>
            </div>
          </header>

          <div className="game-main">
            <div className="canvas-shell">
              <canvas ref={canvasRef} width={ARENA.w} height={ARENA.h} tabIndex={0} />
            </div>
          </div>

          <aside className="scoreboard-panel">
            {isHost || match?.phase === 'lobby' ? (
              <div className="match-controls">
                {isHost ? (
                  <>
                    <label className="match-field">
                      <span>Duration</span>
                      <select
                        value={durationSec}
                        onChange={(event) => handleDurationChange(Number(event.target.value))}
                        disabled={match?.phase !== 'lobby'}
                      >
                        {Array.from({ length: 15 }, (_, index) => (index + 1) * 60).map((value) => (
                          <option key={value} value={value}>
                            {value}s
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="match-buttons">
                      {match?.phase === 'lobby' ? (
                        <button
                          className="primary"
                          type="button"
                          onClick={() => connection?.send.startMatch()}
                        >
                          Start
                        </button>
                      ) : (
                        <button
                          className="ghost"
                          type="button"
                          onClick={() => connection?.send.restartMatch()}
                        >
                          Restart
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="subtle">Waiting for host…</p>
                )}
              </div>
            ) : null}
            <div className="scoreboard">
              <div className="scoreboard-header">
                <h2>Scoreboard</h2>
                <span className="subtle">{realPlayers.length} pilots</span>
              </div>
              <div className="score-list">
                {realPlayers.map((player) => (
                  <div key={player.id} className="score-row">
                    <div className="score-name">
                      <span className={player.id === roomInfo.playerId ? 'you-tag' : undefined}>
                        {player.name}
                        {hasActiveEcho(player.id) ? ' (Echo)' : ''}
                      </span>
                    </div>
                    <div className="score-kd">
                      {player.kills}/{player.deaths}
                      <span className="score-hp">HP {player.hp}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="chat-panel">
              <div className="chat-messages" ref={chatScrollRef}>
                {chatMessages.map((message) => (
                  <div key={message.id} className="chat-line">
                    <span
                      className="chat-name"
                      style={{ color: colorFromId(message.fromId) }}
                    >
                      {message.fromName}
                    </span>
                    <span className="chat-sep">:</span>
                    <span className="chat-text">{message.text}</span>
                  </div>
                ))}
              </div>
              <div className="chat-input">
                {chatOpen ? (
                  <input
                    ref={chatInputRef}
                    value={chatText}
                    onChange={(event) => setChatText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.code === 'Enter') {
                        event.preventDefault()
                        submitChat()
                      } else if (event.code === 'Escape') {
                        event.preventDefault()
                        closeChat()
                      }
                    }}
                    onBlur={() => closeChat()}
                    placeholder="Type message..."
                  />
                ) : (
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => openChat()}
                  >
                    Press Enter to chat
                  </button>
                )}
              </div>
            </div>
          </aside>

          {toast ? <div className="toast">{toast}</div> : null}
        </section>
      )}
    </div>
  )
}

export default App

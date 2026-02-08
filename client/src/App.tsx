import { useEffect, useRef, useState } from 'react'
import {
  animationFrames,
  filter,
  interval,
  map,
  shareReplay,
  Subscription,
  withLatestFrom,
} from 'rxjs'
import { ARENA, type StateSnapshot } from '@shared/protocol'
import './App.css'
import { connectSocket } from './net/socket'
import { createInputPackets } from './rx/input'
import { renderSnapshot } from './render/canvasRenderer'

function App() {
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [roomInfo, setRoomInfo] = useState<{ roomId: string; playerId: string } | null>(null)
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null)
  const [pingMs, setPingMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rooms, setRooms] = useState<{ roomId: string; playerCount: number }[]>([])
  const [connection, setConnection] = useState<ReturnType<typeof connectSocket> | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

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
        } else if (event.type === 'rooms:list') {
          setRooms(event.payload.rooms)
        } else if (event.type === 'error') {
          setError(event.payload.message)
        } else if (event.type === 'net:pong') {
          setPingMs(Date.now() - event.payload.t)
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
    subs.add(state$.subscribe(setSnapshot))
    subs.add(createInputPackets(canvas).subscribe((packet) => connection.send.input(packet)))
    subs.add(
      animationFrames()
        .pipe(withLatestFrom(state$))
        .subscribe(([, latest]) => {
          renderSnapshot(ctx, latest)
        }),
    )

    return () => subs.unsubscribe()
  }, [connection, roomInfo])

  const canCreate = name.trim().length > 0
  const canJoin = canCreate && roomId.trim().length > 0

  const localPlayer = snapshot?.players.find((player) => player.id === roomInfo?.playerId)

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
          </div>

          <div className="lobby-actions">
            <button
              className="primary"
              disabled={!canCreate || !connection}
              onClick={() => connection?.send.createRoom({ name: name.trim() })}
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
                      <p className="room-meta">{room.playerCount} pilots</p>
                    </div>
                    <button
                      className="ghost"
                      disabled={!canCreate || !connection}
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
              <p className="hud-label">You</p>
              <p className="hud-value">{roomInfo.playerId}</p>
            </div>
            <div>
              <p className="hud-label">Ping</p>
              <p className="hud-value">{pingMs !== null ? `${pingMs}ms` : '...'}</p>
            </div>
            <div>
              <p className="hud-label">Echo Cooldown</p>
              <p className="hud-value">
                {localPlayer?.echoCdMs ? `${Math.ceil(localPlayer.echoCdMs)}ms` : 'Ready'}
              </p>
            </div>
          </header>

          <div className="canvas-shell">
            <canvas ref={canvasRef} width={ARENA.w} height={ARENA.h} />
          </div>

          <aside className="scoreboard">
            <div className="scoreboard-header">
              <h2>Scoreboard</h2>
              <span className="subtle">{snapshot ? snapshot.players.length : 0} pilots</span>
            </div>
            <div className="score-list">
              {snapshot?.players.map((player) => (
                <div key={player.id} className="score-row">
                  <div className="score-name">
                    <span className={player.id === roomInfo.playerId ? 'you-tag' : undefined}>
                      {player.name}
                    </span>
                  </div>
                  <div className="score-kd">
                    {player.kills}/{player.deaths}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </section>
      )}
    </div>
  )
}

export default App

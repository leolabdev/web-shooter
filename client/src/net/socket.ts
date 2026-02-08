import { io, type Socket } from 'socket.io-client'
import { Observable, share } from 'rxjs'
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/protocol'

type RoomCreatedPayload = Parameters<ServerToClientEvents['room:created']>[0]
type RoomJoinedPayload = Parameters<ServerToClientEvents['room:joined']>[0]
type RoomsListPayload = Parameters<ServerToClientEvents['rooms:list']>[0]
type ChatMessagePayload = Parameters<ServerToClientEvents['chat:message']>[0]
type ChatHistoryPayload = Parameters<ServerToClientEvents['chat:history']>[0]
type MatchToastPayload = Parameters<ServerToClientEvents['match:toast']>[0]
type GameStatePayload = Parameters<ServerToClientEvents['game:state']>[0]
type ErrorPayload = Parameters<ServerToClientEvents['error']>[0]
type PongPayload = Parameters<ServerToClientEvents['net:pong']>[0]

export type WsInEvent =
  | { type: 'room:created'; payload: RoomCreatedPayload }
  | { type: 'room:joined'; payload: RoomJoinedPayload }
  | { type: 'rooms:list'; payload: RoomsListPayload }
  | { type: 'chat:message'; payload: ChatMessagePayload }
  | { type: 'chat:history'; payload: ChatHistoryPayload }
  | { type: 'match:toast'; payload: MatchToastPayload }
  | { type: 'game:state'; payload: GameStatePayload }
  | { type: 'error'; payload: ErrorPayload }
  | { type: 'net:pong'; payload: PongPayload }

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export const connectSocket = () => {
  const socket: ClientSocket = io('http://localhost:8080')

  const wsIn$ = new Observable<WsInEvent>((subscriber) => {
    const onRoomCreated = (payload: RoomCreatedPayload) =>
      subscriber.next({ type: 'room:created', payload })
    const onRoomJoined = (payload: RoomJoinedPayload) =>
      subscriber.next({ type: 'room:joined', payload })
    const onRoomsList = (payload: RoomsListPayload) =>
      subscriber.next({ type: 'rooms:list', payload })
    const onChatMessage = (payload: ChatMessagePayload) =>
      subscriber.next({ type: 'chat:message', payload })
    const onChatHistory = (payload: ChatHistoryPayload) =>
      subscriber.next({ type: 'chat:history', payload })
    const onMatchToast = (payload: MatchToastPayload) =>
      subscriber.next({ type: 'match:toast', payload })
    const onGameState = (payload: GameStatePayload) =>
      subscriber.next({ type: 'game:state', payload })
    const onError = (payload: ErrorPayload) => subscriber.next({ type: 'error', payload })
    const onPong = (payload: PongPayload) => subscriber.next({ type: 'net:pong', payload })

    socket.on('room:created', onRoomCreated)
    socket.on('room:joined', onRoomJoined)
    socket.on('rooms:list', onRoomsList)
    socket.on('chat:message', onChatMessage)
    socket.on('chat:history', onChatHistory)
    socket.on('match:toast', onMatchToast)
    socket.on('game:state', onGameState)
    socket.on('error', onError)
    socket.on('net:pong', onPong)

    return () => {
      socket.off('room:created', onRoomCreated)
      socket.off('room:joined', onRoomJoined)
      socket.off('rooms:list', onRoomsList)
      socket.off('chat:message', onChatMessage)
      socket.off('chat:history', onChatHistory)
      socket.off('match:toast', onMatchToast)
      socket.off('game:state', onGameState)
      socket.off('error', onError)
      socket.off('net:pong', onPong)
    }
  }).pipe(share())

  const send = {
    createRoom: (payload: Parameters<ClientToServerEvents['room:create']>[0]) =>
      socket.emit('room:create', payload),
    joinRoom: (payload: Parameters<ClientToServerEvents['room:join']>[0]) =>
      socket.emit('room:join', payload),
    input: (payload: Parameters<ClientToServerEvents['player:input']>[0]) =>
      socket.emit('player:input', payload),
    chatSend: (payload: Parameters<ClientToServerEvents['chat:send']>[0]) =>
      socket.emit('chat:send', payload),
    strikeConfirm: (payload: Parameters<ClientToServerEvents['strike:confirm']>[0]) =>
      socket.emit('strike:confirm', payload),
    portalPlaceB: (payload: Parameters<ClientToServerEvents['portal:placeB']>[0]) =>
      socket.emit('portal:placeB', payload),
    configureMatch: (payload: Parameters<ClientToServerEvents['match:configure']>[0]) =>
      socket.emit('match:configure', payload),
    startMatch: () => socket.emit('match:start'),
    restartMatch: () => socket.emit('match:restart'),
    ping: (payload: Parameters<ClientToServerEvents['net:ping']>[0]) =>
      socket.emit('net:ping', payload),
  }

  return { socket, wsIn$, send }
}

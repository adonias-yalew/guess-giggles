import { createFileRoute, useNavigate, useParams, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, getDisplayName } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft, Check, Copy, Crown, HelpCircle, Loader2, Send,
  Sparkles, Target, Trophy, X, CircleHelp, PartyPopper, Flag,
} from "lucide-react";

export const Route = createFileRoute("/room/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Room ${params.code} · Word Hunt` },
      { name: "description", content: "Play Word Hunt in real time with friends." },
    ],
  }),
  component: RoomPage,
});

type Room = {
  id: string;
  code: string;
  host_id: string;
  word_owner_id: string | null;
  secret_word: string | null;
  status: string; // 'waiting' | 'picking_word' | 'playing' | 'round_over' | 'finished'
  winner_id: string | null;
  winner_name: string | null;
  round_number: number;
  max_rounds: number;
  current_turn_user_id: string | null;
  round_winner_id: string | null;
  round_winner_name: string | null;
  round_started_at: string | null;
};
type Player = { id: string; user_id: string; display_name: string; score: number; joined_at?: string };
type Message = {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  kind: string;
  content: string;
  response: string | null;
  is_correct: boolean;
  created_at: string;
};

const MAX_QUESTIONS = 15;


function sortedPlayers(players: Player[]): Player[] {
  return players.slice().sort((a, b) => (a.joined_at ?? "").localeCompare(b.joined_at ?? ""));
}

function nextTurnUserId(players: Player[], ownerId: string | null, currentTurnId: string | null): string | null {
  const askers = sortedPlayers(players).filter((p) => p.user_id !== ownerId);
  if (askers.length === 0) return null;
  if (!currentTurnId) return askers[0].user_id;
  const idx = askers.findIndex((p) => p.user_id === currentTurnId);
  if (idx === -1) return askers[0].user_id;
  return askers[(idx + 1) % askers.length].user_id;
}

function RoomPage() {
  const { code } = useParams({ from: "/room/$code" });
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth" });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load() {
      const { data: r, error } = await supabase.from("rooms").select("*").eq("code", code).maybeSingle();
      if (cancelled) return;
      if (error) { toast.error(error.message); setLoading(false); return; }
      if (!r) { setNotFound(true); setLoading(false); return; }
      setRoom(r as Room);

      await supabase.from("room_players").upsert(
        { room_id: r.id, user_id: user!.id, display_name: getDisplayName(user) },
        { onConflict: "room_id,user_id" },
      );

      const [{ data: pls }, { data: msgs }] = await Promise.all([
        supabase.from("room_players").select("*").eq("room_id", r.id).order("joined_at"),
        supabase.from("room_messages").select("*").eq("room_id", r.id).order("created_at"),
      ]);
      if (cancelled) return;
      setPlayers((pls ?? []) as Player[]);
      setMessages((msgs ?? []) as Message[]);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [code, user]);

  useEffect(() => {
    if (!room) return;
    const channel = supabase
      .channel(`room-${room.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") { toast.message("Room was closed"); navigate({ to: "/" }); }
          else setRoom(payload.new as Room);
        })
      .on("postgres_changes", { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") setPlayers((p) => [...p, payload.new as Player]);
          else if (payload.eventType === "DELETE") setPlayers((p) => p.filter((x) => x.id !== (payload.old as Player).id));
          else if (payload.eventType === "UPDATE") setPlayers((p) => p.map((x) => x.id === (payload.new as Player).id ? payload.new as Player : x));
        })
      .on("postgres_changes", { event: "*", schema: "public", table: "room_messages", filter: `room_id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") setMessages((m) => [...m, payload.new as Message]);
          else if (payload.eventType === "UPDATE") setMessages((m) => m.map((x) => x.id === (payload.new as Message).id ? payload.new as Message : x));
          else if (payload.eventType === "DELETE") setMessages((m) => m.filter((x) => x.id !== (payload.old as Message).id));
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [room?.id, navigate]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  if (authLoading || loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="size-8 animate-spin text-primary" /></div>;
  }
  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-8 text-center max-w-sm">
          <h2 className="font-display text-2xl font-bold mb-2">Room not found</h2>
          <p className="text-muted-foreground mb-4">No room exists with code <strong>{code}</strong>.</p>
          <Link to="/"><Button>Back home</Button></Link>
        </Card>
      </div>
    );
  }
  if (!room || !user) return null;

  const isHost = room.host_id === user.id;
  const isOwner = room.word_owner_id === user.id;
  const isMyTurn = room.current_turn_user_id === user.id;
  const ownerName = players.find((p) => p.user_id === room.word_owner_id)?.display_name;
  const turnName = players.find((p) => p.user_id === room.current_turn_user_id)?.display_name;

  // Count questions asked during the current round
  const roundQuestionCount = room.round_started_at
    ? messages.filter((m) => m.kind === "question" && m.created_at >= room.round_started_at!).length
    : 0;

  return (
    <div className="min-h-screen p-3 md:p-6">
      <div className="max-w-6xl mx-auto">
        <Header room={room} />
        <div className="grid lg:grid-cols-[260px_1fr] gap-4">
          <PlayerList players={players} room={room} meId={user.id} />
          <div className="space-y-4">
            <GameState
              room={room} players={players} messages={messages} isHost={isHost} isOwner={isOwner}
              ownerName={ownerName} turnName={turnName} isMyTurn={isMyTurn}
              meId={user.id} meName={getDisplayName(user)}
              roundQuestionCount={roundQuestionCount}
            />
            {(room.status === "playing" || room.status === "round_over") && (
              <Chat
                messages={messages} meId={user.id} meName={getDisplayName(user)}
                room={room} players={players} isOwner={isOwner} isMyTurn={isMyTurn}
                chatRef={chatRef} roundQuestionCount={roundQuestionCount}
              />
            )}
          </div>
        </div>
      </div>
      {room.status === "finished" && <FinalResults room={room} players={players} isHost={isHost} />}
    </div>
  );
}

function Header({ room }: { room: Room }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(room.code);
    setCopied(true);
    toast.success("Code copied");
    setTimeout(() => setCopied(false), 1500);
  }
  function share() {
    navigator.clipboard.writeText(`${window.location.origin}/room/${room.code}`);
    toast.success("Invite link copied");
  }
  const showRound = room.status !== "waiting" && room.max_rounds > 0;
  return (
    <header className="flex flex-wrap items-center gap-3 mb-4">
      <Link to="/"><Button variant="ghost" size="sm"><ArrowLeft className="size-4" /></Button></Link>
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-primary" />
        <span className="font-display text-lg font-bold">Word Hunt</span>
      </div>
      {showRound && (
        <Badge variant="secondary" className="ml-1">
          Round {Math.min(room.round_number, room.max_rounds)} / {room.max_rounds}
        </Badge>
      )}
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <div className="font-mono font-bold tracking-widest text-lg bg-card px-3 py-1.5 rounded-lg border-2">{room.code}</div>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <Button size="sm" variant="secondary" onClick={share} className="hidden sm:inline-flex">Share link</Button>
      </div>
    </header>
  );
}

function PlayerList({ players, room, meId }: { players: Player[]; room: Room; meId: string }) {
  const sorted = players.slice().sort((a, b) => b.score - a.score || a.display_name.localeCompare(b.display_name));
  return (
    <Card className="p-4 h-fit">
      <h3 className="font-display font-bold text-sm uppercase tracking-wider text-muted-foreground mb-3">
        Players ({players.length})
      </h3>
      <ul className="space-y-2">
        {sorted.map((p) => {
          const isHost = p.user_id === room.host_id;
          const isOwner = p.user_id === room.word_owner_id;
          const isMe = p.user_id === meId;
          const isTurn = p.user_id === room.current_turn_user_id && room.status === "playing";
          return (
            <li key={p.id} className={`flex items-center gap-2 text-sm rounded-md px-1.5 py-1 ${isTurn ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}>
              <div className="size-8 rounded-full bg-gradient-to-br from-primary/30 to-accent/40 flex items-center justify-center font-bold text-xs">
                {p.display_name.slice(0, 2).toUpperCase()}
              </div>
              <span className="font-medium truncate flex-1">
                {p.display_name}{isMe && <span className="text-muted-foreground"> (you)</span>}
              </span>
              <span className="font-mono font-bold text-sm tabular-nums">{p.score}</span>
              {isOwner && <Badge variant="default" className="text-[10px] px-1.5 py-0">Master</Badge>}
              {isHost && !isOwner && <Crown className="size-4 text-warning" />}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function GameState({
  room, players, messages, isHost, isOwner, ownerName, turnName, isMyTurn, meId, meName, roundQuestionCount,
}: {
  room: Room; players: Player[]; messages: Message[]; isHost: boolean; isOwner: boolean;
  ownerName?: string; turnName?: string; isMyTurn: boolean; meId: string; meName: string;
  roundQuestionCount: number;
}) {
  const [word, setWord] = useState("");

  // ---- WAITING (pre-match): host starts the match. Rounds = number of players.
  async function startMatch() {
    if (players.length < 2) return toast.error("Need at least 2 players");
    const ordered = sortedPlayers(players);
    const firstMaster = ordered[0];
    const { error } = await supabase.from("rooms").update({
      status: "picking_word",
      round_number: 1,
      max_rounds: players.length,
      word_owner_id: firstMaster.user_id,
      secret_word: null,
      current_turn_user_id: null,
      round_winner_id: null,
      round_winner_name: null,
      round_started_at: null,
      winner_id: null,
      winner_name: null,
    }).eq("id", room.id);
    if (error) return toast.error(error.message);
    await supabase.from("room_messages").insert({
      room_id: room.id, user_id: meId, display_name: meName, kind: "system",
      content: `Match started — ${players.length} rounds. ${firstMaster.display_name} is the first Word Master.`,
    });
  }

  // ---- PICKING_WORD: only the word master submits the secret
  async function submitWord(e: React.FormEvent) {
    e.preventDefault();
    const w = word.trim();
    if (!w) return toast.error("Enter a word");
    const firstTurn = nextTurnUserId(players, room.word_owner_id, null);
    const { error } = await supabase.from("rooms").update({
      secret_word: w.toLowerCase(),
      status: "playing",
      current_turn_user_id: firstTurn,
      round_started_at: new Date().toISOString(),
    }).eq("id", room.id);
    if (error) return toast.error(error.message);
    await supabase.from("room_messages").insert({
      room_id: room.id, user_id: meId, display_name: meName, kind: "system",
      content: `Round ${room.round_number} — ${meName} picked a secret word.`,
    });
    setWord("");
  }

  // ---- PLAYING: word master gives up (nobody guessed) → +10 bonus
  async function giveUp() {
    const owner = players.find((p) => p.user_id === room.word_owner_id);
    if (!owner) return;
    await supabase.from("room_players").update({ score: owner.score + 10 }).eq("id", owner.id);
    await supabase.from("rooms").update({
      status: "round_over",
      round_winner_id: null,
      round_winner_name: null,
    }).eq("id", room.id);
    await supabase.from("room_messages").insert({
      room_id: room.id, user_id: meId, display_name: meName, kind: "system",
      content: `🛡️ Nobody guessed it! ${owner.display_name} earns 10 bonus points. The word was "${room.secret_word}".`,
    });
  }

  // ---- ROUND_OVER: advance to next round, or finish the match
  async function nextRound() {
    const nextNum = room.round_number + 1;
    if (nextNum > room.max_rounds) return finishMatch();
    const ordered = sortedPlayers(players);
    const nextMaster = ordered[nextNum - 1];
    if (!nextMaster) return finishMatch();
    const { error } = await supabase.from("rooms").update({
      status: "picking_word",
      round_number: nextNum,
      word_owner_id: nextMaster.user_id,
      secret_word: null,
      current_turn_user_id: null,
      round_winner_id: null,
      round_winner_name: null,
      round_started_at: null,
    }).eq("id", room.id);
    if (error) return toast.error(error.message);
    await supabase.from("room_messages").insert({
      room_id: room.id, user_id: meId, display_name: meName, kind: "system",
      content: `Round ${nextNum} — ${nextMaster.display_name} is now the Word Master.`,
    });
  }

  async function finishMatch() {
    const ranked = rankPlayers(players);
    const top = ranked[0];
    const { error } = await supabase.from("rooms").update({
      status: "finished",
      winner_id: top?.user_id ?? null,
      winner_name: top?.display_name ?? null,
    }).eq("id", room.id);
    if (error) return toast.error(error.message);
  }

  // -----------------------------------------------------------

  if (room.status === "waiting") {
    return (
      <Card className="p-6">
        <h3 className="font-display font-bold text-lg mb-1">Lobby</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Each player will be Word Master once — the match will have <strong>{Math.max(players.length, 2)}</strong> {players.length === 1 ? "round" : "rounds"}.
        </p>
        {isHost ? (
          <Button onClick={startMatch} className="w-full" size="lg" disabled={players.length < 2}>
            <Target className="size-4 mr-2" />
            {players.length < 2 ? "Need at least 2 players" : `Start match (${players.length} rounds)`}
          </Button>
        ) : (
          <div className="text-center py-3">
            <CircleHelp className="size-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Waiting for the host to start the match…</p>
          </div>
        )}
      </Card>
    );
  }

  if (room.status === "picking_word") {
    return (
      <>
        <Card className="p-6 text-center">
          <CircleHelp className="size-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Round {room.round_number} of {room.max_rounds}
          </p>
          <h3 className="font-display font-bold text-lg">
            {isOwner ? "Your turn to pick a secret word" : `${ownerName ?? "Someone"} is picking a word…`}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            The round starts once the Word Master locks in a word.
          </p>
        </Card>
        <div className="fixed inset-0 bg-background/85 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
          <Card className="max-w-md w-full p-8 border-2 border-primary shadow-2xl">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold text-center">
              Round {room.round_number} of {room.max_rounds}
            </p>
            {isOwner ? (
              <>
                <h3 className="font-display text-2xl font-bold mb-1 text-center">You're the Word Master 🎯</h3>
                <p className="text-sm text-muted-foreground mb-4 text-center">
                  Pick a secret word. Others will have up to {MAX_QUESTIONS} questions to guess it.
                </p>
                <form onSubmit={submitWord} className="space-y-3">
                  <Input
                    value={word}
                    onChange={(e) => setWord(e.target.value)}
                    placeholder="e.g. elephant"
                    maxLength={40}
                    autoFocus
                  />
                  <Button type="submit" className="w-full" size="lg">
                    <Target className="size-4 mr-2" /> Lock in word & start round
                  </Button>
                </form>
              </>
            ) : (
              <div className="text-center py-2">
                <Loader2 className="size-10 mx-auto text-primary animate-spin mb-3" />
                <h3 className="font-display text-xl font-bold mb-1">
                  {ownerName ?? "The Word Master"} is choosing a word…
                </h3>
                <p className="text-sm text-muted-foreground">
                  The round will start as soon as they lock it in.
                </p>
              </div>
            )}
          </Card>
        </div>
      </>
    );
  }


  if (room.status === "playing") {
    return (
      <Card className="p-5 bg-gradient-to-br from-primary/5 to-accent/10 border-primary/20">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Round {room.round_number} of {room.max_rounds}
            </p>
            <h3 className="font-display font-bold text-lg">
              {isOwner
                ? <>You hold the word{room.secret_word && <>: <span className="text-primary">{room.secret_word}</span></>}</>
                : <>{ownerName ?? "Someone"} holds the word</>}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {isOwner ? "Answer with Yes / No / Partially. Tap Got It if a question reveals the word."
                : isMyTurn ? "It's your turn — ask a yes/no question."
                : `Waiting for ${turnName ?? "next player"} to ask…`}
            </p>
          </div>
          <Badge variant="secondary" className="font-mono">{roundQuestionCount} Qs</Badge>
        </div>
        {isOwner && (
          <Button onClick={giveUp} variant="outline" size="sm" className="mt-4 w-full">
            <Flag className="size-4 mr-2" /> Nobody got it — end round (+10 bonus)
          </Button>
        )}
      </Card>
    );
  }

  if (room.status === "round_over") {
    const isFinal = room.round_number >= room.max_rounds;
    return (
      <Card className="p-6 text-center border-2 border-primary/40">
        <PartyPopper className="size-10 mx-auto text-primary mb-2" />
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Round {room.round_number} complete
        </p>
        <h3 className="font-display text-2xl font-bold mb-1">
          {room.round_winner_name
            ? <>{room.round_winner_name} cracked it!</>
            : <>Nobody guessed the word</>}
        </h3>
        <p className="text-muted-foreground mb-4">
          The word was <strong className="text-foreground">{room.secret_word}</strong>.
        </p>
        {isHost ? (
          <Button onClick={nextRound} size="lg" className="w-full">
            {isFinal ? "Show final results" : `Start round ${room.round_number + 1}`}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground italic">Waiting for the host…</p>
        )}
      </Card>
    );
  }

  return null;
}

function Chat({
  messages, meId, meName, room, players, isOwner, isMyTurn, chatRef, roundQuestionCount,
}: {
  messages: Message[]; meId: string; meName: string; room: Room; players: Player[];
  isOwner: boolean; isMyTurn: boolean; chatRef: React.RefObject<HTMLDivElement | null>;
  roundQuestionCount: number;
}) {
  const [text, setText] = useState("");
  const playing = room.status === "playing";
  const canAsk = playing && isMyTurn && !isOwner;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (!canAsk) return toast.error(isOwner ? "You hold the word" : "Not your turn");
    const { error } = await supabase.from("room_messages").insert({
      room_id: room.id, user_id: meId, display_name: meName,
      kind: "question", content: t,
    });
    if (error) return toast.error(error.message);
    setText("");
  }

  async function answer(msg: Message, response: "yes" | "no" | "partially" | "got_it") {
    const { error } = await supabase.from("room_messages").update({ response, is_correct: response === "got_it" }).eq("id", msg.id);
    if (error) return toast.error(error.message);

    if (response === "got_it") {
      // Asker: +10 for the correct guess. Word Master: +1 per question asked this round.
      const asker = players.find((p) => p.user_id === msg.user_id);
      const owner = players.find((p) => p.user_id === room.word_owner_id);
      const ops: Promise<unknown>[] = [];
      if (asker) ops.push(Promise.resolve(supabase.from("room_players").update({ score: asker.score + 10 }).eq("id", asker.id)));
      if (owner) ops.push(Promise.resolve(supabase.from("room_players").update({ score: owner.score + roundQuestionCount }).eq("id", owner.id)));
      await Promise.all(ops);
      await supabase.from("rooms").update({
        status: "round_over",
        round_winner_id: msg.user_id,
        round_winner_name: msg.display_name,
      }).eq("id", room.id);
      await supabase.from("room_messages").insert({
        room_id: room.id, user_id: meId, display_name: meName, kind: "system",
        content: `🎉 ${msg.display_name} got it after ${roundQuestionCount} question${roundQuestionCount === 1 ? "" : "s"}! +10 to ${msg.display_name}${owner ? `, +${roundQuestionCount} to ${owner.display_name}` : ""}. The word was "${room.secret_word}".`,
      });
    } else {
      const next = nextTurnUserId(players, room.word_owner_id, room.current_turn_user_id);
      await supabase.from("rooms").update({ current_turn_user_id: next }).eq("id", room.id);
    }
  }

  return (
    <Card className="flex flex-col h-[55vh] min-h-[380px] overflow-hidden">
      <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-12">
            <HelpCircle className="size-8 mx-auto mb-2 opacity-50" />
            No questions yet. Start asking!
          </div>
        )}
        {messages.map((m) => (
          <MessageRow key={m.id} m={m} isMine={m.user_id === meId} isOwner={isOwner} onAnswer={answer} />
        ))}
      </div>
      <div className="border-t bg-muted/30 p-3">
        <form onSubmit={send} className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              !playing ? "Round is over." :
              isOwner ? "You hold the word — wait for questions." :
              isMyTurn ? "Ask a yes/no question…" :
              "Waiting for your turn…"
            }
            disabled={!canAsk}
            maxLength={200}
          />
          <Button type="submit" disabled={!canAsk || !text.trim()}>
            <Send className="size-4" />
          </Button>
        </form>
      </div>
    </Card>
  );
}

function MessageRow({
  m, isMine, isOwner, onAnswer,
}: {
  m: Message; isMine: boolean; isOwner: boolean;
  onAnswer: (m: Message, r: "yes" | "no" | "partially" | "got_it") => void;
}) {
  if (m.kind === "system") {
    return <div className="text-center text-xs text-muted-foreground italic py-1">{m.content}</div>;
  }
  const align = isMine ? "items-end" : "items-start";
  const bubble = isMine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground";

  return (
    <div className={`flex flex-col ${align}`}>
      <div className="text-[11px] text-muted-foreground mb-0.5 px-1">{m.display_name}</div>
      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${bubble}`}>{m.content}</div>
      {m.kind === "question" && (
        <div className="mt-1.5">
          {m.response ? (
            <Badge variant="secondary" className={
              m.response === "yes" ? "bg-success/15 text-success border-success/30" :
              m.response === "no" ? "bg-destructive/15 text-destructive border-destructive/30" :
              m.response === "got_it" ? "bg-primary/15 text-primary border-primary/30" :
              "bg-warning/15 text-warning-foreground border-warning/30"
            }>
              {m.response === "yes" && <Check className="size-3 mr-1" />}
              {m.response === "no" && <X className="size-3 mr-1" />}
              {m.response === "got_it" && <Trophy className="size-3 mr-1" />}
              {m.response === "got_it" ? "Got it!" : m.response.charAt(0).toUpperCase() + m.response.slice(1)}
            </Badge>
          ) : isOwner ? (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" className="h-7 px-3 bg-success hover:bg-success/90 text-success-foreground" onClick={() => onAnswer(m, "yes")}>
                <Check className="size-3.5 mr-1" /> Yes
              </Button>
              <Button size="sm" variant="destructive" className="h-7 px-3" onClick={() => onAnswer(m, "no")}>
                <X className="size-3.5 mr-1" /> No
              </Button>
              <Button size="sm" className="h-7 px-3 bg-warning hover:bg-warning/90 text-warning-foreground" onClick={() => onAnswer(m, "partially")}>
                Partially
              </Button>
              <Button size="sm" className="h-7 px-3" onClick={() => onAnswer(m, "got_it")}>
                <Trophy className="size-3.5 mr-1" /> Got It
              </Button>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground italic">Waiting for answer…</span>
          )}
        </div>
      )}
    </div>
  );
}

// Tie-breakers: 1) highest score, 2) earliest joined_at, 3) display name A→Z.
function rankPlayers(players: Player[]): Player[] {
  return players.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ja = a.joined_at ?? "";
    const jb = b.joined_at ?? "";
    if (ja !== jb) return ja.localeCompare(jb);
    return a.display_name.localeCompare(b.display_name);
  });
}

function FinalResults({ room, players, isHost }: { room: Room; players: Player[]; isHost: boolean }) {
  const ranked = rankPlayers(players);
  const topScore = ranked[0]?.score ?? 0;

  async function playAgain() {
    await Promise.all(players.map((p) =>
      supabase.from("room_players").update({ score: 0 }).eq("id", p.id)
    ));
    await supabase.from("rooms").update({
      status: "waiting", round_number: 1, secret_word: null, word_owner_id: null,
      current_turn_user_id: null, round_winner_id: null, round_winner_name: null,
      winner_id: null, winner_name: null, round_started_at: null,
    }).eq("id", room.id);
  }

  const winnerName = ranked[0]?.display_name ?? room.winner_name ?? "No one";

  return (
    <div className="fixed inset-0 bg-background/85 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
      <Card className="max-w-md w-full p-8 border-2 border-primary shadow-2xl">
        <div className="text-center mb-6">
          <div className="size-16 rounded-full bg-warning/20 flex items-center justify-center mx-auto mb-3">
            <Trophy className="size-9 text-warning" />
          </div>
          <h2 className="font-display text-3xl font-bold mb-1">Match complete!</h2>
          <p className="text-lg">
            <strong className="text-primary">{winnerName}</strong> wins the match.
          </p>
        </div>
        <ol className="space-y-2 mb-6">
          {ranked.map((p, i) => {
            const isTop = p.score === topScore && topScore > 0 && i === 0;
            return (
              <li key={p.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${isTop ? "bg-primary/10 border border-primary/30" : "bg-muted/50"}`}>
                <span className="font-display font-bold text-lg w-6 text-center">{i + 1}</span>
                <span className="flex-1 font-medium truncate">{p.display_name}</span>
                {isTop && <Trophy className="size-4 text-warning" />}
                <span className="font-mono font-bold text-lg tabular-nums">{p.score}</span>
              </li>
            );
          })}
        </ol>
        {isHost ? (
          <Button onClick={playAgain} className="w-full" size="lg">Play another match</Button>
        ) : (
          <p className="text-sm text-muted-foreground text-center">Waiting for host to start a new match…</p>
        )}
      </Card>
    </div>
  );
}

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
  Sparkles, Target, Trophy, X, CircleHelp,
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
  status: string;
  winner_id: string | null;
  winner_name: string | null;
};
type Player = { id: string; user_id: string; display_name: string };
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

  // Load room + subscribe
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function load() {
      const { data: r, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("code", code)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      if (!r) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setRoom(r as Room);

      // Ensure player is in the room
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

    return () => {
      cancelled = true;
    };
  }, [code, user]);

  // Realtime subscriptions
  useEffect(() => {
    if (!room) return;
    const channel = supabase
      .channel(`room-${room.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            toast.message("Room was closed");
            navigate({ to: "/" });
          } else {
            setRoom(payload.new as Room);
          }
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
    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id, navigate]);

  // Autoscroll
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
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
  const ownerName = players.find((p) => p.user_id === room.word_owner_id)?.display_name;

  return (
    <div className="min-h-screen p-3 md:p-6">
      <div className="max-w-6xl mx-auto">
        <Header room={room} isHost={isHost} />
        <div className="grid lg:grid-cols-[260px_1fr] gap-4">
          <PlayerList players={players} room={room} meId={user.id} />
          <div className="space-y-4">
            <GameState
              room={room}
              players={players}
              isHost={isHost}
              isOwner={isOwner}
              ownerName={ownerName}
              meId={user.id}
              meName={getDisplayName(user)}
            />
            <Chat
              messages={messages}
              meId={user.id}
              meName={getDisplayName(user)}
              room={room}
              isOwner={isOwner}
              chatRef={chatRef}
            />
          </div>
        </div>
      </div>
      {room.status === "finished" && (
        <WinnerOverlay room={room} isHost={isHost} />
      )}
    </div>
  );
}

function Header({ room, isHost }: { room: Room; isHost: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(room.code);
    setCopied(true);
    toast.success("Code copied");
    setTimeout(() => setCopied(false), 1500);
  }
  function share() {
    const url = `${window.location.origin}/room/${room.code}`;
    navigator.clipboard.writeText(url);
    toast.success("Invite link copied");
  }
  return (
    <header className="flex flex-wrap items-center gap-3 mb-4">
      <Link to="/">
        <Button variant="ghost" size="sm"><ArrowLeft className="size-4" /></Button>
      </Link>
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-primary" />
        <span className="font-display text-lg font-bold">Word Hunt</span>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <div className="font-mono font-bold tracking-widest text-lg bg-card px-3 py-1.5 rounded-lg border-2">
          {room.code}
        </div>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <Button size="sm" variant="secondary" onClick={share} className="hidden sm:inline-flex">
          Share link
        </Button>
      </div>
    </header>
  );
}

function PlayerList({ players, room, meId }: { players: Player[]; room: Room; meId: string }) {
  return (
    <Card className="p-4 h-fit">
      <h3 className="font-display font-bold text-sm uppercase tracking-wider text-muted-foreground mb-3">
        Players ({players.length})
      </h3>
      <ul className="space-y-2">
        {players.map((p) => {
          const isHost = p.user_id === room.host_id;
          const isOwner = p.user_id === room.word_owner_id;
          const isMe = p.user_id === meId;
          const isWinner = p.user_id === room.winner_id;
          return (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <div className="size-8 rounded-full bg-gradient-to-br from-primary/30 to-accent/40 flex items-center justify-center font-bold text-xs">
                {p.display_name.slice(0, 2).toUpperCase()}
              </div>
              <span className="font-medium truncate flex-1">
                {p.display_name}{isMe && <span className="text-muted-foreground"> (you)</span>}
              </span>
              {isWinner && <Trophy className="size-4 text-warning" />}
              {isOwner && <Badge variant="default" className="text-[10px] px-1.5 py-0">Word</Badge>}
              {isHost && !isOwner && <Crown className="size-4 text-warning" />}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function GameState({
  room, players, isHost, isOwner, ownerName, meId, meName,
}: {
  room: Room; players: Player[]; isHost: boolean; isOwner: boolean;
  ownerName?: string; meId: string; meName: string;
}) {
  const [word, setWord] = useState("");
  const [selectedOwner, setSelectedOwner] = useState<string>(meId);

  async function startRound(e: React.FormEvent) {
    e.preventDefault();
    const w = word.trim();
    if (!w) return toast.error("Enter a word");
    if (players.length < 2) return toast.error("Need at least 2 players");
    const ownerPlayer = players.find((p) => p.user_id === selectedOwner);
    if (!ownerPlayer) return toast.error("Pick the word owner");
    const { error } = await supabase
      .from("rooms")
      .update({
        secret_word: w.toLowerCase(),
        word_owner_id: ownerPlayer.user_id,
        status: "playing",
        winner_id: null,
        winner_name: null,
      })
      .eq("id", room.id);
    if (error) return toast.error(error.message);
    await supabase.from("room_messages").insert({
      room_id: room.id,
      user_id: meId,
      display_name: meName,
      kind: "system",
      content: `${ownerPlayer.display_name} picked a secret word. Let the questions begin!`,
    });
    setWord("");
  }

  if (room.status === "waiting") {
    if (!isHost) {
      return (
        <Card className="p-6 text-center">
          <CircleHelp className="size-10 mx-auto text-muted-foreground mb-2" />
          <h3 className="font-display font-bold text-lg">Waiting for the host…</h3>
          <p className="text-sm text-muted-foreground">
            The host is picking the secret word and the word owner.
          </p>
        </Card>
      );
    }
    return (
      <Card className="p-6">
        <h3 className="font-display font-bold text-lg mb-1">Set up the round</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Choose the player who will hold the word, then type the secret word.
        </p>
        <form onSubmit={startRound} className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1.5">Word owner</label>
            <div className="flex flex-wrap gap-2">
              {players.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedOwner(p.user_id)}
                  className={`px-3 py-1.5 rounded-full border-2 text-sm font-medium transition ${
                    selectedOwner === p.user_id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border hover:border-primary/50"
                  }`}
                >
                  {p.display_name}{p.user_id === meId && " (you)"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Secret word</label>
            <Input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="e.g. elephant"
              maxLength={40}
              type={selectedOwner === meId ? "text" : "password"}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {selectedOwner === meId
                ? "Only the word owner sees the word."
                : "Hidden so other players can’t peek over your shoulder."}
            </p>
          </div>
          <Button type="submit" className="w-full" size="lg">
            <Target className="size-4 mr-2" /> Start round
          </Button>
        </form>
      </Card>
    );
  }

  if (room.status === "playing") {
    return (
      <Card className="p-5 bg-gradient-to-br from-primary/5 to-accent/10 border-primary/20">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Round in progress</p>
            <h3 className="font-display font-bold text-lg">
              {isOwner
                ? `You hold the word: `
                : `${ownerName ?? "Someone"} holds the word`}
              {isOwner && room.secret_word && (
                <span className="text-primary ml-1">{room.secret_word}</span>
              )}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isOwner
                ? "Answer questions with Yes / No / Partially."
                : "Ask yes/no questions or submit a guess."}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return null;
}

function Chat({
  messages, meId, meName, room, isOwner, chatRef,
}: {
  messages: Message[]; meId: string; meName: string; room: Room;
  isOwner: boolean; chatRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"question" | "guess">("question");
  const playing = room.status === "playing";

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (!playing) return toast.error("Round hasn't started");
    if (mode === "guess") {
      const correct = !!room.secret_word && t.toLowerCase() === room.secret_word.toLowerCase();
      const { error } = await supabase.from("room_messages").insert({
        room_id: room.id, user_id: meId, display_name: meName,
        kind: "guess", content: t, is_correct: correct,
      });
      if (error) return toast.error(error.message);
      if (correct) {
        await supabase.from("rooms").update({
          status: "finished", winner_id: meId, winner_name: meName,
        }).eq("id", room.id);
      }
    } else {
      if (isOwner) return toast.error("The word owner can't ask questions");
      const { error } = await supabase.from("room_messages").insert({
        room_id: room.id, user_id: meId, display_name: meName,
        kind: "question", content: t,
      });
      if (error) return toast.error(error.message);
    }
    setText("");
  }

  async function answer(msgId: string, response: "yes" | "no" | "partially") {
    const { error } = await supabase.from("room_messages")
      .update({ response }).eq("id", msgId);
    if (error) toast.error(error.message);
  }

  return (
    <Card className="flex flex-col h-[60vh] min-h-[420px] overflow-hidden">
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
        <div className="flex gap-1 mb-2">
          <Button
            type="button" size="sm"
            variant={mode === "question" ? "default" : "ghost"}
            onClick={() => setMode("question")}
            disabled={isOwner}
          >
            <HelpCircle className="size-3.5 mr-1" /> Question
          </Button>
          <Button
            type="button" size="sm"
            variant={mode === "guess" ? "default" : "ghost"}
            onClick={() => setMode("guess")}
          >
            <Target className="size-3.5 mr-1" /> Guess
          </Button>
        </div>
        <form onSubmit={send} className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              !playing ? "Waiting for round to start…" :
              mode === "guess" ? "Type your guess…" :
              isOwner ? "You hold the word — wait for questions." :
              "Is it an animal?"
            }
            disabled={!playing || (mode === "question" && isOwner)}
            maxLength={200}
          />
          <Button type="submit" disabled={!playing || !text.trim()}>
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
  onAnswer: (id: string, r: "yes" | "no" | "partially") => void;
}) {
  if (m.kind === "system") {
    return (
      <div className="text-center text-xs text-muted-foreground italic py-1">
        {m.content}
      </div>
    );
  }
  const align = isMine ? "items-end" : "items-start";
  const bubble = m.kind === "guess"
    ? m.is_correct
      ? "bg-success text-success-foreground"
      : "bg-warning/20 text-warning-foreground border border-warning/40"
    : isMine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground";

  return (
    <div className={`flex flex-col ${align}`}>
      <div className="text-[11px] text-muted-foreground mb-0.5 px-1">
        {m.display_name} · {m.kind === "guess" ? "guess" : "question"}
      </div>
      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${bubble}`}>
        {m.kind === "guess" && <Target className="size-3.5 inline mr-1 opacity-70" />}
        {m.content}
        {m.kind === "guess" && m.is_correct && <span className="ml-2 font-bold">✓ Correct!</span>}
      </div>
      {m.kind === "question" && (
        <div className="mt-1.5">
          {m.response ? (
            <Badge
              variant="secondary"
              className={
                m.response === "yes" ? "bg-success/15 text-success border-success/30" :
                m.response === "no" ? "bg-destructive/15 text-destructive border-destructive/30" :
                "bg-warning/15 text-warning-foreground border-warning/30"
              }
            >
              {m.response === "yes" && <Check className="size-3 mr-1" />}
              {m.response === "no" && <X className="size-3 mr-1" />}
              {m.response.charAt(0).toUpperCase() + m.response.slice(1)}
            </Badge>
          ) : isOwner ? (
            <div className="flex gap-1.5">
              <Button size="sm" className="h-7 px-3 bg-success hover:bg-success/90 text-success-foreground" onClick={() => onAnswer(m.id, "yes")}>
                <Check className="size-3.5 mr-1" /> Yes
              </Button>
              <Button size="sm" variant="destructive" className="h-7 px-3" onClick={() => onAnswer(m.id, "no")}>
                <X className="size-3.5 mr-1" /> No
              </Button>
              <Button size="sm" className="h-7 px-3 bg-warning hover:bg-warning/90 text-warning-foreground" onClick={() => onAnswer(m.id, "partially")}>
                Partially
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

function WinnerOverlay({ room, isHost }: { room: Room; isHost: boolean }) {
  async function newRound() {
    await supabase.from("rooms").update({
      status: "waiting", secret_word: null, word_owner_id: null,
      winner_id: null, winner_name: null,
    }).eq("id", room.id);
  }
  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
      <Card className="max-w-md w-full p-8 text-center border-2 border-primary shadow-2xl">
        <div className="size-16 rounded-full bg-warning/20 flex items-center justify-center mx-auto mb-3">
          <Trophy className="size-9 text-warning" />
        </div>
        <h2 className="font-display text-3xl font-bold mb-1">We have a winner!</h2>
        <p className="text-lg mb-1">
          <strong className="text-primary">{room.winner_name}</strong> guessed it.
        </p>
        <p className="text-muted-foreground mb-6">
          The word was <strong className="text-foreground">{room.secret_word}</strong>.
        </p>
        {isHost ? (
          <Button onClick={newRound} className="w-full" size="lg">Play another round</Button>
        ) : (
          <p className="text-sm text-muted-foreground">Waiting for host to start a new round…</p>
        )}
      </Card>
    </div>
  );
}

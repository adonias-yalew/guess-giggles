import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, getDisplayName } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Sparkles, Plus, LogIn, LogOut, Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Word Hunt · Multiplayer Word Guessing" },
      { name: "description", content: "Create or join a room, ask yes/no questions, and race to guess the secret word." },
      { property: "og:title", content: "Word Hunt · Multiplayer Word Guessing" },
      { property: "og:description", content: "Create or join a room, ask yes/no questions, and race to guess the secret word." },
    ],
  }),
  component: Index,
});

function genCode() {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return s;
}

function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Landing onStart={() => navigate({ to: "/auth" })} />;
  }

  const myName = getDisplayName(user);

  async function createRoom() {
    setBusy(true);
    try {
      const code = genCode();
      const { data, error } = await supabase
        .from("rooms")
        .insert({ code, host_id: user!.id, status: "waiting" })
        .select()
        .single();
      if (error) throw error;
      await supabase.from("room_players").insert({
        room_id: data.id,
        user_id: user!.id,
        display_name: myName,
      });
      navigate({ to: "/room/$code", params: { code } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create room");
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return toast.error("Enter a valid room code");
    setBusy(true);
    try {
      const { data: room, error } = await supabase
        .from("rooms")
        .select("id, code")
        .eq("code", code)
        .maybeSingle();
      if (error) throw error;
      if (!room) return toast.error("Room not found");
      const { error: jerr } = await supabase
        .from("room_players")
        .upsert(
          { room_id: room.id, user_id: user!.id, display_name: myName },
          { onConflict: "room_id,user_id" },
        );
      if (jerr) throw jerr;
      navigate({ to: "/room/$code", params: { code: room.code } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to join");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.invalidate();
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <header className="max-w-5xl mx-auto flex items-center justify-between mb-10">
        <div className="flex items-center gap-2">
          <Sparkles className="size-7 text-primary" />
          <span className="font-display text-2xl font-bold">Word Hunt</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:inline">
            Hey, <strong className="text-foreground">{myName}</strong>
          </span>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="size-4 mr-1" /> Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-3">
            Guess the secret word.
          </h1>
          <p className="text-muted-foreground text-lg">
            Ask yes/no questions. First correct guess wins.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-6 border-2 hover:border-primary/50 transition-colors">
            <div className="mb-4">
              <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                <Plus className="size-5 text-primary" />
              </div>
              <h2 className="font-display text-xl font-bold">Create a room</h2>
              <p className="text-sm text-muted-foreground">Be the host and pick the secret word.</p>
            </div>
            <Button className="w-full" onClick={createRoom} disabled={busy} size="lg">
              Create room
            </Button>
          </Card>

          <Card className="p-6 border-2 hover:border-primary/50 transition-colors">
            <div className="mb-4">
              <div className="size-10 rounded-lg bg-accent/40 flex items-center justify-center mb-3">
                <LogIn className="size-5 text-accent-foreground" />
              </div>
              <h2 className="font-display text-xl font-bold">Join a room</h2>
              <p className="text-sm text-muted-foreground">Enter a 6-character room code.</p>
            </div>
            <form onSubmit={joinRoom} className="flex gap-2">
              <Input
                placeholder="ABC123"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={8}
                className="font-mono uppercase tracking-widest text-center text-lg"
              />
              <Button type="submit" disabled={busy} size="lg">Join</Button>
            </form>
          </Card>
        </div>
      </main>
    </div>
  );
}

function Landing({ onStart }: { onStart: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-xl text-center">
        <div className="inline-flex items-center gap-2 mb-6">
          <Sparkles className="size-8 text-primary" />
          <span className="font-display text-3xl font-bold">Word Hunt</span>
        </div>
        <h1 className="font-display text-5xl md:text-6xl font-bold mb-4">
          Yes. No. <span className="text-primary">Partially.</span>
        </h1>
        <p className="text-lg text-muted-foreground mb-8">
          A real-time multiplayer word guessing game. Create a room, share the code, and let the questions fly.
        </p>
        <Button size="lg" onClick={onStart} className="text-base px-8">
          Get started
        </Button>
      </div>
    </div>
  );
}


-- Rooms
CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  host_id uuid NOT NULL,
  word_owner_id uuid,
  secret_word text,
  status text NOT NULL DEFAULT 'waiting',
  winner_id uuid,
  winner_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read rooms" ON public.rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can create rooms" ON public.rooms FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());
CREATE POLICY "Host or word owner can update room" ON public.rooms FOR UPDATE TO authenticated
  USING (host_id = auth.uid() OR word_owner_id = auth.uid())
  WITH CHECK (host_id = auth.uid() OR word_owner_id = auth.uid());
CREATE POLICY "Host can delete room" ON public.rooms FOR DELETE TO authenticated USING (host_id = auth.uid());

-- Players
CREATE TABLE public.room_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  display_name text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_players TO authenticated;
GRANT ALL ON public.room_players TO service_role;
ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read players" ON public.room_players FOR SELECT TO authenticated USING (true);
CREATE POLICY "User joins as self" ON public.room_players FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "User leaves as self" ON public.room_players FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Messages
CREATE TABLE public.room_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  display_name text NOT NULL,
  kind text NOT NULL,
  content text NOT NULL,
  response text,
  is_correct boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_messages TO authenticated;
GRANT ALL ON public.room_messages TO service_role;
ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read messages" ON public.room_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "User posts as self" ON public.room_messages FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Word owner can answer" ON public.room_messages FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id AND r.word_owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id AND r.word_owner_id = auth.uid()));

-- Realtime
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.room_players REPLICA IDENTITY FULL;
ALTER TABLE public.room_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_messages;

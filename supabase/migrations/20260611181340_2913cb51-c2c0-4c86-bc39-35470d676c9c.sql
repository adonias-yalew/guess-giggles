
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS round_number int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_rounds int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS current_turn_user_id uuid,
  ADD COLUMN IF NOT EXISTS round_winner_id uuid,
  ADD COLUMN IF NOT EXISTS round_winner_name text;

ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS score int NOT NULL DEFAULT 0;

-- Allow any player in the room to update room_players (for score increments)
DROP POLICY IF EXISTS "Players in room can update players" ON public.room_players;
CREATE POLICY "Players in room can update players"
  ON public.room_players
  FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.room_players rp WHERE rp.room_id = room_players.room_id AND rp.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.room_players rp WHERE rp.room_id = room_players.room_id AND rp.user_id = auth.uid()));

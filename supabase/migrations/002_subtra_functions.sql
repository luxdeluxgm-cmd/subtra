create or replace function public.get_subtra_puzzle()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_user_id uuid := auth.uid();
  v_puzzle record;
  v_c numeric;
  v_m numeric;
  v_y numeric;
  v_k numeric;
  v_r int;
  v_g int;
  v_b int;
  v_attempts jsonb := '[]'::jsonb;
  v_history record;
  v_streak record;
  v_played int := 0;
  v_wins int := 0;
  v_game_over boolean := false;
  v_won boolean := false;
begin
  select id, puzzle_number, payload
  into v_puzzle
  from public.puzzles
  where game = 'subtra' and puzzle_date = v_today
  limit 1;

  if v_puzzle is null then
    select id, puzzle_number, payload
    into v_puzzle
    from public.puzzles
    where game = 'subtra'
    order by puzzle_date desc
    limit 1;
  end if;

  if v_puzzle is null then
    raise exception 'No puzzle found';
  end if;

  v_c := (v_puzzle.payload ->> 'c')::numeric;
  v_m := (v_puzzle.payload ->> 'm')::numeric;
  v_y := (v_puzzle.payload ->> 'y')::numeric;
  v_k := (v_puzzle.payload ->> 'k')::numeric;

  v_r := round(255.0 * (1.0 - (v_c / 100.0)) * (1.0 - (v_k / 100.0)))::int;
  v_g := round(255.0 * (1.0 - (v_m / 100.0)) * (1.0 - (v_k / 100.0)))::int;
  v_b := round(255.0 * (1.0 - (v_y / 100.0)) * (1.0 - (v_k / 100.0)))::int;

  if v_user_id is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'guessNumber', a.guess_number,
          'cmyk', a.guess_data,
          'hints', a.feedback
        )
        order by a.guess_number asc
      ),
      '[]'::jsonb
    )
    into v_attempts
    from public.attempts a
    where a.user_id = v_user_id
      and a.game = 'subtra'
      and a.puzzle_date = v_today;

    select won, guesses_used
    into v_history
    from public.game_history
    where user_id = v_user_id
      and game = 'subtra'
      and puzzle_date = v_today
    limit 1;

    if v_history is not null then
      v_game_over := true;
      v_won := v_history.won;
    end if;

    select count(*)::int, count(*) filter (where won)::int
    into v_played, v_wins
    from public.game_history
    where user_id = v_user_id
      and game = 'subtra';

    select current_streak, best_streak
    into v_streak
    from public.streaks
    where user_id = v_user_id
      and game = 'subtra'
    limit 1;
  end if;

  return jsonb_build_object(
    'puzzleNumber', v_puzzle.puzzle_number,
    'targetRgb', format('rgb(%s, %s, %s)', v_r, v_g, v_b),
    'guesses', v_attempts,
    'gameOver', v_game_over,
    'won', v_won,
    'targetCmyk', case when v_game_over then jsonb_build_object('c', v_c, 'm', v_m, 'y', v_y, 'k', v_k) else null end,
    'targetName', case when v_game_over then coalesce(v_puzzle.payload ->> 'color_name', 'SWATCH') else null end,
    'stats', jsonb_build_object(
      'played', v_played,
      'wins', v_wins,
      'currentStreak', coalesce(v_streak.current_streak, 0),
      'bestStreak', coalesce(v_streak.best_streak, 0)
    )
  );
end;
$$;

create or replace function public.submit_subtra_guess(
  p_c integer,
  p_m integer,
  p_y integer,
  p_k integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_user_id uuid := auth.uid();
  v_puzzle record;
  v_guess_count int;
  v_next_guess int;
  v_tc int;
  v_tm int;
  v_ty int;
  v_tk int;
  v_hc text;
  v_hm text;
  v_hy text;
  v_hk text;
  v_won boolean;
  v_game_over boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_c < 0 or p_c > 100 or p_m < 0 or p_m > 100 or p_y < 0 or p_y > 100 or p_k < 0 or p_k > 100 then
    raise exception 'Channel values must be between 0 and 100';
  end if;

  insert into public.profiles (id, display_name, is_anonymous)
  values (v_user_id, 'Guest', true)
  on conflict (id) do nothing;

  perform 1 from public.profiles where id = v_user_id for update;

  if exists (
    select 1 from public.game_history
    where user_id = v_user_id and game = 'subtra' and puzzle_date = v_today
  ) then
    raise exception 'Daily puzzle already finished';
  end if;

  select count(*)::int
  into v_guess_count
  from public.attempts
  where user_id = v_user_id and game = 'subtra' and puzzle_date = v_today;

  if v_guess_count >= 5 then
    raise exception 'Maximum 5 guesses reached';
  end if;

  select id, puzzle_number, payload
  into v_puzzle
  from public.puzzles
  where game = 'subtra' and puzzle_date = v_today
  limit 1;

  if v_puzzle is null then
    select id, puzzle_number, payload
    into v_puzzle
    from public.puzzles
    where game = 'subtra'
    order by puzzle_date desc
    limit 1;
  end if;

  if v_puzzle is null then
    raise exception 'No puzzle found';
  end if;

  v_tc := (v_puzzle.payload ->> 'c')::int;
  v_tm := (v_puzzle.payload ->> 'm')::int;
  v_ty := (v_puzzle.payload ->> 'y')::int;
  v_tk := (v_puzzle.payload ->> 'k')::int;

  v_hc := case when abs(p_c - v_tc) <= 2 then 'perfect' when v_tc > p_c then 'higher' else 'lower' end;
  v_hm := case when abs(p_m - v_tm) <= 2 then 'perfect' when v_tm > p_m then 'higher' else 'lower' end;
  v_hy := case when abs(p_y - v_ty) <= 2 then 'perfect' when v_ty > p_y then 'higher' else 'lower' end;
  v_hk := case when abs(p_k - v_tk) <= 2 then 'perfect' when v_tk > p_k then 'higher' else 'lower' end;

  v_next_guess := v_guess_count + 1;

  insert into public.attempts (user_id, game, puzzle_date, guess_number, guess_data, feedback)
  values (
    v_user_id,
    'subtra',
    v_today,
    v_next_guess,
    jsonb_build_object('c', p_c, 'm', p_m, 'y', p_y, 'k', p_k),
    jsonb_build_object('c', v_hc, 'm', v_hm, 'y', v_hy, 'k', v_hk)
  );

  v_won := (v_hc = 'perfect' and v_hm = 'perfect' and v_hy = 'perfect' and v_hk = 'perfect');
  v_game_over := (v_won or v_next_guess >= 5);

  if v_game_over then
    insert into public.game_history (user_id, game, puzzle_date, won, guesses_used)
    values (v_user_id, 'subtra', v_today, v_won, v_next_guess)
    on conflict (user_id, game, puzzle_date) do nothing;

    insert into public.streaks (user_id, game, current_streak, best_streak, last_played_date, last_won_date, updated_at)
    values (
      v_user_id,
      'subtra',
      case when v_won then 1 else 0 end,
      case when v_won then 1 else 0 end,
      v_today,
      case when v_won then v_today else null end,
      now()
    )
    on conflict (user_id, game) do update
    set
      current_streak = case
        when not v_won then 0
        when public.streaks.last_won_date = v_today then public.streaks.current_streak
        when public.streaks.last_won_date = (v_today - 1) then public.streaks.current_streak + 1
        else 1
      end,
      best_streak = greatest(
        public.streaks.best_streak,
        case
          when not v_won then 0
          when public.streaks.last_won_date = v_today then public.streaks.current_streak
          when public.streaks.last_won_date = (v_today - 1) then public.streaks.current_streak + 1
          else 1
        end
      ),
      last_played_date = v_today,
      last_won_date = case when v_won then v_today else public.streaks.last_won_date end,
      updated_at = now();
  end if;

  return public.get_subtra_puzzle();
end;
$$;

revoke all on function public.get_subtra_puzzle() from public;
grant execute on function public.get_subtra_puzzle() to anon, authenticated;

revoke all on function public.submit_subtra_guess(integer, integer, integer, integer) from public;
grant execute on function public.submit_subtra_guess(integer, integer, integer, integer) to authenticated;

insert into public.puzzles (game, puzzle_date, puzzle_number, payload)
values
  ('subtra', (now() at time zone 'utc')::date + 0,  1,  '{"c": 15, "m": 65, "y": 45, "k": 5,  "color_name": "TERRACOTTA"}'::jsonb),
  ('subtra', (now() at time zone 'utc')::date + 1,  2,  '{"c": 75, "m": 20, "y": 35, "k": 10, "color_name": "TEAL SLATE"}'::jsonb),
  ('subtra', (now() at time zone 'utc')::date + 2,  3,  '{"c": 10, "m": 25, "y": 80, "k": 5,  "color_name": "OCHRE GOLD"}'::jsonb),
  ('subtra', (now() at time zone 'utc')::date + 3,  4,  '{"c": 45, "m": 70, "y": 15, "k": 15, "color_name": "PLUM VIOLET"}'::jsonb),
  ('subtra', (now() at time zone 'utc')::date + 4,  5,  '{"c": 50, "m": 15, "y": 60, "k": 10, "color_name": "SAGE MOSS"}'::jsonb),
  ('subtra', (now() at time zone 'utc')::date + 5,  6,  '{"c": 5,  "m": 80, "y": 65, "k": 0,  "color_name": "VERMILION"}'::jsonb),
  ('subtra', (now() at time zone 'utc')::date + 6,  7,  '{"c": 85, "m": 50, "y": 10, "k": 20, "color_name": "COBALT INK"}'::jsonb),
  ('subtra', (now() at time zone 'utc')::date + 7,  8,  '{"c": 20, "m": 40, "y": 70, "k": 25, "color_name": "RAW UMBER"}'::jsonb),
  ('subtra', (now() at time zone 'utc')::date + 8,  9,  '{"c": 35, "m": 10, "y": 25, "k": 0,  "color_name": "SEAFOAM"}'::jsonb),
  ('subtra', (now() at time zone 'utc')::date + 9,  10, '{"c": 0,  "m": 55, "y": 35, "k": 10, "color_name": "DUSTY ROSE"}'::jsonb),
  ('subtra', (now() at time zone 'utc')::date + 10, 11, '{"c": 65, "m": 30, "y": 85, "k": 20, "color_name": "FOREST PINE"}'::jsonb),
  ('subtra', (now() at time zone 'utc')::date + 11, 12, '{"c": 25, "m": 75, "y": 40, "k": 30, "color_name": "BURGUNDY"}'::jsonb),
  ('subtra', (now() at time zone 'utc')::date + 12, 13, '{"c": 60, "m": 35, "y": 0,  "k": 5,  "color_name": "PERIWINKLE"}'::jsonb),
  ('subtra', (now() at time zone 'utc')::date + 13, 14, '{"c": 15, "m": 50, "y": 90, "k": 10, "color_name": "BURNT SIENNA"}'::jsonb)
on conflict (game, puzzle_date) do nothing;

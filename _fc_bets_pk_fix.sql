-- Бойцовский клуб: ставки не проходили вообще.
-- fc_bet (рев.7) делает `on conflict (event_id, fid, on_fid)`, а таблица fc_bets
-- была создана ДО рев.7 с primary key (event_id, fid) — `create table if not exists`
-- в _fight_club.sql новый ключ не накатил. Любая ставка падала с 42P10
-- «there is no unique or exclusion constraint matching the ON CONFLICT specification».
-- Чиним ключ: (event_id, fid, on_fid) — можно держать ставку на обе стороны.

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.fc_bets'::regclass and conname = 'fc_bets_pkey'
       and pg_get_constraintdef(oid) = 'PRIMARY KEY (event_id, fid)'
  ) then
    alter table public.fc_bets drop constraint fc_bets_pkey;
    alter table public.fc_bets add primary key (event_id, fid, on_fid);
  end if;
end $$;

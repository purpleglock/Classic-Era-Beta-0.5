-- ============================================================
-- НОВОСТИ · СОБЫТИЯ ЖИЗНИ МИРА (ХРОНИКА СЕКТОРА)
--
-- Триггеры публикуют в ленту новостей события:
--   • основана религия;            • фракция приняла веру;
--   • получено достижение (см. news_announce_ach в _news_mentions.sql);
--   • создан союз (федерация/конфедерация);  • в союз вступила фракция;
--   • заключён вассалитет.
-- Каждое событие помечает причастные фракции в mentions → они увидят его в
-- своей ленте «Оповещения» (news_mentions).
--
-- Требует: _news_mentions.sql (_post_life_news), _fac_name, и таблицы фич
--   (faiths / faith_membership / diplo_unions / diplo_members / diplo_vassals).
-- Все триггеры best-effort: сбой публикации НЕ ломает основное действие.
-- Применять в Supabase → SQL Editor ПОСЛЕ _news_mentions.sql. Идемпотентно.
-- ============================================================

-- ── Вера: основана религия ───────────────────────────────────
create or replace function public._life_faith_found_after()
returns trigger language plpgsql security definer set search_path=public as $$
declare nm text;
begin
  begin
    nm := coalesce(nullif(public._fac_name(NEW.founder_fid),''),'Неизвестная фракция');
    perform public._post_life_news(
      '☉ Новая религия: ' || coalesce(NEW.name,'—'),
      format('%s провозглашает рождение веры «%s». Жрецы возносят первые молитвы, и весть о новом учении расходится по сектору.',
             nm, coalesce(NEW.name,'—')),
      coalesce(nullif(NEW.color,''),'rgba(201,162,39,0.55)'),
      jsonb_build_array(NEW.founder_fid));
  exception when others then null;
  end;
  return NEW;
end$$;
drop trigger if exists trg_life_faith_found on public.faiths;
create trigger trg_life_faith_found
  after insert on public.faiths
  for each row execute function public._life_faith_found_after();

-- ── Вера: фракция приняла веру (кроме основателя при создании) ─
create or replace function public._life_faith_join_after()
returns trigger language plpgsql security definer set search_path=public as $$
declare nm text; fn text; ffid text;
begin
  if NEW.role = 'member' then
    begin
      nm  := coalesce(nullif(public._fac_name(NEW.faction_id),''),'Одна из фракций');
      select name, founder_fid into fn, ffid from public.faiths where id = NEW.faith_id;
      perform public._post_life_news(
        '✛ Обращение: ' || nm,
        format('%s принимает веру «%s». Число последователей учения растёт.', nm, coalesce(fn,'—')),
        'rgba(201,162,39,0.5)',
        jsonb_build_array(NEW.faction_id) || (case when ffid is not null then jsonb_build_array(ffid) else '[]'::jsonb end));
    exception when others then null;
    end;
  end if;
  return NEW;
end$$;
drop trigger if exists trg_life_faith_join on public.faith_membership;
create trigger trg_life_faith_join
  after insert on public.faith_membership
  for each row execute function public._life_faith_join_after();

-- ── Дипломатия: создан союз ──────────────────────────────────
create or replace function public._life_union_create_after()
returns trigger language plpgsql security definer set search_path=public as $$
declare nm text; kindru text;
begin
  begin
    nm := coalesce(nullif(public._fac_name(NEW.leader_fid),''),'Одна из фракций');
    kindru := case NEW.kind when 'federation' then 'федерацию' when 'confederation' then 'конфедерацию' else 'союз' end;
    perform public._post_life_news(
      '⬡ Новый союз: ' || coalesce(NEW.name,'—'),
      format('%s учреждает %s «%s». Дипломаты сектора пересматривают расстановку сил.', nm, kindru, coalesce(NEW.name,'—')),
      'rgba(95,176,230,0.5)',
      jsonb_build_array(NEW.leader_fid));
  exception when others then null;
  end;
  return NEW;
end$$;
drop trigger if exists trg_life_union_create on public.diplo_unions;
create trigger trg_life_union_create
  after insert on public.diplo_unions
  for each row execute function public._life_union_create_after();

-- ── Дипломатия: фракция вступила в союз (кроме лидера-учредителя) ─
create or replace function public._life_union_join_after()
returns trigger language plpgsql security definer set search_path=public as $$
declare nm text; un text; lead text;
begin
  begin
    select u.name, u.leader_fid into un, lead from public.diplo_unions u where u.id = NEW.union_id;
    if lead is not null and lead <> NEW.fid then          -- не дублируем «создан союз»
      nm := coalesce(nullif(public._fac_name(NEW.fid),''),'Одна из фракций');
      perform public._post_life_news(
        '⬡ Пополнение союза: ' || coalesce(un,'—'),
        format('%s вступает в союз «%s». Ряды объединения крепнут.', nm, coalesce(un,'—')),
        'rgba(95,176,230,0.5)',
        jsonb_build_array(NEW.fid) || (case when lead is not null then jsonb_build_array(lead) else '[]'::jsonb end));
    end if;
  exception when others then null;
  end;
  return NEW;
end$$;
drop trigger if exists trg_life_union_join on public.diplo_members;
create trigger trg_life_union_join
  after insert on public.diplo_members
  for each row execute function public._life_union_join_after();

-- ── Дипломатия: заключён вассалитет (статус → active) ────────
create or replace function public._life_vassal_after()
returns trigger language plpgsql security definer set search_path=public as $$
declare lord text; vas text;
begin
  if NEW.status = 'active' and (OLD.status is distinct from 'active') then
    begin
      lord := coalesce(nullif(public._fac_name(NEW.overlord_fid),''),'Сюзерен');
      vas  := coalesce(nullif(public._fac_name(NEW.vassal_fid),''),'Вассал');
      perform public._post_life_news(
        '⚜ Вассальная присяга',
        format('%s присягает на верность державе %s. Заключён вассальный договор (дань %s%%).',
               vas, lord, round(coalesce(NEW.tribute_pct,0)*100)),
        'rgba(180,140,90,0.5)',
        jsonb_build_array(NEW.overlord_fid, NEW.vassal_fid));
    exception when others then null;
    end;
  end if;
  return NEW;
end$$;
drop trigger if exists trg_life_vassal on public.diplo_vassals;
create trigger trg_life_vassal
  after update on public.diplo_vassals
  for each row execute function public._life_vassal_after();

-- ── Проверка: основать веру / создать союз → событие в ленте ──

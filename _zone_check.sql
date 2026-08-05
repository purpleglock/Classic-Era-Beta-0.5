-- диагностика планировки: НИЧЕГО не пишет, только считает и рисует
create or replace function public._bt_zone_dump(p_battle uuid)
returns text language plpgsql as $$
declare t jsonb; w int; h int; sh jsonb; sp jsonb;
        i int; j int; row_s text; out_s text := ''; c text; k text;
begin
  perform public._bt_arm(p_battle);
  w := public._bt_w(); h := public._bt_h();
  select b.shape, b.spawn into sh, sp from public.battles b where b.id = p_battle;
  t := public._bt_gen_terrain(p_battle);
  out_s := format(E'%s  %sx%s  форма=%s  клеток=%s\n',
                  left(p_battle::text,8), w, h, coalesce(sh->>'k','-'),
                  (select count(*) from public._bt_terra_list(t)));
  for j in 0..h-1 loop
    row_s := '';
    for i in 0..w-1 loop
      k := public._bt_terra(t, i, j);
      if k = 'ast' then c := '#';
      elsif k = 'deb' then c := '=';
      elsif k = 'neb' then c := '~';
      elsif k = 'grv' then c := '@';
      elsif coalesce(public._bt_in_spawn(sp,'att',i,j),false) then c := 'A';
      elsif coalesce(public._bt_in_spawn(sp,'def',i,j),false) then c := 'D';
      elsif public._bt_in_arena(sh, i, j) then c := '.';
      else c := ' '; end if;
      row_s := row_s || c;
    end loop;
    out_s := out_s || row_s || E'\n';
  end loop;
  return out_s;
end$$;

select public._bt_zone_dump(id) from public.battles order by created_at desc limit 2;

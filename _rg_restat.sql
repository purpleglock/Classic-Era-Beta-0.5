-- Пересчёт ТТХ уже зарегистрированных установок под новые потолки и поле
-- capacityPenalty: старые строки помнят стары́е stats, а конструктор читает их.
update public.faction_reactors r
   set stats = public._rg_stats(r.cfg),
       carriers = public._rg_carriers(public._rg_norm(r.cfg), public._rg_stats(r.cfg));

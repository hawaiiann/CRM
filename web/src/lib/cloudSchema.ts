/**
 * Что должно быть в базе Supabase сверх исходной схемы. Приложение умеет
 * работать и без этого, но хуже: без entry_id журнал часов не может ни
 * править, ни удалять свои строки в облаке (см. syncActivityLog), и очередь
 * удалений вечно горит красным. SQL здесь, а не только в CHANGELOG, чтобы его
 * можно было скопировать прямо из приложения.
 */
export const REQUIRED_SQL = `-- Надбавки заказа: нейросети (₽ за единицу) и срочность (%).
alter table orders add column if not exists ai_rate numeric not null default 0;
alter table orders add column if not exists urgency_pct numeric not null default 0;

-- Идентификаторы записей журнала часов: без них правки и удаления
-- записей не доходят до облака.
alter table activity_log add column if not exists entry_id text;
create unique index if not exists activity_log_entry_id_key
  on activity_log(entry_id) where entry_id is not null;

-- Версия записи считается сервером, а не устройством.
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists orders_updated_at on orders;
create trigger orders_updated_at before update on orders
  for each row execute function set_updated_at();
drop trigger if exists tasks_updated_at on tasks;
create trigger tasks_updated_at before update on tasks
  for each row execute function set_updated_at();
drop trigger if exists advances_updated_at on advances;
create trigger advances_updated_at before update on advances
  for each row execute function set_updated_at();
drop trigger if exists planning_boards_updated_at on planning_boards;
create trigger planning_boards_updated_at before update on planning_boards
  for each row execute function set_updated_at();
drop trigger if exists planning_lessons_updated_at on planning_lessons;
create trigger planning_lessons_updated_at before update on planning_lessons
  for each row execute function set_updated_at();
drop trigger if exists app_settings_updated_at on app_settings;
create trigger app_settings_updated_at before update on app_settings
  for each row execute function set_updated_at();

-- Чтобы API сразу увидел новые колонки.
notify pgrst, 'reload schema';
`

export const SCHEMA_ISSUE_ENTRY_ID = "entry_id"
export const SCHEMA_ISSUE_ORDER_PRICING = "order_pricing"

/** Колонки надбавок заказа (нейросети, срочность). */
export const ORDER_PRICING_COLUMNS = ["ai_rate", "urgency_pct"] as const

export const SCHEMA_ISSUE_TEXT: Record<string, string> = {
  [SCHEMA_ISSUE_ENTRY_ID]: "В базе нет колонки entry_id у журнала часов: правки и удаления часов не доходят до облака, остальное сохраняется.",
  [SCHEMA_ISSUE_ORDER_PRICING]: "В базе нет колонок для срочности и надбавки за нейросети: они сохраняются только на этом устройстве, остальное уходит в облако.",
}

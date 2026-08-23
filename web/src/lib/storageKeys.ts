// Same keys as the vanilla app (js/app.js) — kept identical so a browser that
// still has the old app's localStorage isn't starting from scratch, and so a
// user who runs both versions side by side during the migration shares the
// same local cache.
export const STORAGE_KEY = "design_crm_orders_v10"
export const SETTINGS_KEY = "design_crm_settings_v6"
export const TASKS_KEY = "design_crm_tasks_v2"
export const ADVANCES_KEY = "design_crm_advances_v1"
export const PLANNING_KEY = "design_crm_planning_v8"
export const BACKUP_CFG_KEY = "design_crm_backup_cfg"
export const ACTIVITY_LOG_KEY = "design_crm_activity_log_v1"
export const KNOWN_ACCOUNTS_KEY = "design_crm_known_accounts_v1"

// Удаления, которые ещё не подтверждены облаком. Переживают перезагрузку
// намеренно: без этого не дошедшее до сервера удаление «отменялось» при
// следующем открытии приложения — запись приезжала обратно.
export const PENDING_DELETES_KEY = "design_crm_pending_deletes_v1"
